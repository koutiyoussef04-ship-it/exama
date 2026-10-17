/**
 * Daily study-plan reminder emails: who gets one (plan, confirmed address, no subscription or trial,
 * reminders on), content from the stored plan only (no AI), local time zone, one per local day even with
 * retries and overlapping runs, unsubscribe (one-click + page + preferences), and missing email config.
 */
import assert from 'node:assert/strict';
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
async function withPlan(u: U, over: Record<string, unknown> = {}) {
  const form = new FormData();
  form.append('file', new File([pdf], 'biology-notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token: u.token });
  for (let i = 0; i < 60; i++) {
    if ((await call<DocumentDetail>(`/documents/${up.body.id}`, { token: u.token })).body.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const tz = (over.timezone as string) ?? 'UTC';
  const p = await call<StudyPlan>(`/documents/${up.body.id}/study-plan`, send('POST', { examDate: addDays(localDate(new Date(), tz), 10), minutesPerDay: 60, preparedLevel: 'familiar', timezone: tz, studyDays: [0, 1, 2, 3, 4, 5, 6], ...over }, u.token));
  assert.equal(p.status, 201, JSON.stringify(p.body));
  return { docId: up.body.id, plan: p.body };
}
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

test('subscribers (paid plan or trial) are excluded by the server entitlement', async () => {
  for (const state of ['student_monthly', 'trial', 'basic_yearly'] as const) {
    const u = await newUser();
    await withPlan(u);
    assert.equal((await call('/billing/mock/state', send('POST', { state }, u.token))).status, 200);
    const r = await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
    assert.equal(r.subscribers, 1, state);
    assert.equal(mailsTo(u).length, 0, state);
    assert.equal((await rows(u)).length, 0, `${state}: nothing claimed`);
    // The subscription ends → the next run sends.
    await call('/billing/mock/state', send('POST', { state: 'expired' }, u.token));
    const next = await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] });
    assert.equal(next.sent, 1, `${state} → expired`);
  }
});

test('no plan, unconfirmed address, or reminders off → no email', async () => {
  const noPlan = await newUser();
  const unverified = await newUser(false);
  await withPlan(unverified);
  const off = await newUser();
  await withPlan(off);
  await call('/email/preferences', send('PATCH', { studyReminders: false }, off.token));
  const r = await reminders.runStudyReminders(at('09:00'), { userIds: [noPlan.id, unverified.id, off.id] });
  assert.equal(r.sent, 0);
  for (const u of [noPlan, unverified, off]) {
    assert.equal(mailsTo(u).length, 0);
    assert.equal((await rows(u)).length, 0);
  }
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
  assert.equal(reminders.reminderZone([{ timezone: 'Not/AZone', updatedAt: new Date() }]), 'UTC', 'invalid zone → UTC');
});

test('the email follows the plan language (en, es, fr, ar; Arabic right-to-left)', async () => {
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
  assert.deepEqual(p.body, { studyReminders: true, available: true, emailVerified: true, sentToThisAccount: true });
  assert.equal((await call('/email/preferences', send('PATCH', { studyReminders: 'yes' }, u.token))).status, 400);
  await call('/email/preferences', send('PATCH', { studyReminders: false }, u.token));
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 0);
  const on = await call<EmailPreferences>('/email/preferences', send('PATCH', { studyReminders: true }, u.token));
  assert.equal(on.body.studyReminders, true);
  assert.equal((await reminders.runStudyReminders(at('09:00'), { userIds: [u.id] })).sent, 1);
  await call('/billing/mock/state', send('POST', { state: 'student_monthly' }, u.token));
  assert.equal((await call<EmailPreferences>('/email/preferences', { token: u.token })).body.sentToThisAccount, false);
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
