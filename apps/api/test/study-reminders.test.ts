/**
 * Daily study reminder emails: who gets one (Free and never paid — no subscription, trial or Stripe record —
 * exactly one course, confirmed address, reminders on), both emails (today's plan; no plan yet), content from
 * stored data only (no AI), local time zone, app language, one per local day even with retries and
 * overlapping runs, unsubscribe (one-click + page + preferences), and missing email config.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse, DocumentDetail, EmailPreferences, StudyPlan } from '@study/shared';

const RUN = Date.now();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  EMAIL_PROVIDER: 'log',
  STUDY_REMINDER_EMAILS_ENABLED: 'true',
  STUDY_REMINDER_LOCAL_HOUR: '8',
  WEB_APP_URL: 'https://app.exama.test',
  API_PUBLIC_URL: 'https://api.exama.test',
});
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { outbox, mailTestHooks } = await import('../src/lib/mailer.js');
const { studyAI } = await import('../src/ai/index.js');
const { db } = await import('../src/db/client.js');
const { addDays, localDate } = await import('../src/services/planner/dates.js');
const reminders = await import('../src/services/study-reminders.js');
const { resetUnsubscribeRateLimit } = await import('../src/routes/email.js');
after(() => sql.end());
beforeEach(() => {
  mailTestHooks.fail = undefined;
  resetUnsubscribeRateLimit();
});

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string } };
}
const send = (method: string, body: unknown, token?: string) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

let n = 0;
type U = { id: string; token: string; email: string };
async function newUser(verified = true): Promise<U> {
  const email = `remind-${RUN}-${n++}@example.com`;
  const r = await call<AuthResponse>('/auth/register', send('POST', { email, password: 'password123', name: 'Lina Study', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  if (verified) await sql`update users set email_verified_at = now() where id = ${r.body.user.id}`;
  return { id: r.body.user.id, token: r.body.token, email };
}
/** Uploads the biology PDF as a course and waits until it's ready. */
async function newCourse(u: U): Promise<string> {
  const form = new FormData();
  form.append('file', new File([pdf], 'biology-notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token: u.token });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 60; i++) {
    if ((await call<DocumentDetail>(`/documents/${up.body.id}`, { token: u.token })).body.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return up.body.id;
}
async function withPlan(u: U, over: Record<string, unknown> = {}) {
  const docId = await newCourse(u);
  const tz = (over.timezone as string) ?? 'UTC';
  const p = await call<StudyPlan>(`/documents/${docId}/study-plan`, send('POST', { examDate: addDays(localDate(new Date(), tz), 10), minutesPerDay: 60, preparedLevel: 'familiar', timezone: tz, studyDays: [0, 1, 2, 3, 4, 5, 6], ...over }, u.token));
  assert.equal(p.status, 201, JSON.stringify(p.body));
  return { docId, plan: p.body };
}
/** The app reports its language and the device time zone when it opens (signed in). */
async function opened(u: U, props: { time_zone?: string; app_language?: string } = { time_zone: 'UTC' }) {
  const r = await call('/events', send('POST', { anonymousId: randomUUID(), events: [{ name: 'app_opened', properties: { platform: 'web', authenticated: true, ...props } }] }, u.token));
  assert.equal(r.status, 202, JSON.stringify(r.body));
}
/** A free student with one course and no study plan, whose app has reported a time zone. */
async function noPlanStudent(props?: Parameters<typeof opened>[1]) {
  const u = await newUser();
  const docId = await newCourse(u);
  await opened(u, props);
  return { u, docId };
}
const run = (u: U | U[], when = at('09:00')) => reminders.runStudyReminders(when, { userIds: (Array.isArray(u) ? u : [u]).map((x) => x.id) });
const sentTo = async (u: U) => (await call<EmailPreferences>('/email/preferences', { token: u.token })).body.sentToThisAccount;
/** Reminder emails only (sign-up also sends a verification email to the same address). */
const mailsTo = (u: U) => outbox.filter((m) => m.to === u.email && m.idempotencyKey?.startsWith('study-reminder/'));
/** 09:00 UTC on today's UTC date: after the 08:00 send time for UTC plans. */
const at = (hhmm: string, dayOffset = 0) => new Date(`${addDays(localDate(new Date(), 'UTC'), dayOffset)}T${hhmm}:00Z`);
const rows = (u: U) => sql`select local_date, status, attempts from study_reminder_emails where user_id = ${u.id} order by local_date`;

/** Any AI call during a run fails the test: reminders must only use stored plan data. */
async function withoutAI<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, unknown> = {};
  for (const k of Object.keys(studyAI) as (keyof typeof studyAI)[]) {
    saved[k] = studyAI[k];
    (studyAI as unknown as Record<string, unknown>)[k] = () => {
      throw new Error(`AI called during reminders: ${String(k)}`);
    };
  }
  try {
    return await fn();
  } finally {
    Object.assign(studyAI, saved);
  }
}

test('a free student with a plan gets one email for the day, built from the stored plan only (no AI)', async () => {
  const u = await newUser();
  const { docId, plan } = await withPlan(u);
  await sql`update documents set title = ${'Biology <b>&</b> "Cells"'} where id = ${docId}`;
  const today = plan.tasks.filter((t) => t.date === plan.today && t.status === 'pending');
  assert.ok(today.length > 0, 'the plan has tasks today');

  const r = await withoutAI(() => reminders.runStudyReminders(at('09:00'), { userIds: [u.id] }));
  assert.equal(r.sent, 1, JSON.stringify(r));
  const [mail] = mailsTo(u);
  assert.ok(mail);
  // Today's tasks, from the plan: every topic and the minutes.
  for (const t of today) assert.ok(mail.text.includes(t.topic ?? 'the whole course'), `task ${t.topic}`);
  assert.ok(mail.text.includes(`${today.reduce((s, t) => s + t.minutes, 0)} minutes`));
  // A stored focus note for one of today's topics is reused verbatim.
  const note = plan.topics.find((i) => today.some((t) => t.topic === i.topic))?.focus;
  if (note) assert.ok(mail.text.includes(note));
  assert.ok(mail.text.includes(`https://app.exama.test/plan/${docId}`));
  // User data is escaped in the HTML.
  assert.ok(mail.html.includes('Biology &#60;b&#62;&#38;&#60;/b&#62; &#34;Cells&#34;') && !mail.html.includes('<b>&</b>'));
  // Unsubscribe: link in the body + RFC 8058 one-click headers.
  assert.match(mail.text, /https:\/\/app\.exama\.test\/unsubscribe#token=[0-9a-f-]{36}\.[\w-]{32}/);
  assert.match(mail.headers?.['List-Unsubscribe'] ?? '', /^<https:\/\/api\.exama\.test\/email\/unsubscribe\?token=/);
  assert.equal(mail.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(mail.idempotencyKey, `study-reminder/${u.id}/${plan.today}`);
  assert.deepEqual((await rows(u)).map((x) => [x.local_date, x.status]), [[plan.today, 'sent']]);
});

test('no duplicates: later runs, overlapping runs and a run that finds the day already claimed send nothing more', async () => {
  const u = await newUser();
  await withPlan(u);
  const both = await Promise.all([reminders.runStudyReminders(at('09:00'), { userIds: [u.id] }), reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })]);
  assert.equal(both[0].sent + both[1].sent, 1);
  await reminders.runStudyReminders(at('15:00'), { userIds: [u.id] });
  await reminders.runStudyReminders(at('23:59'), { userIds: [u.id] });
  assert.equal(mailsTo(u).length, 1);

  // Another instance already claimed today for a second student: this one sends nothing.
  const v = await newUser();
  const { plan } = await withPlan(v);
  await sql`insert into study_reminder_emails (user_id, local_date) values (${v.id}, ${plan.today})`;
  await reminders.runStudyReminders(at('09:00'), { userIds: [v.id] });
  assert.equal(mailsTo(v).length, 0);
});

test('deleting the account removes its reminder log', async () => {
  const u = await newUser();
  await withPlan(u);
  await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
  assert.equal((await rows(u)).length, 1);
  assert.equal((await call('/auth/me', send('DELETE', { password: 'password123' }, u.token))).status, 200);
  assert.equal((await rows(u)).length, 0);
});

test('a failed send is retried on the next run (same idempotency key), at most 3 attempts a day', async () => {
  const u = await newUser();
  const { plan } = await withPlan(u);
  mailTestHooks.fail = (m) => m.to === u.email;
  await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
  await reminders.runStudyReminders(at('09:15'), { userIds: [u.id] });
  assert.deepEqual((await rows(u)).map((x) => [x.status, x.attempts]), [['failed', 2]]);
  mailTestHooks.fail = undefined;
  const r = await reminders.runStudyReminders(at('09:30'), { userIds: [u.id] });
  assert.equal(r.sent, 1);
  assert.deepEqual((await rows(u)).map((x) => [x.status, x.attempts]), [['sent', 3]]);
  assert.equal(mailsTo(u).length, 1);
  assert.equal(mailsTo(u)[0]!.idempotencyKey, `study-reminder/${u.id}/${plan.today}`);

  const w = await newUser();
  await withPlan(w);
  mailTestHooks.fail = (m) => m.to === w.email;
  for (const t of ['09:00', '09:15', '09:30', '09:45', '10:00']) await reminders.runStudyReminders(at(t), { userIds: [w.id] });
  assert.deepEqual((await rows(w)).map((x) => [x.status, x.attempts]), [['failed', 3]], 'gives up after 3 attempts');
});

const DAY = 86_400_000;
/** Server-side billing records as the providers write them (Stripe webhook rows, a started web checkout). */
const billing: Record<string, (u: U) => Promise<unknown>> = {
  'mock trial (active)': (u) => call('/billing/mock/state', send('POST', { state: 'trial' }, u.token)),
  'Stripe trial (active)': (u) =>
    sql`insert into subscriptions (user_id, provider, plan_id, status, trial_ends_at, current_period_ends_at, trial_used, provider_ref, environment)
        values (${u.id}, 'stripe', 'student_monthly', 'trialing', ${new Date(Date.now() + 3 * DAY).toISOString()}, ${new Date(Date.now() + 3 * DAY).toISOString()}, true, ${`sub_t_${u.id}`}, 'production')`,
  'paid plan (active)': (u) => call('/billing/mock/state', send('POST', { state: 'student_monthly' }, u.token)),
  'paid Stripe plan, cancelled (access until period end)': (u) =>
    sql`insert into subscriptions (user_id, provider, plan_id, status, current_period_ends_at, will_renew, trial_used, provider_ref, environment)
        values (${u.id}, 'stripe', 'pro_yearly', 'cancelled', ${new Date(Date.now() + 20 * DAY).toISOString()}, false, true, ${`sub_c_${u.id}`}, 'production')`,
  'previously paid, now expired': async (u) => {
    await call('/billing/mock/state', send('POST', { state: 'basic_yearly' }, u.token));
    await call('/billing/mock/state', send('POST', { state: 'expired' }, u.token));
  },
  'trial ended without paying (row kept: fail closed)': (u) =>
    sql`insert into subscriptions (user_id, provider, plan_id, status, trial_ends_at, current_period_ends_at, will_renew, trial_used, environment)
        values (${u.id}, 'apple', 'student_monthly', 'expired', ${new Date(Date.now() - DAY).toISOString()}, ${new Date(Date.now() - DAY).toISOString()}, false, true, 'production')`,
  'Stripe customer only (web checkout started; payment not ruled out)': (u) =>
    sql`insert into stripe_customers (user_id, stripe_customer_id) values (${u.id}, ${`cus_${u.id}`})`,
};

test('billing: active trials, paid, cancelled and previously paid accounts, and any Stripe customer never get the email', async () => {
  for (const [name, apply] of Object.entries(billing)) {
    for (const withStudyPlan of [true, false]) {
      const u = await newUser();
      if (withStudyPlan) await withPlan(u);
      else await newCourse(u);
      await opened(u);
      await apply(u);
      const r = await run(u);
      assert.equal(r.subscribers, 1, `${name} (plan: ${withStudyPlan}) ${JSON.stringify(r)}`);
      assert.equal(r.sent, 0, name);
      assert.equal(mailsTo(u).length, 0, name);
      assert.equal((await rows(u)).length, 0, `${name}: nothing claimed`);
      assert.equal(await sentTo(u), false, `${name}: preferences say this account doesn't get it`);
    }
  }
  // Ending a subscription or trial doesn't make an account eligible again.
  const u = await newUser();
  await withPlan(u);
  await call('/billing/mock/state', send('POST', { state: 'trial' }, u.token));
  await call('/billing/mock/state', send('POST', { state: 'free' }, u.token)); // trial used: the row stays
  assert.equal((await run(u)).subscribers, 1);
  assert.equal(mailsTo(u).length, 0);
});

test('billing: owner access is excluded, and an error while checking billing fails closed', async () => {
  const owner = await newUser();
  await withPlan(owner);
  const saved = [...config.OWNER_USER_IDS];
  config.OWNER_USER_IDS.push(owner.id);
  try {
    assert.equal((await run(owner)).subscribers, 1);
    assert.equal(mailsTo(owner).length, 0);
  } finally {
    config.OWNER_USER_IDS.splice(0, config.OWNER_USER_IDS.length, ...saved);
  }

  const u = await newUser();
  await withPlan(u);
  assert.deepEqual(await reminders.billingEligibility(u.id), { ok: true, canCreatePlan: false }, 'plan already made this month');
  const select = db.select;
  (db as { select: unknown }).select = () => {
    throw new Error('billing records unavailable');
  };
  try {
    assert.deepEqual(await reminders.billingEligibility(u.id), { ok: false, reason: 'unknown' });
  } finally {
    (db as { select: unknown }).select = select;
  }
});

test('zero courses, several courses, unconfirmed address, or reminders off → no email', async () => {
  const noCourse = await newUser();
  await opened(noCourse);
  const two = await newUser();
  const { docId: planned } = await withPlan(two);
  const second = await newCourse(two);
  await opened(two);
  const twoNoPlan = await newUser();
  await newCourse(twoNoPlan);
  await newCourse(twoNoPlan);
  await opened(twoNoPlan);
  const unverified = await newUser(false);
  await withPlan(unverified);
  await opened(unverified);
  const off = await newUser();
  await withPlan(off);
  await opened(off);
  await call('/email/preferences', send('PATCH', { studyReminders: false }, off.token));
  const offNoPlan = await newUser();
  await newCourse(offNoPlan);
  await opened(offNoPlan);
  await call('/email/preferences', send('PATCH', { studyReminders: false }, offNoPlan.token));

  const all = [noCourse, two, twoNoPlan, unverified, off, offNoPlan];
  const r = await run(all);
  assert.equal(r.sent, 0, JSON.stringify(r));
  for (const u of all) {
    assert.equal(mailsTo(u).length, 0);
    assert.equal((await rows(u)).length, 0);
  }
  // Back to exactly one course → the next day's email goes out (its plan's email).
  assert.equal((await call(`/documents/${second}`, { method: 'DELETE', token: two.token })).status, 204);
  assert.equal((await run(two)).sent, 1);
  assert.ok(mailsTo(two)[0]!.text.includes(`https://app.exama.test/plan/${planned}`));
});

test('no study plan: a nudge back to the course, from stored data only, with a link to create a plan', async () => {
  const { u, docId } = await noPlanStudent({ time_zone: 'UTC', app_language: 'en' });
  await sql`update documents set title = ${'Biology <b>&</b> "Cells"'} where id = ${docId}`;
  const r = await withoutAI(() => run(u));
  assert.equal(r.sent, 1, JSON.stringify(r));
  const [mail] = mailsTo(u);
  assert.ok(mail);
  assert.equal(mail.subject, 'Pick up where you left off: Biology <b>&</b> "Cells"');
  assert.ok(mail.text.includes(`Continue studying: https://app.exama.test/documents/${docId}`), mail.text);
  assert.ok(mail.text.includes(`Create a study plan: https://app.exama.test/plan/setup?id=${docId}`), mail.text);
  assert.ok(mail.html.includes(`href="https://app.exama.test/documents/${docId}"`));
  assert.ok(mail.html.includes('Biology &#60;b&#62;&#38;&#60;/b&#62; &#34;Cells&#34;') && !mail.html.includes('<b>&</b>'));
  // No tasks are made up, and nothing is sold.
  assert.doesNotMatch(mail.text, /\bmin\b|minutes|Learn:|Review:|Practice:/);
  assert.doesNotMatch(`${mail.subject}\n${mail.text}`.replace(/https?:\/\/\S+/g, ''), /trial|subscri(be|ption)|upgrade|premium|price|€|\$|offer|discount/i);
  assert.match(mail.text, /https:\/\/app\.exama\.test\/unsubscribe#token=[0-9a-f-]{36}\.[\w-]{32}/);
  assert.equal(mail.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const date = localDate(at('09:00'), 'UTC');
  assert.equal(mail.idempotencyKey, `study-reminder/${u.id}/${date}`);
  assert.deepEqual((await rows(u)).map((x) => [x.local_date, x.status]), [[date, 'sent']]);
  assert.equal(await sentTo(u), true);

  // The Free plan's study plan for this month is used up: no "create a plan" link (the course link stays).
  const { u: v, docId: d2 } = await noPlanStudent();
  await sql`insert into usage_ledger (user_id, kind, amount) values (${v.id}, 'study_plan_generation', 1)`;
  await run(v);
  const [m2] = mailsTo(v);
  assert.ok(m2 && m2.text.includes(`/documents/${d2}`));
  assert.ok(!m2.text.includes('/plan/setup') && !m2.html.includes('/plan/setup'));

  // A course that isn't ready (still processing, or failed): nothing to send that day.
  const { u: w, docId: d3 } = await noPlanStudent();
  await sql`update documents set status = 'failed' where id = ${d3}`;
  assert.equal((await run(w)).skipped, 1);
  assert.equal(mailsTo(w).length, 0);
});

test('no study plan: needs a known local time zone; 08:00 local; one email per local day', async () => {
  // Never reported a time zone (and no plan to take one from) → never sent; an invalid zone is ignored.
  const u = await newUser();
  await newCourse(u);
  assert.equal((await run(u)).noTimeZone, 1);
  await opened(u, { time_zone: 'Not/AZone' });
  assert.equal((await run(u)).noTimeZone, 1);
  assert.equal((await rows(u)).length, 0);

  // Tokyo (UTC+9): 22:30 UTC is 07:30 there — not yet; 23:30 UTC is 08:30 on the next local date.
  await opened(u, { time_zone: 'Asia/Tokyo' });
  assert.equal((await run(u, at('22:30'))).notDue, 1);
  const night = at('23:30');
  assert.equal((await run(u, night)).sent, 1);
  assert.deepEqual((await rows(u)).map((x) => x.local_date), [localDate(night, 'Asia/Tokyo')]);

  // Same local day: later and overlapping runs send nothing more; the next local day sends again.
  const { u: v } = await noPlanStudent();
  const both = await Promise.all([run(v), run(v)]);
  assert.equal(both[0].sent + both[1].sent, 1);
  await run(v, at('15:00'));
  await run(v, at('23:59'));
  assert.equal(mailsTo(v).length, 1);
  assert.equal((await run(v, at('09:00', 1))).sent, 1);
  assert.deepEqual(new Set(mailsTo(v).map((m) => m.idempotencyKey)).size, 2);
});

test('local time: nothing before 08:00 in the plan’s time zone; the date is the student’s local date', async () => {
  const u = await newUser();
  await withPlan(u);
  const early = await reminders.runStudyReminders(at('07:59'), { userIds: [u.id] });
  assert.equal(early.notDue, 1);
  assert.equal(mailsTo(u).length, 0);

  // Tokyo is UTC+9: 23:30 UTC is 08:30 the next day there.
  const tokyo = await newUser();
  await withPlan(tokyo, { timezone: 'Asia/Tokyo' });
  const night = at('23:30');
  const local = localDate(night, 'Asia/Tokyo');
  assert.notEqual(local, localDate(night, 'UTC'));
  const r = await reminders.runStudyReminders(night, { userIds: [tokyo.id] });
  assert.equal(r.sent, 1, JSON.stringify(r));
  assert.deepEqual((await rows(tokyo)).map((x) => x.local_date), [local]);
  assert.equal(reminders.localHour(night, 'Asia/Tokyo'), 8);
  // The plan's zone wins over the device's (the plan's "today" is computed there).
  const both = await newUser();
  await withPlan(both, { timezone: 'Asia/Tokyo' });
  await opened(both, { time_zone: 'America/New_York' });
  assert.equal((await run(both, night)).sent, 1);
});

test('language: the app language the app reported; else the plan’s / course’s (en, es, fr, ar; Arabic right-to-left)', async () => {
  // App language beats the plan's language.
  const p = await newUser();
  await withPlan(p, { language: 'es' });
  await opened(p, { time_zone: 'UTC', app_language: 'fr' });
  await run(p);
  assert.match(mailsTo(p)[0]!.subject, /Votre plan de révision|Votre examen/);
  // No plan: Arabic app → Arabic, right-to-left; French app → French.
  const { u: ar } = await noPlanStudent({ time_zone: 'UTC', app_language: 'ar' });
  const { u: fr } = await noPlanStudent({ time_zone: 'UTC', app_language: 'fr' });
  await run([ar, fr]);
  assert.match(mailsTo(ar)[0]!.subject, /تابع من حيث توقفت/);
  assert.ok(mailsTo(ar)[0]!.html.includes('dir="rtl"'));
  assert.match(mailsTo(fr)[0]!.subject, /^Reprenez là où vous en étiez/);
  assert.ok(mailsTo(fr)[0]!.html.includes('dir="ltr"'));
  // App never reported a language: the plan's language (below).
  const want = { es: /Tu plan de estudio de hoy|Tu examen/, fr: /Votre plan de révision|Votre examen/, ar: /خطة مذاكرتك|اختبارك/ } as const;
  for (const language of ['es', 'fr', 'ar'] as const) {
    const u = await newUser();
    await withPlan(u, { language });
    await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
    const [m] = mailsTo(u);
    assert.ok(m, language);
    assert.match(m.subject, want[language]);
    assert.equal(m.html.includes('dir="rtl"'), language === 'ar');
  }
});

test('unsubscribe: one-click POST with the signed token turns reminders off; invalid or tampered tokens are refused', async () => {
  const u = await newUser();
  await withPlan(u);
  const token = reminders.unsubscribeToken(u.id);
  assert.equal(reminders.verifyUnsubscribeToken(token), u.id);
  // RFC 8058 one-click: form body, token in the URL.
  const r = await app.request(`/email/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(r.status, 200);
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: u.token })).body.studyReminders, false);
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 0);
  // Opening the one-click URL (GET) only leads to the confirmation page; it never unsubscribes.
  const other0 = await newUser();
  const t0 = reminders.unsubscribeToken(other0.id);
  const g = await app.request(`/email/unsubscribe?token=${encodeURIComponent(t0)}`);
  assert.equal(g.status, 302);
  assert.equal(g.headers.get('location'), `https://app.exama.test/unsubscribe#token=${t0}`);
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: other0.token })).body.studyReminders, true, 'GET does not unsubscribe');
  // Idempotent, and the web page's JSON form works too.
  assert.equal((await call('/email/unsubscribe', send('POST', { token }))).status, 200);

  const other = await newUser();
  const forged = `${other.id}.${token.split('.')[1]}`;
  for (const bad of [forged, `${u.id}.${'A'.repeat(32)}`, 'nonsense', '']) {
    const res = await call('/email/unsubscribe', send('POST', { token: bad }));
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.code, 'unsubscribe_link_invalid');
  }
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: other.token })).body.studyReminders, true, 'other accounts untouched');
});

