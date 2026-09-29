/**
 * The commercial plan structure: Free · Basic · Student · Pro (monthly/yearly) · trial · expired · owner.
 * Entitlements (tier, access plan, features, limits), what each plan can do (lectures, adaptive
 * practice, weak-topic analysis, adaptive planner), plan changes, forged claims, and the Apple /
 * Google product catalog. Uses the development mock provider (no payments) and the default limits.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, DocumentProgress, Entitlement, Exam, Features, PlanId, StudyPlan } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `plans-owner-${RUN}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', TRANSCRIPTION_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true', OWNER_EMAILS: OWNER_EMAIL, OWNER_USER_IDS: '' });
delete process.env.PLAN_LIMITS_OVERRIDE;
delete process.env.PLAN_FEATURES_OVERRIDE;

const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { LIMITS } = await import('../src/billing/limits.js');
const { resolveAccessPlan } = await import('../src/billing/entitlements.js');
const apple = await import('../src/billing/providers/apple.js');
const google = await import('../src/billing/providers/google.js');
const { applySubscriptionUpdate } = await import('../src/billing/subscriptions.js');
const shared = await import('@study/shared');
const { addDays, localDate } = await import('../src/services/planner/dates.js');
const { materialJobs } = await import('../src/services/materials/index.js');
after(async () => {
  await materialJobs.idle();
  await sql.end();
});

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
async function call<T>(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const { token, json, ...rest } = init;
  const res = await app.request(path, {
    ...rest,
    ...(json !== undefined ? { method: rest.method ?? 'POST', body: JSON.stringify(json) } : {}),
    headers: { ...(json !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string; feature?: string } };
}
async function newUser(email = `plans-${RUN}-${crypto.randomUUID()}@example.com`) {
  const r = await call<AuthResponse>('/auth/register', { json: { email, password: 'password123', name: 'Plans' } });
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id };
}
const status = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body;
const buy = (token: string, planId: string, startTrial = false) => call<Entitlement>('/billing/purchase', { token, json: { planId, startTrial } });
const setState = (token: string, state: string) => call<Entitlement>('/billing/mock/state', { token, json: { state } });
async function readyCourse(token: string): Promise<DocumentDetail> {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 80; i++) {
    const d = await call<DocumentDetail>(`/documents/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error('not ready');
}
/** Takes an exam and answers everything wrong → every examined topic becomes weak. */
async function failExam(token: string, docId: string) {
  const exam = await call<Exam>(`/documents/${docId}/exams`, { token, json: { questionCount: 5 } });
  assert.equal(exam.status, 201);
  const graded = await call<Exam>(`/exams/${exam.body.id}/submit`, { token, json: { answers: exam.body.questions.map((q) => ({ questionId: q.id, answer: 'no idea' })) } });
  assert.equal(graded.status, 200);
  return exam.body;
}

const focusOf = async (examId: string) => ((await sql`select focus_topics from exams where id = ${examId}`)[0].focus_topics as string[]);

const ALL: Features = { lectures: true, adaptivePractice: true, weakTopicAnalysis: true, adaptivePlanner: true };
const CORE: Features = { lectures: false, adaptivePractice: false, weakTopicAnalysis: false, adaptivePlanner: false };
/** Free = Basic's features plus its single lecture (one per account). */
const FREE: Features = { ...CORE, lectures: true };

// ---------------------------------------------------------------- catalog

test('catalog: 3 paid tiers × monthly/yearly with the final prices; Student monthly is recommended', () => {
  assert.deepEqual(
    shared.PLANS.map((p) => [p.id, p.tier, p.period, p.priceCents]),
    [
      ['basic_monthly', 'basic', 'monthly', 999],
      ['basic_yearly', 'basic', 'yearly', 7999],
      ['student_monthly', 'student', 'monthly', 1499],
      ['student_yearly', 'student', 'yearly', 11999],
      ['pro_monthly', 'pro', 'monthly', 2499],
      ['pro_yearly', 'pro', 'yearly', 19999],
    ],
  );
  assert.equal(shared.RECOMMENDED_PLAN_ID, 'student_monthly');
  assert.deepEqual([...shared.ACCESS_PLANS], ['free', 'trial', 'basic_monthly', 'basic_yearly', 'student_monthly', 'student_yearly', 'pro_monthly', 'pro_yearly', 'expired', 'owner']);
});

