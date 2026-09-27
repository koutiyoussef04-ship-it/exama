/**
 * Monetization: plan limits, the controlled free trial, premium/pro access, cancellation/restore,
 * expiry, plan changes, owner access, and that nothing client-side can grant access.
 * Uses the development mock provider (no payments) and the default plan limits.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AuthResponse, BillingCatalog, DocumentDetail, Entitlement, Exam, LimitErrorBody } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `owner-${RUN}@example.com`;
const OWNER_ID = crypto.randomUUID();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  OWNER_EMAILS: ` Someone-Else@example.com , ${OWNER_EMAIL.toUpperCase()} `,
  OWNER_USER_IDS: OWNER_ID,
});
delete process.env.PLAN_LIMITS_OVERRIDE;

const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { LIMITS, DEFAULT_LIMITS } = await import('../src/billing/limits.js');

after(() => sql.end());

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const post = (body: unknown, token?: string) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

let n = 0;
async function newUser(email = `billing-${RUN}-${n++}@example.com`) {
  const r = await call<AuthResponse>('/auth/register', post({ email, password: 'password123', name: 'Tester' }));
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id, email };
}
async function login(email: string) {
  const r = await call<AuthResponse>('/auth/login', post({ email, password: 'password123' }));
  assert.equal(r.status, 200);
  return r.body.token;
}
const del = (token: string, docId: string) => call(`/documents/${docId}`, { method: 'DELETE', token });
const status = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body;
const setState = (token: string, state: string) => call<Entitlement>('/billing/mock/state', post({ state }, token));
const purchase = (token: string, planId: string, startTrial = false) => call<Entitlement>('/billing/purchase', post({ planId, startTrial }, token));

async function upload(token: string) {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  return call<DocumentDetail & LimitErrorBody>('/documents', { method: 'POST', body: form, token });
}
async function readyCourse(token: string) {
  const up = await upload(token);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 50; i++) {
    const d = await call<DocumentDetail>(`/documents/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body.id;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('not ready');
}
const exam = (token: string, docId: string, questionCount: number, kind = 'standard') =>
  call<Exam & LimitErrorBody>(`/documents/${docId}/exams`, post({ kind, questionCount }, token));
async function failExam(token: string, e: Exam) {
  const answers = e.questions.map((q) => ({ questionId: q.id, answer: 'wrong' }));
  assert.equal((await call(`/exams/${e.id}/submit`, post({ answers }, token))).status, 200);
}
async function events(userId: string) {
  await flushAnalytics();
  return (await sql`select name, properties from analytics_events where user_id = ${userId} order by created_at`) as unknown as { name: string; properties: Record<string, unknown> }[];
}

let ownerEmailUser: { token: string; id: string };
before(async () => {
  ownerEmailUser = await newUser(OWNER_EMAIL);
});

test('catalog: public, with prices, trial and per-tier limits', async () => {
  const r = await call<BillingCatalog>('/billing/plans');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.plans.map((p) => [p.id, p.priceCents]),
    [['basic_monthly', 999], ['basic_yearly', 7999], ['student_monthly', 1499], ['student_yearly', 11999], ['pro_monthly', 2499], ['pro_yearly', 19999]],
  );
  assert.equal(r.body.recommendedPlanId, 'student_monthly');
  assert.deepEqual(Object.keys(r.body.limits), ['free', 'trial', 'basic', 'student', 'pro']);
  assert.deepEqual(r.body.features.basic, { lectures: false, adaptivePractice: false, weakTopicAnalysis: false, adaptivePlanner: false });
  assert.deepEqual(r.body.features.student, { lectures: true, adaptivePractice: true, weakTopicAnalysis: true, adaptivePlanner: true });
  assert.equal(r.body.trialDays, 7);
  assert.equal(r.body.purchasesAvailable, true);
  assert.equal(r.body.testMode, true);
  assert.equal(r.body.limits.free.courses, 1);
  assert.deepEqual(r.body.limits.trial, { courses: 1, courseUploadsPerMonth: 1, examGenerationsPerMonth: 1, practiceQuestionsPerMonth: 5, maxQuestionsPerExam: 8, studyPlansPerMonth: 1, mediaUploadsPerMonth: 1, mediaMinutesPerMonth: 30, maxMediaMinutesPerFile: 30 });
  assert.ok(JSON.stringify(r.body).toLowerCase().indexOf('owner') === -1, 'catalog must not mention owner access');
});

test('free user: 1 course, monthly upload/exam/practice caps, exam length, with 402 details', async () => {
  const { token, id } = await newUser();
  const s = await status(token);
  assert.deepEqual([s.tier, s.status, s.isPremium, s.trialEligible], ['free', 'free', false, true]);

  const docId = await readyCourse(token);
  const second = await upload(token);
  assert.equal(second.status, 402);
  assert.deepEqual([second.body.code, second.body.feature, second.body.limit, second.body.used, second.body.tier], ['limit_reached', 'courses', 1, 1, 'free']);

  // Deleting and re-uploading still counts against the monthly upload allowance.
  let current = docId;
  for (let i = 1; i < LIMITS.free.courseUploadsPerMonth!; i++) {
    assert.equal((await call(`/documents/${current}`, { method: 'DELETE', token })).status, 204);
    current = await readyCourse(token);
  }
  assert.equal((await call(`/documents/${current}`, { method: 'DELETE', token })).status, 204);
  const overUploads = await upload(token);
  assert.equal(overUploads.status, 402);
  assert.equal(overUploads.body.feature, 'course_uploads');

  // Exams: premium-only length, then the monthly cap.
  // (Simulate a new month for uploads so we can test the exam caps on a fresh course.)
  await sql`delete from usage_ledger where user_id = ${id} and kind = 'course_upload'`;
  const d2 = await readyCourse(token);
  const tooLong = await exam(token, d2, LIMITS.free.maxQuestionsPerExam + 1);
  assert.equal(tooLong.status, 402);
  assert.deepEqual([tooLong.body.code, tooLong.body.feature], ['premium_required', 'exam_length']);

  let last: Exam | undefined;
  for (let i = 0; i < LIMITS.free.examGenerationsPerMonth!; i++) {
    const e = await exam(token, d2, 4);
    assert.equal(e.status, 201);
    last = e.body;
  }
  const overExams = await exam(token, d2, 4);
  assert.equal(overExams.status, 402);
  assert.equal(overExams.body.feature, 'exam_generations');

  // Practice: allowance is in questions; the last set is trimmed to what's left.
  await failExam(token, last!);
  const p1 = await exam(token, d2, 8, 'follow_up');
  assert.equal(p1.status, 201);
  assert.equal(p1.body.questions.length, 8);
  const p2 = await exam(token, d2, 8, 'follow_up');
  assert.equal(p2.status, 201);
  assert.equal(p2.body.questions.length, LIMITS.free.practiceQuestionsPerMonth! - 8, 'trimmed to remaining allowance');
  const p3 = await exam(token, d2, 6, 'follow_up');
  assert.equal(p3.status, 402);
  assert.equal(p3.body.feature, 'practice_questions');

  const after = await status(token);
  assert.equal(after.usage.examGenerationsThisMonth, LIMITS.free.examGenerationsPerMonth);
  assert.equal(after.usage.practiceQuestionsThisMonth, LIMITS.free.practiceQuestionsPerMonth);

  // Existing course data stays readable even when over limits.
  assert.equal((await call(`/documents/${d2}`, { token })).status, 200);

  // Parallel uploads can't exceed the course cap either (checked in the same transaction as the insert).
  const racer = await newUser();
  const both = await Promise.all([upload(racer.token), upload(racer.token)]);
  assert.deepEqual(both.map((u) => u.status).sort(), [201, 402]);
});

test('trial: its own tier and limits (never Student/Pro), 7 days, once per account', async () => {
  const { token, id } = await newUser();
  const r = await purchase(token, 'pro_monthly', true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.status, r.body.tier, r.body.isPremium, r.body.trialEligible, r.body.usagePeriod], ['trialing', 'trial', false, false, 'trial']);
  const days = (new Date(r.body.trialEndsAt!).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days <= 7, `trial length ${days}`);
  assert.deepEqual(r.body.limits, { courses: 1, courseUploadsPerMonth: 1, examGenerationsPerMonth: 1, practiceQuestionsPerMonth: 5, maxQuestionsPerExam: 8, studyPlansPerMonth: 1, mediaUploadsPerMonth: 1, mediaMinutesPerMonth: 30, maxMediaMinutesPerFile: 30 });
  assert.deepEqual(r.body.limits, LIMITS.trial);
  assert.notDeepEqual(r.body.limits, LIMITS.student);
  assert.equal(r.body.usageResetsAt, r.body.trialEndsAt, 'trial usage never resets during the trial');

  assert.equal((await purchase(token, 'student_monthly', true)).status, 409, 'no second trial');
  // Trial → paid conversion: now the paid plan's limits apply.
  const paid = await purchase(token, 'pro_monthly');
  assert.deepEqual([paid.body.status, paid.body.tier, paid.body.isPremium, paid.body.limits], ['active', 'pro', true, LIMITS.pro]);

  const ev = await events(id);
  assert.deepEqual(ev.find((e) => e.name === 'trial_started')?.properties, { plan_id: 'pro_monthly', tier: 'pro', period: 'monthly', provider: 'mock', environment: 'test' });
  assert.equal(ev.find((e) => e.name === 'subscription_started')?.properties.from_trial, true);
});

test('trial: exactly 1 upload, 1 exam of ≤ 8 questions, 5 practice questions — then 402 (paywall)', async () => {
  const { token, id, email } = await newUser();
  await purchase(token, 'student_monthly', true);

  // 1 course / 1 upload.
  const docId = await readyCourse(token);
  const second = await upload(token);
  assert.equal(second.status, 402);
  assert.deepEqual([second.body.code, second.body.feature, second.body.limit, second.body.used, second.body.tier], ['limit_reached', 'courses', 1, 1, 'trial']);
  assert.match(second.body.error, /free trial/);

  // Exam length is capped at 8 questions.
  const tooLong = await exam(token, docId, 9);
  assert.equal(tooLong.status, 402);
  assert.deepEqual([tooLong.body.code, tooLong.body.feature, tooLong.body.limit, tooLong.body.tier], ['premium_required', 'exam_length', 8, 'trial']);

  // Exactly 1 exam (of 8 questions).
  const first = await exam(token, docId, 8);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.questions.length, 8);
  const again = await exam(token, docId, 3);
  assert.equal(again.status, 402);
  assert.deepEqual([again.body.feature, again.body.limit, again.body.used, again.body.tier], ['exam_generations', 1, 1, 'trial']);

  // Exactly 5 practice questions: the app asks for 6 and gets 5; then nothing more.
  await failExam(token, first.body);
  const practice = await exam(token, docId, 6, 'follow_up');
  assert.equal(practice.status, 201, JSON.stringify(practice.body));
  assert.equal(practice.body.questions.length, 5);
  const morePractice = await exam(token, docId, 3, 'follow_up');
  assert.equal(morePractice.status, 402);
  assert.deepEqual([morePractice.body.feature, morePractice.body.limit, morePractice.body.used], ['practice_questions', 5, 5]);

  const s = await status(token);
  assert.deepEqual(
    [s.usage.courses, s.usage.courseUploadsThisMonth, s.usage.examGenerationsThisMonth, s.usage.practiceQuestionsThisMonth],
    [1, 1, 1, 5],
  );

  // Deleting the course gives nothing back: no new upload, and usage is unchanged.
  assert.equal((await del(token, docId)).status, 204);
  const reupload = await upload(token);
  assert.equal(reupload.status, 402);
  assert.deepEqual([reupload.body.feature, reupload.body.used], ['course_uploads', 1]);
  const afterDelete = await status(token);
  assert.deepEqual(
    [afterDelete.usage.courses, afterDelete.usage.courseUploadsThisMonth, afterDelete.usage.examGenerationsThisMonth, afterDelete.usage.practiceQuestionsThisMonth],
    [0, 1, 1, 5],
  );

  // Signing in again (new session/token, e.g. after reinstalling the app) changes nothing.
  const token2 = await login(email);
  const relogged = await status(token2);
  assert.deepEqual([relogged.tier, relogged.status, relogged.usage, relogged.trialEndsAt], ['trial', 'trialing', afterDelete.usage, afterDelete.trialEndsAt]);
  assert.equal((await upload(token2)).status, 402);

  // Cancelling keeps the trial's (small) limits until it ends — it never unlocks a paid tier.
  const cancelled = (await call<Entitlement>('/billing/cancel', post({}, token2))).body;
  assert.deepEqual([cancelled.status, cancelled.tier, cancelled.limits, cancelled.usagePeriod], ['cancelled', 'trial', LIMITS.trial, 'trial']);
  assert.equal((await purchase(token2, 'student_monthly', true)).status, 409, 'no new trial after cancelling');

  // Server-side ledger holds the usage: exactly what the trial allows.
  const ledger = await sql`select kind, sum(amount)::int as total from usage_ledger where user_id = ${id} group by kind order by kind`;
  assert.deepEqual(ledger.map((r) => [r.kind, r.total]), [['course_upload', 1], ['exam_generation', 1], ['practice_questions', 5]]);
});

test('trial: parallel requests cannot slip past a limit', async () => {
  const { token, id } = await newUser();
  await purchase(token, 'student_monthly', true);
  const uploads = await Promise.all([upload(token), upload(token), upload(token)]);
  assert.deepEqual(uploads.map((u) => u.status).sort(), [201, 402, 402]);
  const docId = uploads.find((u) => u.status === 201)!.body.id;
  for (let i = 0; i < 50 && (await call<DocumentDetail>(`/documents/${docId}`, { token })).body.status !== 'ready'; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const exams = await Promise.all([exam(token, docId, 8), exam(token, docId, 8), exam(token, docId, 8)]);
  assert.deepEqual(exams.map((e) => e.status).sort(), [201, 402, 402]);
  await failExam(token, exams.find((e) => e.status === 201)!.body);
  const practice = await Promise.all([exam(token, docId, 5, 'follow_up'), exam(token, docId, 5, 'follow_up'), exam(token, docId, 5, 'follow_up')]);
  assert.deepEqual(practice.map((p) => p.status).sort(), [201, 402, 402]);
  const [{ total }] = await sql`select coalesce(sum(amount), 0)::int as total from usage_ledger where user_id = ${id} and kind = 'practice_questions'`;
  assert.equal(total, 5);
});

test('trial: expiry ends trial access; the trial can never be started again', async () => {
  const { token, id } = await newUser();
  await purchase(token, 'student_monthly', true);
  await sql`update subscriptions set trial_ends_at = now() - interval '1 minute', current_period_ends_at = now() - interval '1 minute' where user_id = ${id}`;
  const s = await status(token);
  assert.deepEqual([s.status, s.tier, s.isPremium, s.trialEligible, s.trialEnded, s.usagePeriod], ['expired', 'free', false, false, true, 'month']);
  assert.equal((await purchase(token, 'student_monthly', true)).status, 409, 'no second trial after expiry');
  // Even the test-mode "reset to free" keeps the trial used.
  const reset = (await setState(token, 'free')).body;
  assert.deepEqual([reset.status, reset.trialEligible], ['free', false]);
  assert.equal((await purchase(token, 'pro_yearly', true)).status, 409, 'no second trial after a reset');
  // Paying is still possible, with the full paid limits.
  const paid = (await purchase(token, 'student_monthly')).body;
  assert.deepEqual([paid.status, paid.tier, paid.limits, paid.trialEnded], ['active', 'student', LIMITS.student, false]);
});

test('paid Basic, Student and Pro limits are unchanged by the trial', () => {
  assert.deepEqual(DEFAULT_LIMITS.basic, { courses: 8, courseUploadsPerMonth: 10, examGenerationsPerMonth: 15, practiceQuestionsPerMonth: 120, maxQuestionsPerExam: 12, studyPlansPerMonth: 3, mediaUploadsPerMonth: 0, mediaMinutesPerMonth: 0, maxMediaMinutesPerFile: 0 });
  assert.deepEqual(DEFAULT_LIMITS.student, { courses: 15, courseUploadsPerMonth: 30, examGenerationsPerMonth: 40, practiceQuestionsPerMonth: 300, maxQuestionsPerExam: 15, studyPlansPerMonth: 10, mediaUploadsPerMonth: 30, mediaMinutesPerMonth: 300, maxMediaMinutesPerFile: 120 });
  assert.deepEqual(DEFAULT_LIMITS.pro, { courses: 50, courseUploadsPerMonth: 100, examGenerationsPerMonth: 150, practiceQuestionsPerMonth: 1200, maxQuestionsPerExam: 20, studyPlansPerMonth: 30, mediaUploadsPerMonth: 80, mediaMinutesPerMonth: 720, maxMediaMinutesPerFile: 180 });
  assert.deepEqual(LIMITS.basic, DEFAULT_LIMITS.basic);
  assert.deepEqual(LIMITS.student, DEFAULT_LIMITS.student);
  assert.deepEqual(LIMITS.pro, DEFAULT_LIMITS.pro);
});

test('student (premium) access: higher limits, second course, longer exams', async () => {
  const { token } = await newUser();
  const s = (await purchase(token, 'student_yearly')).body;
  assert.deepEqual([s.status, s.tier, s.isPremium, s.willRenew], ['active', 'student', true, true]);
  const months = (new Date(s.currentPeriodEndsAt!).getTime() - Date.now()) / (30 * 86_400_000);
  assert.ok(months > 11.9, 'yearly period');
  assert.deepEqual(s.limits, LIMITS.student);

  const d1 = await readyCourse(token);
  await readyCourse(token); // second course allowed
  assert.equal((await exam(token, d1, LIMITS.student.maxQuestionsPerExam)).status, 201);
  assert.equal((await exam(token, d1, LIMITS.student.maxQuestionsPerExam + 1)).status, 402);
});

test('pro access: highest limits, longest exams', async () => {
  const { token } = await newUser();
  const s = (await purchase(token, 'pro_monthly')).body;
  assert.deepEqual([s.tier, s.limits], ['pro', LIMITS.pro]);
  assert.ok(LIMITS.pro.practiceQuestionsPerMonth! > LIMITS.student.practiceQuestionsPerMonth!);
  assert.ok(LIMITS.pro.examGenerationsPerMonth! > LIMITS.student.examGenerationsPerMonth!);
  const d = await readyCourse(token);
  assert.equal((await exam(token, d, 20)).status, 201);
});

test('plan changes: upgrade, downgrade, period switch; same plan is rejected', async () => {
  const { token, id } = await newUser();
  await purchase(token, 'student_monthly');
  const up = (await purchase(token, 'pro_yearly')).body;
  assert.deepEqual([up.tier, up.planId], ['pro', 'pro_yearly']);
  const down = (await purchase(token, 'student_yearly')).body;
  assert.deepEqual([down.tier, down.planId, down.limits], ['student', 'student_yearly', LIMITS.student]);
  assert.equal((await purchase(token, 'student_yearly')).status, 409);
  assert.equal((await purchase(token, 'lifetime_free')).status, 400);

  const started = (await events(id)).filter((e) => e.name === 'subscription_started').map((e) => e.properties);
  assert.deepEqual(
    started.map((p) => [p.plan_id, p.previous_plan_id ?? null, p.tier, p.period, p.change]),
    [
      ['student_monthly', null, 'student', 'monthly', 'new'],
      ['pro_yearly', 'student_monthly', 'pro', 'yearly', 'upgrade'],
      ['student_yearly', 'pro_yearly', 'student', 'yearly', 'downgrade'],
    ],
  );
});

test('cancel keeps access until period end; restore resumes renewal', async () => {
  const { token, id } = await newUser();
  await purchase(token, 'student_monthly');
  const cancelled = (await call<Entitlement>('/billing/cancel', post({}, token))).body;
  assert.deepEqual([cancelled.status, cancelled.isPremium, cancelled.willRenew, cancelled.tier], ['cancelled', true, false, 'student']);
  assert.equal((await call('/billing/cancel', post({}, token))).status, 409);
  const restored = (await call<Entitlement>('/billing/restore', post({}, token))).body;
  assert.deepEqual([restored.status, restored.willRenew], ['active', true]);
  const names = (await events(id)).map((e) => e.name);
  assert.ok(names.includes('subscription_cancelled') && names.includes('subscription_restored'));
});

test('expired subscription and expired trial fall back to free limits (event recorded once)', async () => {
  const paid = await newUser();
  await readyCourse(paid.token);
  await purchase(paid.token, 'student_monthly');
  await readyCourse(paid.token); // 2 courses while premium
  await sql`update subscriptions set current_period_ends_at = now() - interval '1 minute' where user_id = ${paid.id}`;
  const s = await status(paid.token);
  await status(paid.token); // second read must not re-emit
  assert.deepEqual([s.status, s.tier, s.isPremium, s.limits], ['expired', 'free', false, LIMITS.free]);
  assert.equal((await upload(paid.token)).status, 402, 'over the free course cap again');
  assert.equal((await call<DocumentDetail[]>('/documents', { token: paid.token })).body.length, 2, 'existing courses kept');
  const expired = (await events(paid.id)).filter((e) => e.name === 'subscription_expired');
  assert.equal(expired.length, 1);
  assert.equal(expired[0].properties.was_trial, false);
  assert.equal(s.trialEnded, false);
  assert.equal((await call('/billing/restore', post({}, paid.token))).status, 404, 'nothing to restore after expiry');

  const trial = await newUser();
  await purchase(trial.token, 'student_monthly', true);
  await sql`update subscriptions set trial_ends_at = now() - interval '1 minute', current_period_ends_at = now() - interval '1 minute' where user_id = ${trial.id}`;
  const t = await status(trial.token);
  assert.deepEqual([t.status, t.tier, t.trialEligible, t.trialEnded], ['expired', 'free', false, true]);
  assert.equal((await events(trial.id)).find((e) => e.name === 'subscription_expired')?.properties.was_trial, true);

  const viaTool = await newUser();
  assert.deepEqual([(await setState(viaTool.token, 'expired')).body.status], ['expired']);
});

test('mock state tool covers every state', async () => {
  const { token } = await newUser();
  const expected: Record<string, [string, string, boolean]> = {
    free: ['free', 'free', false],
    trial: ['trialing', 'trial', false],
    basic_monthly: ['active', 'basic', true],
    basic_yearly: ['active', 'basic', true],
    student_monthly: ['active', 'student', true],
    student_yearly: ['active', 'student', true],
    pro_monthly: ['active', 'pro', true],
    pro_yearly: ['active', 'pro', true],
    expired: ['expired', 'free', false],
  };
  for (const [state, want] of Object.entries(expected)) {
    const r = await setState(token, state);
    assert.equal(r.status, 200, state);
    assert.deepEqual([r.body.status, r.body.tier, r.body.isPremium], want, state);
  }
  const reset = (await setState(token, 'free')).body;
  assert.deepEqual([reset.status, reset.trialEligible], ['free', false], 'a used trial stays used, even in test mode');
  const fresh = await newUser();
  assert.equal((await setState(fresh.token, 'free')).body.trialEligible, true, 'accounts that never had a trial can still start one');
});

test('owner (by email): permanent full access regardless of subscription state', async () => {
  const { token } = ownerEmailUser;
  const s = await status(token);
  assert.deepEqual([s.status, s.tier, s.isPremium, s.trialEligible, s.currentPeriodEndsAt], ['complimentary', 'pro', true, false, null]);
  assert.deepEqual(
    [s.limits.courses, s.limits.courseUploadsPerMonth, s.limits.examGenerationsPerMonth, s.limits.practiceQuestionsPerMonth],
    [null, null, null, null],
  );
  // No paywall paths for the owner, and no way to accidentally "buy".
  assert.equal((await purchase(token, 'pro_yearly')).status, 409);
  // Even an expired or trial (mock) subscription row can't take access away or limit it.
  await setState(token, 'expired');
  assert.equal((await status(token)).status, 'complimentary');
  await setState(token, 'trial');
  assert.deepEqual([(await status(token)).status, (await status(token)).limits.examGenerationsPerMonth], ['complimentary', null]);
  // Beyond every plan's course cap and exam length.
  const d = await readyCourse(token);
  await readyCourse(token);
  assert.equal((await exam(token, d, 20)).status, 201);
  for (let i = 0; i < LIMITS.free.examGenerationsPerMonth! + 1; i++) assert.equal((await exam(token, d, 3)).status, 201);
  // Nothing in the response reveals how access was granted.
  const raw = JSON.stringify(await status(token)).toLowerCase();
  assert.ok(!raw.includes('owner') && !raw.includes(OWNER_EMAIL));
});

test('owner (by user id) is recognised; lookalike accounts are not', async () => {
  await sql`insert into users (id, email, password_hash, name) values (${OWNER_ID}, ${`id-owner-${RUN}@example.com`}, 'x', 'Id Owner')`;
  const { isOwner } = await import('../src/billing/entitlements.js');
  assert.equal(await isOwner(OWNER_ID), true);
  const lookalike = await newUser(`${OWNER_EMAIL.replace('@', '+1@')}`);
  assert.equal((await status(lookalike.token)).status, 'free');
});

test('unauthorized access: auth required, no client-side escalation, mock tools validate input', async () => {
  for (const [method, path] of [['GET', '/billing/status'], ['POST', '/billing/purchase'], ['POST', '/billing/restore'], ['POST', '/billing/cancel'], ['POST', '/billing/mock/state']] as const) {
    assert.equal((await call(path, { method })).status, 401, `${method} ${path}`);
    assert.equal((await call(path, { method, token: 'forged.token.value' })).status, 401, `${method} ${path} forged`);
  }
  const { token } = await newUser();
  // Extra fields are ignored — a client can't claim a tier, status or owner access.
  const r = await call<Entitlement>('/billing/purchase', post({ planId: 'student_monthly', tier: 'pro', status: 'complimentary', owner: true, limits: {} }, token));
  assert.deepEqual([r.body.tier, r.body.status], ['student', 'active']);
  assert.equal((await setState(token, 'complimentary')).status, 400);
  assert.equal((await setState(token, 'owner')).status, 400);
  // Free users are blocked from premium-only features.
  const free = await newUser();
  const d = await readyCourse(free.token);
  assert.equal((await exam(free.token, d, 20)).status, 402);
});

test('monetization client events are accepted; payment details are not', async () => {
  const { token } = await newUser();
  const anonymousId = crypto.randomUUID();
  const ok = await call('/events', post({
    anonymousId,
    events: [
      { name: 'paywall_viewed', properties: { platform: 'ios', trigger: 'limit_courses' } },
      { name: 'plan_selected', properties: { platform: 'ios', plan_id: 'pro_yearly', tier: 'pro', period: 'yearly', trigger: 'limit_courses' } },
      { name: 'upgrade_started', properties: { platform: 'ios', plan_id: 'pro_yearly', tier: 'pro', period: 'yearly', with_trial: true, trigger: 'limit_courses' } },
    ],
  }, token));
  assert.equal(ok.status, 202);
  const bad = await call('/events', post({ anonymousId, events: [{ name: 'upgrade_started', properties: { platform: 'ios', plan_id: 'pro_yearly', tier: 'pro', period: 'yearly', with_trial: true, trigger: 'account', card_last4: '4242' } }] }, token));
  assert.equal(bad.status, 400);
  assert.equal((await call('/events', post({ anonymousId, events: [{ name: 'subscription_started', properties: {} }] }, token))).status, 400, 'server-only event');
});