test('preferences: read and switch, signed in only; turning back on resumes emails', async () => {
  const u = await newUser();
  await withPlan(u);
  assert.equal((await call('/email/preferences')).status, 401);
  const p = await call<EmailPreferences>('/email/preferences', { token: u.token });
  // `marketing` is the separate marketing-email consent: off for every account that has not said yes (see marketing-consent.test.ts).
  assert.deepEqual(p.body, { studyReminders: true, marketing: false, marketingAvailable: true, available: true, emailVerified: true, sentToThisAccount: true });
  assert.equal((await call('/email/preferences', send('PATCH', { studyReminders: 'yes' }, u.token))).status, 400);
  await call('/email/preferences', send('PATCH', { studyReminders: false }, u.token));
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 0);
  const on = await call<EmailPreferences>('/email/preferences', send('PATCH', { studyReminders: true }, u.token));
  assert.equal(on.body.studyReminders, true);
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 1);
  await call('/billing/mock/state', send('POST', { state: 'student_monthly' }, u.token));
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: u.token })).body.sentToThisAccount, false);
});

test('study reminders and marketing consent are independent categories: neither is required for, or changed by, the other (both emails)', async () => {
  const MARKETING = { consent: true, version: '2026-10-v1', language: 'en' };
  const consentOf = async (u: U) => (await sql<{ at: string | null }[]>`select marketing_consent_at::text as at from users where id = ${u.id}`)[0]!.at;

  // The plan email goes to an account that never gave marketing consent, and to one that gave it and then withdrew it.
  const never = await newUser();
  await withPlan(never);
  const withdrew = await newUser();
  await withPlan(withdrew);
  assert.equal((await call('/email/preferences', send('PATCH', { marketing: MARKETING }, withdrew.token))).status, 200);
  assert.equal((await call('/email/preferences', send('PATCH', { marketing: { consent: false } }, withdrew.token))).status, 200);
  assert.deepEqual([await consentOf(never), await consentOf(withdrew)], [null, null]);
  assert.equal((await run([never, withdrew])).sent, 2, 'study reminders do not need marketing consent');
  assert.equal(mailsTo(never).length + mailsTo(withdrew).length, 2);

  // So does the "no plan yet" email.
  const nudged = await noPlanStudent();
  assert.equal(await consentOf(nudged.u), null);
  assert.equal((await run(nudged.u)).sent, 1);
  assert.match(mailsTo(nudged.u)[0]!.subject, /^Pick up where you left off/);

  // An account that said yes to marketing gets study reminders only while its own switch is on; the run never touches the consent.
  const both = await newUser();
  await withPlan(both);
  assert.equal((await call('/email/preferences', send('PATCH', { marketing: MARKETING }, both.token))).status, 200);
  const granted = await consentOf(both);
  assert.ok(granted);
  assert.equal((await call('/email/preferences', send('PATCH', { studyReminders: false }, both.token))).status, 200);
  assert.equal((await run(both)).sent, 0, 'the study-reminder switch decides study reminders');
  assert.equal(await consentOf(both), granted, 'switching study reminders off does not withdraw marketing consent');
  assert.equal((await call('/email/preferences', send('PATCH', { studyReminders: true }, both.token))).status, 200);
  assert.equal((await run(both)).sent, 1);
  assert.equal(await consentOf(both), granted, 'a study reminder does not refresh, change or withdraw it either');

  // The marketing unsubscribe link leaves the study switch alone; the study unsubscribe link leaves the consent alone.
  const token = reminders.unsubscribeToken(both.id);
  assert.equal((await call(`/email/unsubscribe?token=${encodeURIComponent(token)}&category=marketing`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 200);
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: both.token })).body.studyReminders, true);
  assert.equal(await consentOf(both), null);
});

