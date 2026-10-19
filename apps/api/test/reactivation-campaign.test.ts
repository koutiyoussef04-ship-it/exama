/**
 * Reactivation campaign (services/reactivation-campaign.ts): who is eligible and in which audience, every
 * exclusion, send-once guarantees, batching and the daily cap, unsubscribe, click tracking, step 2, delivery
 * sync and suppression, the report, and the wording (all languages, escaped, no offers or prices).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse, DocumentDetail, StudyPlan } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `campaign-owner-${RUN}@example.com`;
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  EMAIL_PROVIDER: 'log',
  WEB_APP_URL: 'https://app.exama.test',
  API_PUBLIC_URL: 'https://api.exama.test',
  OWNER_EMAILS: OWNER_EMAIL,
  CAMPAIGN_SENDER_NAME: 'Exama Test S.L.',
  CAMPAIGN_SENDER_ADDRESS: 'Calle Prueba 1, 28001 Madrid',
  CAMPAIGN_SUPPORT_EMAIL: 'help@exama.test',
  REACTIVATION_CAMPAIGN_SEND: 'true',
});
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { outbox, mailTestHooks } = await import('../src/lib/mailer.js');
const { addDays, localDate } = await import('../src/services/planner/dates.js');
const campaign = await import('../src/services/reactivation-campaign.js');
const emails = await import('../src/services/reactivation-emails.js');
const { resetUnsubscribeRateLimit } = await import('../src/routes/email.js');
const { CAMPAIGN } = campaign;
after(() => sql.end());
beforeEach(() => {
  mailTestHooks.fail = undefined;
  resetUnsubscribeRateLimit();
  campaign.resetClickRateLimit();
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
/** An adult student, confirmed address, registered 30 days ago, never opened the app: eligible by default. */
async function newUser(over: { email?: string } = {}): Promise<U> {
  const email = over.email ?? `campaign-${RUN}-${n++}@example.com`;
  const r = await call<AuthResponse>('/auth/register', send('POST', { email, password: 'password123', name: 'Lina Study', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  await sql`update users set email_verified_at = now(), created_at = now() - interval '30 days' where id = ${r.body.user.id}`;
  return { id: r.body.user.id, token: r.body.token, email };
}
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
async function withPlan(u: U, days = 10) {
  const docId = await newCourse(u);
  const p = await call<StudyPlan>(`/documents/${docId}/study-plan`, send('POST', { examDate: addDays(localDate(new Date(), 'UTC'), days), minutesPerDay: 60, preparedLevel: 'familiar', timezone: 'UTC', studyDays: [0, 1, 2, 3, 4, 5, 6] }, u.token));
  assert.equal(p.status, 201, JSON.stringify(p.body));
  await sql`update study_plans set created_at = now() - interval '20 days' where document_id = ${docId}`;
  return docId;
}
async function opened(u: U, props: { time_zone?: string; app_language?: string } = {}) {
  const r = await call('/events', send('POST', { anonymousId: randomUUID(), events: [{ name: 'app_opened', properties: { platform: 'web', authenticated: true, ...props } }] }, u.token));
  assert.equal(r.status, 202, JSON.stringify(r.body));
}
const audience = (users: U[], over: Partial<Parameters<typeof campaign.selectAudience>[0]> = {}) => campaign.selectAudience({ step: 1, userIds: users.map((u) => u.id), anyTime: true, ...over });
const only = async (u: U, over?: Parameters<typeof audience>[1]) => (await audience([u], over)).eligible[0];
const reasonOf = async (u: U, over?: Parameters<typeof audience>[1]) => {
  const a = await audience([u], over);
  assert.equal(a.eligible.length, 0, 'not eligible');
  return Object.keys(a.excluded)[0];
};
const campaignMails = (u: U) => outbox.filter((m) => m.to === u.email && m.idempotencyKey?.startsWith(`${CAMPAIGN}/`));
const rows = (u: U) => sql`select step, status, attempts, error, provider_message_id, sent_at from email_campaign_sends where user_id = ${u.id} order by step`;
const mock = (u: U, state: string) => call('/billing/mock/state', send('POST', { state }, u.token));
const sendNow = (users: U[], over: Partial<Parameters<typeof campaign.sendBatch>[0]> = {}) =>
  audience(users).then((a) => campaign.sendBatch({ step: 1, batch: campaign.nextBatch(a, 50), limit: 50, maxPerDay: 1_000_000, gapMs: 0, pauseMs: 0, ...over }));

test('audiences: a plan with an upcoming exam, a plan whose exam has passed, a course without a plan, no course at all', async () => {
  const upcoming = await newUser();
  await withPlan(upcoming, 10);
  const passed = await newUser();
  const passedDoc = await withPlan(passed, 10);
  await sql`update study_plans set exam_date = ${addDays(localDate(new Date(), 'UTC'), -3)} where document_id = ${passedDoc}`;
  const course = await newUser();
  const courseDoc = await newCourse(course);
  const empty = await newUser();

  const a = await only(upcoming);
  assert.deepEqual([a?.segment, a?.variant, a?.daysUntilExam], ['has_plan', 'exam_upcoming', 10]);
  assert.match(a!.target, /^\/plan\/[0-9a-f-]{36}$/);
  const b = await only(passed);
  assert.deepEqual([b?.segment, b?.variant, b?.daysUntilExam, b?.target], ['has_plan', 'exam_passed', null, '/']);
  const c = await only(course);
  assert.deepEqual([c?.segment, c?.variant, c?.target], ['no_plan', 'course_ready', `/plan/setup?id=${courseDoc}`]);
  const d = await only(empty);
  assert.deepEqual([d?.segment, d?.variant, d?.target, d?.course], ['no_plan', 'no_course', '/', null]);

  const all = await audience([upcoming, passed, course, empty]);
  assert.equal(all.eligible.length, 4);
  assert.deepEqual(all.excluded, {});
});

test('an exam today is left alone (a "your plan is waiting" email would be silly)', async () => {
  const u = await newUser();
  await withPlan(u, 10);
  await sql`update study_plans set exam_date = ${localDate(new Date(), 'UTC')} where user_id = ${u.id}`;
  assert.equal(await reasonOf(u), 'exam_today');
});

test('every exclusion, each on its own', async () => {
  const unverified = await newUser();
  await sql`update users set email_verified_at = null where id = ${unverified.id}`;
  assert.equal(await reasonOf(unverified), 'not_verified');

  const optedOut = await newUser();
  await sql`update users set study_reminder_emails = false where id = ${optedOut.id}`;
  assert.equal(await reasonOf(optedOut), 'opted_out');

  const suppressed = await newUser();
  await campaign.suppress(suppressed.email.toUpperCase(), 'bounced');
  assert.equal(await reasonOf(suppressed), 'suppressed');

  const minor = await newUser();
  await sql`update users set age_range = '13_17' where id = ${minor.id}`;
  assert.equal(await reasonOf(minor), 'minor_or_unknown_age');
  const noAge = await newUser();
  await sql`update users set age_range = null where id = ${noAge.id}`;
  assert.equal(await reasonOf(noAge), 'minor_or_unknown_age');

  const fresh = await newUser();
  await sql`update users set created_at = now() - interval '1 day' where id = ${fresh.id}`;
  assert.equal(await reasonOf(fresh), 'too_new');

  const active = await newUser();
  await opened(active);
  assert.equal(await reasonOf(active), 'recently_active');
  assert.ok(await only(active, { inactiveDays: 0 }), 'with no inactivity requirement they qualify');

  const reminded = await newUser();
  await sql`insert into study_reminder_emails (user_id, local_date, status) values (${reminded.id}, '2026-01-01', 'sent')`;
  assert.equal(await reasonOf(reminded), 'recently_emailed');

  const owner = await newUser({ email: OWNER_EMAIL });
  assert.equal(await reasonOf(owner), 'owner');

  const trial = await newUser();
  assert.equal((await mock(trial, 'trial')).status, 200);
  assert.equal(await reasonOf(trial), 'current_subscriber');
  const paid = await newUser();
  assert.equal((await mock(paid, 'student_monthly')).status, 200);
  assert.equal(await reasonOf(paid), 'current_subscriber');

  const lapsed = await newUser();
  await mock(lapsed, 'basic_yearly');
  await mock(lapsed, 'expired');
  assert.equal(await reasonOf(lapsed), 'lapsed_subscriber');
  assert.ok(await only(lapsed, { includeLapsed: true }), 'former subscribers can be included on purpose');

  const checkout = await newUser();
  await sql`insert into stripe_customers (user_id, stripe_customer_id) values (${checkout.id}, ${`cus_test_${randomUUID()}`})`;
  assert.equal(await reasonOf(checkout), 'checkout_started');
  assert.equal(await reasonOf(checkout, { includeLapsed: true }), 'checkout_started', 'a started checkout is never included');
});

test('language and send window: app language first, local evening, no time zone → evening in Europe', async () => {
  const u = await newUser();
  await withPlan(u, 10);
  await opened(u, { app_language: 'es', time_zone: 'Europe/Madrid' });
  await sql`update analytics_events set created_at = now() - interval '20 days' where user_id = ${u.id}`;
  const c = await only(u);
  assert.equal(c?.language, 'es');
  assert.equal(c?.timeZone, 'UTC', 'the plan’s own time zone wins over the device’s (like the daily reminders)');
  const noPlan = await newUser();
  const doc = await newCourse(noPlan);
  await sql`update documents set ai_language = 'fr' where id = ${doc}`;
  assert.equal((await only(noPlan))?.language, 'fr', 'the course language when the app never reported one');
  assert.equal((await only(await newUser()))?.language, 'en', 'English when nothing is known');
  const device = await newUser();
  await opened(device, { app_language: 'ar', time_zone: 'Africa/Casablanca' });
  await sql`update analytics_events set created_at = now() - interval '20 days' where user_id = ${device.id}`;
  const d = await only(device);
  assert.deepEqual([d?.language, d?.timeZone], ['ar', 'Africa/Casablanca'], 'no plan: the device’s zone');

  assert.equal(campaign.inSendWindow(new Date('2026-01-15T16:30:00Z'), 'Europe/Madrid'), true, '17:30 in Madrid');
  assert.equal(campaign.inSendWindow(new Date('2026-01-15T09:00:00Z'), 'Europe/Madrid'), false, '10:00 in Madrid');
  assert.equal(campaign.inSendWindow(new Date('2026-01-15T16:30:00Z'), null), true, 'no zone: 16:30 UTC');
  assert.equal(campaign.inSendWindow(new Date('2026-01-15T03:00:00Z'), null), false, 'no zone: 03:00 UTC');
  const late = await audience([u], { anyTime: false, now: new Date(`${localDate(new Date(), 'UTC')}T09:00:00Z`) });
  assert.equal(late.eligible[0]?.dueNow, false);
  assert.equal(campaign.nextBatch(late, 10).length, 0, 'not due: waits for a later run');
});

test('next batch is stable, spread over audiences and languages, and the approval code follows the batch and the wording', async () => {
  const users: U[] = [];
  for (let i = 0; i < 6; i++) {
    const u = await newUser();
    if (i % 2 === 0) await withPlan(u, 10);
    await opened(u, { app_language: i < 3 ? 'es' : 'en', time_zone: 'UTC' });
    await sql`update analytics_events set created_at = now() - interval '20 days' where user_id = ${u.id}`;
    users.push(u);
  }
  const a = await audience(users);
  assert.equal(a.eligible.length, 6);
  const b1 = campaign.nextBatch(a, 4);
  const b2 = campaign.nextBatch(await audience([...users].reverse()), 4);
  assert.deepEqual(b1.map((c) => c.userId), b2.map((c) => c.userId), 'same people whatever the order');
  assert.ok(new Set(b1.map((c) => `${c.segment}|${c.language}`)).size >= 3, 'a first batch mixes audiences and languages');
  const code = campaign.approvalCode(1, b1);
  assert.match(code, /^[0-9A-F]{10}$/);
  assert.equal(campaign.approvalCode(1, b1), code);
  assert.notEqual(campaign.approvalCode(1, campaign.nextBatch(a, 3)), code, 'another batch, another code');
  assert.notEqual(campaign.approvalCode(2, b1), code, 'another step, another code');
});

test('sending: one email per person with unsubscribe, click link and sender identity; never twice, whoever runs it', async () => {
  const withPlanUser = await newUser();
  const doc = await withPlan(withPlanUser, 9);
  await sql`update documents set title = ${'Cell <script>alert(1)</script> biology.pdf'} where id = ${doc}`;
  await opened(withPlanUser, { app_language: 'es', time_zone: 'UTC' });
  await sql`update analytics_events set created_at = now() - interval '20 days' where user_id = ${withPlanUser.id}`;
  const noPlanUser = await newUser();
  const r = await sendNow([withPlanUser, noPlanUser]);
  assert.deepEqual([r.sent, r.failed, r.skipped, r.stopped], [2, 0, 0, undefined]);

  const [m1] = campaignMails(withPlanUser);
  assert.ok(m1);
  assert.match(m1.subject, /^Tu examen de Cell <script>alert\(1\)<\/script> biology es en 9 días/, 'Spanish, from the app language; file extension dropped');
  assert.ok(!m1.html.includes('<script>'), 'titles are escaped in the HTML');
  assert.match(m1.html, /dir="ltr" lang="es"/);
  assert.match(m1.text, /https:\/\/api\.exama\.test\/email\/click\/[0-9a-f-]{36}/);
  assert.match(m1.text, /Exama Test S\.L\., Calle Prueba 1, 28001 Madrid/);
  assert.match(m1.text, /help@exama\.test/);
  assert.match(m1.headers!['List-Unsubscribe']!, /^<https:\/\/api\.exama\.test\/email\/unsubscribe\?token=.+>, <https:\/\/app\.exama\.test\/unsubscribe#token=.+>$/);
  assert.equal(m1.headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepEqual(m1.tags?.map((t) => `${t.name}=${t.value}`), [`campaign=${CAMPAIGN}`, 'segment=has_plan', 'variant=exam_upcoming', 'step=1']);
  assert.equal(m1.idempotencyKey, `${CAMPAIGN}/1/${withPlanUser.id}`);
  assert.match(campaignMails(noPlanUser)[0]!.subject, /^Turn your notes into exams/);

  const before = outbox.length;
  const again = await sendNow([withPlanUser, noPlanUser]);
  assert.equal(again.sent, 0, 'the second run finds nobody');
  // Even a hand-made batch for someone already claimed sends nothing.
  const raw = { userId: withPlanUser.id, email: withPlanUser.email, name: 'Lina', segment: 'has_plan' as const, variant: 'exam_upcoming' as const, language: 'es' as const, timeZone: null, course: 'x', daysUntilExam: 5, target: '/', dueNow: true };
  const hand = await campaign.sendBatch({ step: 1, batch: [raw, raw], limit: 5, maxPerDay: 1_000_000, gapMs: 0, pauseMs: 0 });
  assert.deepEqual([hand.sent, hand.skipped], [0, 2]);
  assert.equal(outbox.length, before, 'no email went out');
  const [row] = await rows(withPlanUser);
  assert.deepEqual([row!.step, row!.status, row!.attempts], [1, 'sent', 1]);
  assert.ok(row!.sent_at);
  const a2 = await audience([withPlanUser, noPlanUser]);
  assert.deepEqual(a2.excluded, { already_sent: 2 });
});

test('a failed send is retried by a later run, three attempts at most; three failures in a row stop the run', async () => {
  const u = await newUser();
  mailTestHooks.fail = (m) => m.to === u.email;
  const r1 = await sendNow([u]);
  assert.deepEqual([r1.sent, r1.failed], [0, 1]);
  assert.deepEqual((await rows(u))[0], { step: 1, status: 'failed', attempts: 1, error: 'error', provider_message_id: null, sent_at: null });
  assert.ok(await only(u), 'still eligible for the retry');
  await sendNow([u]);
  await sendNow([u]);
  assert.equal((await rows(u))[0]!.attempts, 3);
  assert.equal(await reasonOf(u), 'already_sent', 'after the third failure it is not tried again');
  mailTestHooks.fail = undefined;

  const group = [await newUser(), await newUser(), await newUser(), await newUser()];
  mailTestHooks.fail = () => true;
  const stopped = await sendNow(group);
  assert.equal(stopped.stopped, '3 failures in a row');
  assert.equal(stopped.attempted, 3, 'the fourth was never tried');
});

test('batches pause between groups and the daily cap holds across runs', async () => {
  const group = [await newUser(), await newUser(), await newUser(), await newUser(), await newUser()];
  const sleeps: number[] = [];
  const a = await audience(group);
  const batch = campaign.nextBatch(a, 5);
  const r = await campaign.sendBatch({ step: 1, batch, limit: 5, maxPerDay: 1_000_000, batchSize: 2, gapMs: 7, pauseMs: 99, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(r.sent, 5);
  assert.deepEqual(sleeps, [7, 99, 7, 99], 'a pause after every second email, a short gap otherwise, nothing after the last');

  const [{ n: sentToday }] = await sql<{ n: number }[]>`select count(*)::int as n from email_campaign_sends where status = 'sent' and sent_at > now() - interval '24 hours'`;
  const next = [await newUser(), await newUser()];
  const capped = await campaign.sendBatch({ step: 1, batch: campaign.nextBatch(await audience(next), 5), limit: 5, maxPerDay: sentToday + 1, gapMs: 0, pauseMs: 0 });
  assert.equal(capped.sent, 1, 'only what is left under the cap');
  const full = await campaign.sendBatch({ step: 1, batch: campaign.nextBatch(await audience(next), 5), limit: 5, maxPerDay: sentToday + 1, gapMs: 0, pauseMs: 0 });
  assert.equal(full.sent, 0);
  assert.match(full.stopped!, /^daily cap reached/);
});

test('last look before each email: someone who unsubscribed or subscribed since the audience was chosen is skipped', async () => {
  const unsub = await newUser();
  const joined = await newUser();
  const stays = await newUser();
  const a = await audience([unsub, joined, stays]);
  const batch = campaign.nextBatch(a, 10);
  assert.equal(batch.length, 3);
  await sql`update users set study_reminder_emails = false where id = ${unsub.id}`;
  await mock(joined, 'student_monthly');
  const r = await campaign.sendBatch({ step: 1, batch, limit: 10, maxPerDay: 1_000_000, gapMs: 0, pauseMs: 0 });
  assert.deepEqual([r.sent, r.skipped], [1, 2]);
  assert.equal(campaignMails(stays).length, 1);
  assert.equal(campaignMails(unsub).length + campaignMails(joined).length, 0);
});

test('the unsubscribe link of a campaign email works (one click, no sign-in) and keeps them out of step 2', async () => {
  const u = await newUser();
  await sendNow([u]);
  const mail = campaignMails(u)[0]!;
  const oneClick = /<(https:\/\/api\.exama\.test\/email\/unsubscribe\?token=[^>]+)>/.exec(mail.headers!['List-Unsubscribe']!)![1]!;
  const res = await call(oneClick.replace('https://api.exama.test', ''), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 200);
  assert.equal((await sql`select study_reminder_emails as on from users where id = ${u.id}`)[0]!.on, false);
  await sql`update email_campaign_sends set sent_at = now() - interval '9 days' where user_id = ${u.id}`;
  assert.equal(await reasonOf(u, { step: 2 }), 'opted_out');
});

test('click tracking: counted, redirected with the target and UTM tags; scanners and HEAD requests are not people', async () => {
  const u = await newUser();
  const docId = await newCourse(u);
  await sendNow([u]);
  const [{ id: sendId }] = await sql<{ id: string }[]>`select id from email_campaign_sends where user_id = ${u.id}`;
  const get = (id: string, init: RequestInit = {}) => app.request(`/email/click/${id}`, init);

  const person = await get(sendId, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' } });
  assert.equal(person.status, 302);
  assert.equal(person.headers.get('cache-control'), 'no-store');
  const to = new URL(person.headers.get('location')!);
  assert.equal(`${to.origin}${to.pathname}${to.searchParams.get('id') ? `?id=${to.searchParams.get('id')}` : ''}`, `https://app.exama.test/plan/setup?id=${docId}`);
  assert.equal(to.searchParams.get('utm_source'), 'exama_email');
  assert.equal(to.searchParams.get('utm_campaign'), 'reactivation_2026_10');
  assert.equal(to.searchParams.get('utm_content'), 'no_plan_course_ready_s1');
  await get(sendId, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ProofpointURLDefense/1.0)' } });
  await get(sendId, { headers: {} });
  await get(sendId, { method: 'HEAD', headers: { 'user-agent': 'Mozilla/5.0 Safari' } });
  const clicks = await sql<{ suspected_bot: boolean }[]>`select suspected_bot from email_campaign_clicks where send_id = ${sendId} order by created_at`;
  assert.deepEqual(clicks.map((c) => c.suspected_bot), [false, true, true], 'the HEAD request was not counted');

  for (const bad of ['not-a-uuid', randomUUID()]) {
    const r = await get(bad);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://app.exama.test/', 'old or mistyped links still land in the app');
  }
});

test('step 2: once, 5+ days later, only for people who did not come back, click or make a plan', async () => {
  const quiet = await newUser();
  const returned = await newUser();
  const clicker = await newUser();
  const maker = await newUser();
  const recent = await newUser();
  const people = [quiet, returned, clicker, maker, recent];
  await sendNow(people);
  const sentDaysAgo = async (u: U, days: number) => void (await sql`update email_campaign_sends set sent_at = now() - ${`${days} days`}::interval where user_id = ${u.id}`);
  for (const u of [quiet, returned, clicker, maker]) await sentDaysAgo(u, 6);
  await sentDaysAgo(recent, 2);
  await opened(returned);
  const [{ id: clickId }] = await sql<{ id: string }[]>`select id from email_campaign_sends where user_id = ${clicker.id}`;
  await app.request(`/email/click/${clickId}`, { headers: { 'user-agent': 'Mozilla/5.0 Safari' } });
  await withPlan(maker, 10);
  await sql`update study_plans set created_at = now() where user_id = ${maker.id}`;

  const a2 = await audience(people, { step: 2 });
  assert.deepEqual(a2.eligible.map((c) => c.userId), [quiet.id]);
  assert.deepEqual(a2.excluded, { returned_after_step1: 1, clicked_after_step1: 1, converted_after_step1: 1, too_soon_for_step2: 1 });
  const r = await campaign.sendBatch({ step: 2, batch: campaign.nextBatch(a2, 5), limit: 5, maxPerDay: 1_000_000, gapMs: 0, pauseMs: 0 });
  assert.equal(r.sent, 1);
  const mails = campaignMails(quiet);
  assert.equal(mails.length, 2);
  assert.notEqual(mails[0]!.subject, mails[1]!.subject);
  assert.match(mails[1]!.subject, /^One upload is all it takes/);
  assert.equal((await audience([quiet], { step: 2 })).excluded.already_sent, 1);
  assert.equal(await reasonOf(await newUser(), { step: 2 }), 'step1_missing');
});

test('delivery status is read back from Resend; bounces and complaints are suppressed from then on', async () => {
  const delivered = await newUser();
  const bounced = await newUser();
  const complained = await newUser();
  await sendNow([delivered, bounced, complained]);
  const ids = new Map<string, string>();
  for (const [u, event] of [[delivered, 'delivered'], [bounced, 'bounced'], [complained, 'complained']] as const) {
    const id = `re_${randomUUID()}`;
    await sql`update email_campaign_sends set provider_message_id = ${id} where user_id = ${u.id}`;
    ids.set(id, event);
  }
  const saved = [config.EMAIL_PROVIDER, config.RESEND_API_KEY] as const;
  (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = 'resend';
  (config as { RESEND_API_KEY?: string }).RESEND_API_KEY = 're_test_key';
  try {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`);
      const event = ids.get(decodeURIComponent(url.split('/').pop()!));
      return new Response(JSON.stringify({ last_event: event }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await campaign.syncDelivery({ fetchImpl, sleep: async () => {} });
    assert.equal(r.updated, 3);
    assert.equal(r.suppressed, 2);
    assert.ok(calls.every((c) => c.startsWith('https://api.resend.com/emails/re_') && c.endsWith('Bearer re_test_key')));
  } finally {
    (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = saved[0];
    (config as { RESEND_API_KEY?: string }).RESEND_API_KEY = saved[1];
  }
  assert.equal(await reasonOf(bounced), 'suppressed', 'a bounced address is out before anything else');
  const sup = await sql`select email, reason from email_suppressions where email in (${bounced.email.toLowerCase()}, ${complained.email.toLowerCase()}) order by reason`;
  assert.deepEqual(sup.map((s) => s.reason), ['bounced', 'complained']);
  await sql`delete from email_campaign_sends where user_id = ${bounced.id}`;
  assert.equal(await reasonOf(bounced), 'suppressed', 'a bounced address is never mailed again');
  const rep = await campaign.campaignReport(14);
  const step1 = rep.filter((x) => x.step === 1).reduce((s, x) => ({ delivered: s.delivered + x.delivered, bounced: s.bounced + x.bounced, complained: s.complained + x.complained }), { delivered: 0, bounced: 0, complained: 0 });
  assert.ok(step1.delivered >= 1 && step1.complained >= 1);
});

test('the report counts returns, plans, clicks and unsubscribes after the email', async () => {
  const u = await newUser();
  const docId = await newCourse(u);
  await sendNow([u]);
  const [{ id: sendId }] = await sql<{ id: string }[]>`select id from email_campaign_sends where user_id = ${u.id}`;
  await sql`update email_campaign_sends set sent_at = now() - interval '3 days' where id = ${sendId}`;
  const before = await campaign.campaignReport(14);
  await app.request(`/email/click/${sendId}`, { headers: { 'user-agent': 'Mozilla/5.0 Safari' } });
  await opened(u);
  const plan = await call<StudyPlan>(`/documents/${docId}/study-plan`, send('POST', { examDate: addDays(localDate(new Date(), 'UTC'), 10), minutesPerDay: 60, preparedLevel: 'familiar', timezone: 'UTC', studyDays: [0, 1, 2, 3, 4, 5, 6] }, u.token));
  assert.equal(plan.status, 201);
  await sql`update users set study_reminder_emails = false where id = ${u.id}`;
  const after = await campaign.campaignReport(14);
  const sum = (rows: typeof after, k: 'sent' | 'clicked' | 'returned' | 'planCreated' | 'unsubscribed') => rows.filter((r) => r.segment === 'no_plan' && r.step === 1).reduce((s, r) => s + r[k], 0);
  assert.equal(sum(after, 'sent') - sum(before, 'sent'), 0);
  for (const k of ['clicked', 'returned', 'planCreated', 'unsubscribed'] as const) assert.equal(sum(after, k) - sum(before, k), 1, k);
});

test('readiness: sending is locked until the sender identity, public API address and the send switch are in place', async () => {
  const ok = campaign.preflight();
  assert.deepEqual(ok.blockers, []);
  assert.ok(campaign.senderIdentity());
  const saved = { ...process.env };
  try {
    delete process.env.CAMPAIGN_SENDER_ADDRESS;
    delete process.env.REACTIVATION_CAMPAIGN_SEND;
    const blocked = campaign.preflight();
    assert.equal(blocked.blockers.length, 2);
    assert.ok(blocked.blockers.some((b) => /Sender identity missing/.test(b)));
    assert.ok(blocked.blockers.some((b) => /locked/.test(b)));
    assert.equal(campaign.senderIdentity(), null);
    const r = await campaign.sendBatch({ step: 1, batch: [], limit: 1, maxPerDay: 1 });
    assert.equal(r.stopped, 'not configured', 'the service itself refuses without a sender identity');
  } finally {
    Object.assign(process.env, saved);
  }
  assert.equal(campaign.maskEmail('student.name@university.edu'), 's***@u***.edu');
});

test('wording: every language, audience and step renders; right-to-left for Arabic; escaped; no prices, trials or offers', () => {
  const sender = { name: 'Exama <b>Test</b>', address: 'Calle 1', supportEmail: 'help@exama.test' };
  const banned = /(€|\$|£|%|\btrial\b|\bfree\b|\bdiscount\b|\bpromo|gratis|gratuit|descuento|prueba gratuita|essai|réduction|مجان|خصم|عرض خاص)/i;
  let count = 0;
  for (const step of [1, 2] as const)
    for (const variant of emails.VARIANTS)
      for (const language of emails.LANGS) {
        const mail = emails.buildCampaignEmail({
          to: 'a@b.test',
          name: '<i>Alex</i> Smith',
          language,
          step,
          variant,
          course: variant === 'no_course' ? null : 'Cell "biology" <b>I</b>.pdf',
          daysUntilExam: variant === 'exam_upcoming' ? 1 : null,
          ctaUrl: 'https://api.exama.test/email/click/x',
          unsubscribeUrl: 'https://app.exama.test/unsubscribe#token=t',
          oneClickUrl: null,
          sender,
        });
        count++;
        const where = `${step}/${variant}/${language}`;
        assert.ok(mail.subject.length > 8 && mail.subject.length <= 110, `${where} subject length ${mail.subject.length}`);
        assert.ok(!banned.test(mail.subject) && !banned.test(mail.text), `${where}: no prices, trials or offers`);
        assert.ok(!mail.html.includes('<b>') && !mail.html.includes('<i>'), `${where}: escaped`);
        assert.ok(mail.html.includes(language === 'ar' ? 'dir="rtl"' : 'dir="ltr"'), where);
        assert.ok(mail.text.includes('https://api.exama.test/email/click/x') && mail.text.includes('https://app.exama.test/unsubscribe#token=t'), where);
        assert.ok(mail.text.includes('Calle 1') && mail.text.includes('help@exama.test'), `${where}: sender named`);
        assert.equal(mail.headers!['List-Unsubscribe'], '<https://app.exama.test/unsubscribe#token=t>');
        assert.ok(!/undefined|NaN|\{|\}/.test(mail.subject + mail.text), `${where}: no leftovers`);
        if (variant === 'exam_upcoming') assert.ok(/mañana|tomorrow|demain|غدًا/.test(mail.subject + mail.text), `${where}: tomorrow`);
      }
  assert.equal(count, 32);
  assert.equal(emails.courseLabel('  Química   orgánica\n.pdf '), 'Química orgánica');
  assert.equal(emails.courseLabel('x'.repeat(80)).length, 48);
});