test('Apple product mapping: six App Store products, one subscription group', () => {
  const expected: Record<string, PlanId> = {
    'com.exama.app.basic.monthly': 'basic_monthly',
    'com.exama.app.basic.annual': 'basic_yearly',
    'com.exama.app.student.monthly': 'student_monthly',
    'com.exama.app.student.annual': 'student_yearly',
    'com.exama.app.pro.monthly': 'pro_monthly',
    'com.exama.app.pro.annual': 'pro_yearly',
  };
  assert.deepEqual(Object.fromEntries(shared.PLANS.map((p) => [p.appleProductId, p.id])), expected);
  for (const [product, plan] of Object.entries(expected)) assert.equal(apple.planForProduct(product).id, plan);
  for (const bad of ['com.exama.app.student.yearly', 'com.exama.app.premium.monthly', 'com.other.app.basic.monthly']) {
    assert.throws(() => apple.planForProduct(bad), /Unknown App Store product/, bad);
  }
  // A verified Basic transaction becomes a Basic subscription.
  const now = Date.now();
  const u = apple.mapAppleTransaction(
    { bundleId: 'com.exama.app', productId: 'com.exama.app.basic.annual', transactionId: 't', originalTransactionId: 'o', purchaseDate: now, expiresDate: now + 365 * 86_400_000, environment: 'Sandbox' },
    { originalTransactionId: 'o', autoRenewStatus: 1 },
  );
  assert.deepEqual([u.planId, u.status], ['basic_yearly', 'active']);
});

test('Google Play mapping: one subscription per tier, base plans monthly/annual', () => {
  const expected: [string, string, PlanId][] = [
    ['exama_basic', 'monthly', 'basic_monthly'],
    ['exama_basic', 'annual', 'basic_yearly'],
    ['exama_student', 'monthly', 'student_monthly'],
    ['exama_student', 'annual', 'student_yearly'],
    ['exama_pro', 'monthly', 'pro_monthly'],
    ['exama_pro', 'annual', 'pro_yearly'],
  ];
  assert.deepEqual(shared.PLANS.map((p) => [p.googleProductId, p.googleBasePlanId, p.id]), expected);
  for (const [product, base, plan] of expected) assert.equal(google.planForGoogle(product, base).id, plan);
  assert.throws(() => google.planForGoogle('exama_basic', 'yearly'), /Unknown Google Play product/);
  assert.throws(() => google.planForGoogle('exama_premium', 'monthly'), /Unknown Google Play product/);
  const now = Date.now();
  const u = google.mapGoogleSubscription(
    {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      startTime: new Date(now).toISOString(),
      lineItems: [{ productId: 'exama_basic', expiryTime: new Date(now + 30 * 86_400_000).toISOString(), autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: 'monthly' }, offerPhase: { basePrice: {} } }],
    },
    'token',
  );
  assert.deepEqual([u.planId, u.status, u.provider], ['basic_monthly', 'active', 'google']);
});

// ---------------------------------------------------------------- entitlements per plan

test('entitlements: Basic, Student and Pro (monthly and yearly) — tier, access plan, features, limits', async () => {
  const { token } = await newUser();
  const want: Record<PlanId, ['basic' | 'student' | 'pro', Features]> = {
    basic_monthly: ['basic', CORE],
    basic_yearly: ['basic', CORE],
    student_monthly: ['student', ALL],
    student_yearly: ['student', ALL],
    pro_monthly: ['pro', ALL],
    pro_yearly: ['pro', ALL],
  };
  for (const [plan, [tier, features]] of Object.entries(want)) {
    const e = (await setState(token, plan)).body;
    assert.deepEqual([e.accessPlan, e.tier, e.planId, e.status, e.isPremium, e.features], [plan, tier, plan, 'active', true, features], plan);
    assert.deepEqual(e.limits, LIMITS[tier], plan);
  }
  // Monthly and yearly of the same tier give the same access.
  assert.deepEqual(LIMITS.basic, (await setState(token, 'basic_yearly')).body.limits);
});