test('missing email configuration: the run logs why and sends nothing, without throwing', async () => {
  const u = await newUser();
  await withPlan(u);
  const saved = { provider: config.EMAIL_PROVIDER, enabled: config.STUDY_REMINDER_EMAILS_ENABLED, web: config.WEB_APP_URL };
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.join(' '));
  try {
    (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = 'disabled';
    const r = await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
    assert.equal(r.unavailable, 'email_disabled');
    assert.ok(errors.some((e) => /EMAIL_PROVIDER=resend/.test(e)), errors.join('\n'));
    (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = saved.provider;
    (config as { WEB_APP_URL?: string }).WEB_APP_URL = undefined;
    assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).unavailable, 'no_web_app_url');
    (config as { WEB_APP_URL?: string }).WEB_APP_URL = saved.web;
    (config as { STUDY_REMINDER_EMAILS_ENABLED: boolean }).STUDY_REMINDER_EMAILS_ENABLED = false;
    assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).unavailable, 'disabled');
  } finally {
    console.error = orig;
    Object.assign(config, { EMAIL_PROVIDER: saved.provider, STUDY_REMINDER_EMAILS_ENABLED: saved.enabled, WEB_APP_URL: saved.web });
  }
  assert.equal(mailsTo(u).length, 0);
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 1, 'works again once configured');
});

// ---------------------------------------------------------------- regression: 2026-10-18 (no emails sent)

/** One install: the anonymous id the app keeps per device and sends with every event. */
const event = (anonymousId: string, name: string, properties: Record<string, unknown>, token?: string) =>
  call('/events', send('POST', { anonymousId, events: [{ name, properties }] }, token));

test('signed up in the same app session: the time zone from the signed-out app_opened of that install is used', async () => {
  // Production, 2026-10-18: the only eligible account opened the app signed out (app_opened without a user,
  // with its time zone), signed up, uploaded a course and took an exam in that same session. The app sent
  // no signed-in app_opened, so the account had no known time zone and was silently skipped every run.
  const install = randomUUID();
  assert.equal((await event(install, 'app_opened', { platform: 'web', authenticated: false, app_language: 'fr', time_zone: 'Africa/Tunis' })).status, 202);
  const u = await newUser();
  const docId = await newCourse(u);
  assert.equal((await event(install, 'course_opened', { document_id: docId, status: 'ready' }, u.token)).status, 202);
  const [linked] = await sql`select count(*)::int as n from analytics_events where user_id = ${u.id} and name = 'app_opened'`;
  assert.equal(linked.n, 0, 'no signed-in app_opened, exactly as in production');

  // 08:30 in Tunis (UTC+1) is 07:30 UTC: due. 06:30 UTC (07:30 there) is not.
  assert.equal((await run(u, at('06:30'))).notDue, 1, 'the device zone is known: not due before 08:00 there');
  const r = await run(u, at('07:30'));
  assert.equal(r.sent, 1, JSON.stringify(r));
  const [mail] = mailsTo(u);
  assert.match(mail!.subject, /^Reprenez là où vous en étiez : /, 'in the app language that install reported (fr)');
  assert.equal(mail!.idempotencyKey, `study-reminder/${u.id}/${localDate(at('07:30'), 'Africa/Tunis')}`);
  assert.equal((await run(u, at('10:00'))).sent, 0, 'still one per local day');
});