test('limits: Basic has no audio/video; Student meaningful; Pro substantially higher everywhere', () => {
  const [b, s, p] = [LIMITS.basic, LIMITS.student, LIMITS.pro];
  assert.deepEqual([b.mediaUploadsPerMonth, b.mediaMinutesPerMonth, b.maxMediaMinutesPerFile], [0, 0, 0]);
  assert.ok(s.mediaMinutesPerMonth! >= 300 && s.mediaUploadsPerMonth! >= 30 && s.maxMediaMinutesPerFile >= 120);
  assert.ok(p.mediaMinutesPerMonth! >= 2 * s.mediaMinutesPerMonth!, 'Pro lecture minutes ≥ 2× Student');
  for (const k of ['courses', 'courseUploadsPerMonth', 'examGenerationsPerMonth', 'practiceQuestionsPerMonth', 'studyPlansPerMonth', 'mediaUploadsPerMonth', 'mediaMinutesPerMonth'] as const) {
    assert.ok(p[k]! > s[k]!, `pro.${k} > student.${k}`);
    assert.ok(s[k]! > b[k]!, `student.${k} > basic.${k}`);
    // Free's single lecture (per account) is the one thing Free has that Basic doesn't.
    if (!k.startsWith('media')) assert.ok(b[k]! >= LIMITS.free[k]!, `basic.${k} ≥ free.${k}`);
  }
  assert.ok(p.maxQuestionsPerExam > s.maxQuestionsPerExam && s.maxQuestionsPerExam > b.maxQuestionsPerExam);
  // Free: one lecture per account (never renewed); the trial: one lecture for the whole trial, same length.
  assert.deepEqual(
    [LIMITS.free.mediaUploadsPerMonth, LIMITS.free.mediaMinutesPerMonth, LIMITS.free.maxMediaMinutesPerFile, LIMITS.trial.mediaUploadsPerMonth, LIMITS.trial.mediaMinutesPerMonth],
    [1, 45, 45, 1, 45],
    'Free: one 45-minute lecture per account; trial: one 45-minute lecture',
  );
  // Basic: 3 courses at once (Student 15, Pro 50).
  assert.deepEqual([LIMITS.free.courses, LIMITS.basic.courses, LIMITS.student.courses, LIMITS.pro.courses], [1, 3, 15, 50]);
});

test('trial: the full experience (every feature) under the restricted trial caps', async () => {
  const { token } = await newUser();
  const e = (await buy(token, 'basic_monthly', true)).body;
  assert.deepEqual([e.accessPlan, e.tier, e.status, e.isPremium, e.features, e.limits], ['trial', 'trial', 'trialing', false, ALL, LIMITS.trial]);
  // Whatever plan the trial was started from, the trial is the same.
  const other = await newUser();
  assert.deepEqual((await buy(other.token, 'pro_yearly', true)).body.limits, LIMITS.trial);
});

test('expired and free: free limits, no paid features; owner: unlimited, every feature, never labelled "owner"', async () => {
  const { token } = await newUser();
  const free = await status(token);
  assert.deepEqual([free.accessPlan, free.tier, free.features, free.limits, free.lectureAllowance], ['free', 'free', FREE, LIMITS.free, 'once']);
  await buy(token, 'student_monthly');
  const expired = (await setState(token, 'expired')).body;
  assert.deepEqual([expired.accessPlan, expired.tier, expired.status, expired.isPremium, expired.features, expired.limits], ['expired', 'free', 'expired', false, FREE, LIMITS.free]);

  const owner = await newUser(OWNER_EMAIL);
  const o = await status(owner.token);
  assert.deepEqual([o.accessPlan, o.status, o.features], ['complimentary', 'complimentary', ALL]);
  assert.ok(Object.entries(o.limits).every(([k, v]) => v === null || k === 'maxQuestionsPerExam' || k === 'maxMediaMinutesPerFile'));
  assert.equal(await resolveAccessPlan(owner.id), 'owner', 'the server-side resolver knows it is the owner');
  assert.ok(!JSON.stringify(o).toLowerCase().includes('owner'), 'API responses never reveal the owner bypass');
  assert.equal((await buy(owner.token, 'pro_monthly')).status, 409, 'nothing to buy');
  assert.equal(await resolveAccessPlan((await newUser()).id), 'free');
});

// ---------------------------------------------------------------- plan changes