test('install fallback: never another install’s zone, never another account’s signed-in event; the account’s own app_opened wins', async () => {
  // An install this account never used (no client event of the account carries its id): ignored.
  const stranger = randomUUID();
  await event(stranger, 'app_opened', { platform: 'web', authenticated: false, time_zone: 'Asia/Tokyo' });
  const u = await newUser();
  await newCourse(u);
  assert.equal((await run(u)).noTimeZone, 1);

  // The same install, but the app_opened belongs to ANOTHER signed-in account: not used for this one.
  const shared = randomUUID();
  const other = await newUser();
  await event(shared, 'app_opened', { platform: 'ios', authenticated: true, time_zone: 'Asia/Tokyo' }, other.token);
  await sql`insert into analytics_events (name, source, user_id, anonymous_id, properties) values ('course_opened', 'client', ${u.id}, ${shared}, '{}'::jsonb)`;
  assert.equal((await run(u)).noTimeZone, 1, 'another account’s event is never borrowed');

  // A signed-out app_opened of an install this account used: its zone is used.
  await event(shared, 'app_opened', { platform: 'ios', authenticated: false, time_zone: 'America/New_York' });
  assert.equal((await run(u, at('11:00'))).notDue, 1, '07:00 in New York');
  // The account's own signed-in app_opened takes precedence over the install fallback.
  await opened(u, { time_zone: 'UTC' });
  assert.equal((await run(u, at('09:00'))).sent, 1);
});

test('each scheduled run’s outcome is logged when it changes (why nobody got an email is visible in the logs)', async () => {
  const when = at('09:00', 2);
  const logged = async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void logs.push(args.join(' '));
    try {
      await reminders.runStudyReminders(when);
    } finally {
      console.log = original;
    }
    return logs.filter((l) => l.startsWith('[study-reminders] run:'));
  };
  const first = await logged(); // sends that day's emails
  const second = await logged(); // nothing left to send: a different outcome, logged
  const third = await logged(); // same outcome again: not repeated every 15 minutes
  assert.equal(first.length, 1);
  assert.match(first[0]!, /account\(s\) with a confirmed address, reminders on and one course: sent \d+, failed \d+, nothing to send \d+, before the local send hour \d+, no known time zone \d+, not eligible \(billing\) \d+\.$/);
  assert.equal(second.length, 1);
  assert.match(second[0]!, /: sent 0, failed 0, nothing to send 0,/);
  assert.equal(third.length, 0);
});