test('upgrades Basic → Student → Pro, downgrades, monthly ↔ yearly — access follows immediately; analytics tell them apart', async () => {
  const { token, id } = await newUser();
  const steps: [PlanId, string, Features][] = [
    ['basic_monthly', 'basic', CORE],
    ['student_monthly', 'student', ALL], // upgrade
    ['pro_monthly', 'pro', ALL], // upgrade
    ['pro_yearly', 'pro', ALL], // period change
    ['student_yearly', 'student', ALL], // downgrade
    ['basic_yearly', 'basic', CORE], // downgrade
  ];
  for (const [plan, tier, features] of steps) {
    const e = (await buy(token, plan)).body;
    assert.deepEqual([e.planId, e.tier, e.features, e.limits], [plan, tier, features, LIMITS[tier as 'basic']], plan);
  }
  assert.equal((await buy(token, 'basic_yearly')).status, 409, 'same plan again');
  await flushAnalytics();
  const started = (await sql`select properties from analytics_events where user_id = ${id} and name = 'subscription_started' order by created_at`).map((r) => r.properties);
  assert.deepEqual(
    started.map((p) => [p.plan_id, p.tier, p.period, p.change]),
    [
      ['basic_monthly', 'basic', 'monthly', 'new'],
      ['student_monthly', 'student', 'monthly', 'upgrade'],
      ['pro_monthly', 'pro', 'monthly', 'upgrade'],
      ['pro_yearly', 'pro', 'yearly', 'period_change'],
      ['student_yearly', 'student', 'yearly', 'downgrade'],
      ['basic_yearly', 'basic', 'yearly', 'downgrade'],
    ],
  );
});

test('plan selection analytics carry the tier; an unknown tier or plan is rejected', async () => {
  const { token } = await newUser();
  const anonymousId = crypto.randomUUID();
  const ok = await call('/events', {
    token,
    json: {
      anonymousId,
      events: (['basic', 'student', 'pro'] as const).map((tier) => ({ name: 'plan_selected', properties: { platform: 'android', plan_id: `${tier}_yearly`, tier, period: 'yearly', trigger: 'account' } })),
    },
  });
  assert.equal(ok.status, 202);
  for (const bad of [
    { platform: 'ios', plan_id: 'student_annual', tier: 'student', period: 'yearly', trigger: 'account' },
    { platform: 'ios', plan_id: 'basic_monthly', tier: 'premium', period: 'monthly', trigger: 'account' },
    { platform: 'ios', plan_id: 'basic_monthly', trigger: 'account' },
  ]) {
    assert.equal((await call('/events', { token, json: { anonymousId, events: [{ name: 'plan_selected', properties: bad }] } })).status, 400, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- forged claims

test('forged premium claims are ignored: body fields, headers, old/unknown plan ids, tampered rows', async () => {
  const { token, id } = await newUser();
  await buy(token, 'basic_monthly');
  const forged = await call<Entitlement>('/billing/purchase', {
    token,
    json: { planId: 'basic_yearly', tier: 'pro', accessPlan: 'owner', features: ALL, limits: { mediaMinutesPerMonth: 9999 }, status: 'complimentary' },
    headers: { 'X-Exama-Tier': 'pro', 'X-Exama-Features': 'lectures' },
  });
  assert.deepEqual([forged.body.tier, forged.body.accessPlan, forged.body.features, forged.body.limits], ['basic', 'basic_yearly', CORE, LIMITS.basic]);
  for (const planId of ['student_annual', 'pro_annual', 'premium_monthly', 'owner']) assert.equal((await buy(token, planId)).status, 400, planId);
  assert.equal((await setState(token, 'owner')).status, 400);

  // A row holding an id from before the new catalog still resolves (migration 0007 renames them);
  // an unknown id gives no paid access at all.
  const base = { provider: 'mock' as const, environment: 'test' as const, status: 'active' as const, trialEndsAt: null, currentPeriodEndsAt: new Date(Date.now() + 86_400_000), willRenew: true, trialUsed: true };
  await applySubscriptionUpdate(id, { ...base, planId: 'student_monthly' }, 'silent');
  await sql`update subscriptions set plan_id = 'pro_annual' where user_id = ${id}`;
  assert.deepEqual([(await status(token)).tier, (await status(token)).planId], ['pro', 'pro_yearly']);
  await sql`update subscriptions set plan_id = 'platinum_forever' where user_id = ${id}`;
  const unknown = await status(token);
  assert.deepEqual([unknown.tier, unknown.isPremium, unknown.features], ['free', false, FREE]);
});

// ---------------------------------------------------------------- features in action

test('Basic practice is spread over the course (not weak-topic targeted); Student practice targets weak topics', async () => {
  // Basic: no exam yet → practice still works (no "no weak topics" refusal), least-practised topics first.
  const basic = await newUser();
  await buy(basic.token, 'basic_monthly');
  const bDoc = await readyCourse(basic.token);
  const bPractice = await call<Exam>(`/documents/${bDoc.id}/exams`, { token: basic.token, json: { kind: 'follow_up', questionCount: 3 } });
  assert.equal(bPractice.status, 201, JSON.stringify(bPractice.body));
  assert.deepEqual(await focusOf(bPractice.body.id), bDoc.topics.slice(0, 3), 'untouched course: the first topics in course order');
  await failExam(basic.token, bDoc.id);
  const again = await call<Exam>(`/documents/${bDoc.id}/exams`, { token: basic.token, json: { kind: 'follow_up', questionCount: 3 } });
  assert.equal(again.status, 201);

  // Student: practice needs weak topics and targets exactly them.
  const student = await newUser();
  await buy(student.token, 'student_monthly');
  const sDoc = await readyCourse(student.token);
  const none = await call(`/documents/${sDoc.id}/exams`, { token: student.token, json: { kind: 'follow_up' } });
  assert.deepEqual([none.status, none.body.code], [409, 'no_weak_topics']);
  await failExam(student.token, sDoc.id);
  const progress = (await call<DocumentProgress>(`/documents/${sDoc.id}/progress`, { token: student.token })).body;
  const sPractice = await call<Exam>(`/documents/${sDoc.id}/exams`, { token: student.token, json: { kind: 'follow_up', questionCount: 3 } });
  assert.equal(sPractice.status, 201);
  const focus = await focusOf(sPractice.body.id);
  assert.ok(focus.length > 0 && focus.every((t) => progress.weakTopics.includes(t)), 'weak topics only');
});

test('weak-topic analysis: locked on Basic (exam history only), unlocked on Student and Pro', async () => {
  const { token } = await newUser();
  await buy(token, 'basic_monthly');
  const doc = await readyCourse(token);
  await failExam(token, doc.id);
  const locked = (await call<DocumentProgress>(`/documents/${doc.id}/progress`, { token })).body;
  assert.deepEqual([locked.analysisLocked, locked.topics, locked.weakTopics, locked.exams.length], [true, [], [], 1]);
  await buy(token, 'pro_monthly'); // upgrading reveals the analysis of the same results
  const open = (await call<DocumentProgress>(`/documents/${doc.id}/progress`, { token })).body;
  assert.equal(open.analysisLocked, false);
  assert.ok(open.topics.length > 0 && open.weakTopics.length > 0);
});

test('study planner: even on Basic (no priorities, no readiness), adaptive on Student', async () => {
  const today = localDate(new Date(), 'UTC');
  const plan = async (token: string, docId: string) =>
    (await call<StudyPlan>(`/documents/${docId}/study-plan`, { token, json: { examDate: addDays(today, 10), minutesPerDay: 60, preparedLevel: 'familiar', timezone: 'UTC' } })).body;

  const basic = await newUser();
  await buy(basic.token, 'basic_monthly');
  const bDoc = await readyCourse(basic.token);
  const b = await plan(basic.token, bDoc.id);
  assert.equal(b.adaptive, false);
  assert.ok(b.topics.every((t) => t.importance === 2), 'every topic weighted the same');
  await failExam(basic.token, bDoc.id);
  const bAfter = (await call<StudyPlan>(`/documents/${bDoc.id}/study-plan`, { token: basic.token })).body;
  assert.equal(bAfter.readiness, null, 'no mastery-based readiness on Basic');
  assert.ok(bAfter.tasks.every((t) => t.mastery === null), 'results never feed the Basic schedule');

  const student = await newUser();
  await buy(student.token, 'student_monthly');
  const sDoc = await readyCourse(student.token);
  const s = await plan(student.token, sDoc.id);
  assert.equal(s.adaptive, true);
  const [stored] = await sql`select topic_insights from study_plans where document_id = ${sDoc.id}`;
  assert.deepEqual(s.topics, stored.topic_insights, 'AI priorities shown and used as generated');
  await failExam(student.token, sDoc.id);
  assert.notEqual((await call<StudyPlan>(`/documents/${sDoc.id}/study-plan`, { token: student.token })).body.readiness, null);
});
