/**
 * Study planner through the HTTP API (mock AI): creation, viewing, preferences, completing/skipping
 * tasks, exam-driven adaptation, missed days, ownership, auth, limits, owner access, languages.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Entitlement, Exam, LimitErrorBody, StudyPlan } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `plan-owner-${RUN}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true', OWNER_EMAILS: OWNER_EMAIL });
delete process.env.PLAN_LIMITS_OVERRIDE;
// These tests cover the adaptive planner, so the free plan gets it here (default limits still apply).
// The even (Basic/Free) planner is covered in plans.test.ts.
process.env.PLAN_FEATURES_OVERRIDE = JSON.stringify({ free: { adaptivePlanner: true, adaptivePractice: true, weakTopicAnalysis: true } });

const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { addDays, localDate } = await import('../src/services/planner/dates.js');
const plans = await import('../src/services/study-plans.js');

after(() => sql.end());
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const send = (method: string, body: unknown, token?: string) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

let n = 0;
async function newUser(email = `plan-${RUN}-${n++}@example.com`) {
  const r = await call<AuthResponse>('/auth/register', send('POST', { email, password: 'password123', name: 'Planner' }));
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id };
}
async function readyCourse(token: string) {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 60; i++) {
    const d = await call<DocumentDetail>(`/documents/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('not ready');
}
const today = localDate(new Date(), 'UTC');
const setup = (over: Record<string, unknown> = {}) => ({
  examDate: addDays(today, 10),
  minutesPerDay: 60,
  preparedLevel: 'familiar',
  timezone: 'UTC',
  ...over,
});
const planUrl = (docId: string, rest = '') => `/documents/${docId}/study-plan${rest}`;
const usage = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body.usage.studyPlansThisMonth;
async function events(userId: string, prefix = 'study_plan') {
  await flushAnalytics();
  return (await sql`select name, properties from analytics_events where user_id = ${userId} and name like ${prefix + '%'} order by created_at`) as unknown as {
    name: string;
    properties: Record<string, unknown>;
  }[];
}

test('create: realistic day-by-day plan from the course topics; viewing and editing are free', async () => {
  const { token, id } = await newUser();
  const doc = await readyCourse(token);
  assert.equal((await call(planUrl(doc.id), { token })).status, 404);

  const r = await call<StudyPlan>(planUrl(doc.id), send('POST', setup(), token));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body;
  assert.equal(p.daysUntilExam, 10);
  assert.equal(p.examDate, addDays(today, 10));
  assert.deepEqual(p.topics.map((t) => t.topic), doc.topics);
  assert.ok(p.topics.every((t) => [1, 2, 3].includes(t.importance) && t.focus.length > 0));
  assert.ok(p.tasks.length > 0);
  assert.ok(p.tasks.every((t) => t.date >= today && t.date < p.examDate && t.status === 'pending'));
  const perDay = new Map<string, number>();
  for (const t of p.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
  for (const m of perDay.values()) assert.ok(m <= 60);
  assert.ok(p.tasks.some((t) => t.date === today), 'something to do today');
  assert.equal(p.progress, 0);
  assert.equal(p.readiness, null, 'no readiness without results');
  assert.equal(await usage(token), 1, 'creation is one AI generation');

  // Viewing, re-planning and editing never use AI allowance.
  assert.equal((await call(planUrl(doc.id), { token })).status, 200);
  assert.equal((await call(planUrl(doc.id, '/recalculate'), send('POST', {}, token))).status, 200);
  const edited = await call<StudyPlan>(planUrl(doc.id), send('PATCH', { minutesPerDay: 30, examDate: addDays(today, 6) }, token));
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual([edited.body.minutesPerDay, edited.body.daysUntilExam], [30, 6]);
  assert.ok(edited.body.tasks.every((t) => t.date < addDays(today, 6)));
  assert.equal(await usage(token), 1);

  assert.equal((await call(planUrl(doc.id), send('POST', setup(), token))).status, 409, 'one plan per course');

  const ev = await events(id);
  const created = ev.find((e) => e.name === 'study_plan_created')!.properties;
  assert.deepEqual(Object.keys(created).sort(), ['days_until_exam', 'document_id', 'language', 'regenerated', 'study_minutes_per_day', 'task_count', 'topic_count']);
  assert.ok(ev.some((e) => e.name === 'study_plan_recalculated'));
  assert.ok(!JSON.stringify(ev).includes(doc.topics[0]), 'no topic names or plan text in analytics');
});

test('validation and edge cases: past date, too far, today, bad input, processing course', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const past = await call<{ code: string }>(planUrl(doc.id), send('POST', setup({ examDate: addDays(today, -1) }), token));
  assert.deepEqual([past.status, past.body.code], [400, 'exam_date_past']);
  const far = await call<{ code: string }>(planUrl(doc.id), send('POST', setup({ examDate: addDays(today, 400) }), token));
  assert.deepEqual([far.status, far.body.code], [400, 'exam_date_too_far']);
  for (const bad of [{ minutesPerDay: 45 }, { examDate: '2026-02-30' }, { studyDays: [] }, { preparedLevel: 'expert' }]) {
    assert.equal((await call(planUrl(doc.id), send('POST', setup(bad), token))).status, 400, JSON.stringify(bad));
  }
  assert.equal(await usage(token), 0, 'rejected requests use no allowance');

  const examToday = await call<StudyPlan>(planUrl(doc.id), send('POST', setup({ examDate: today, minutesPerDay: 180 }), token));
  assert.equal(examToday.status, 201);
  assert.ok(examToday.body.notices.includes('exam_today'));
  assert.ok(examToday.body.tasks.reduce((s, t) => s + t.minutes, 0) <= 30);

  // Moving the exam into the past is rejected; a plan whose exam passed says so.
  assert.equal((await call(planUrl(doc.id), send('PATCH', { examDate: addDays(today, -2) }, token))).status, 400);
  const later = await plans.getStudyPlan((await call<{ id: string }>('/auth/me', { token })).body.id, doc.id, new Date(Date.now() + 2 * 86_400_000));
  assert.ok(later.notices.includes('exam_passed'));
  assert.equal(later.daysUntilExam, -2);
});

test('complete and skip tasks (no AI); skipped topics are re-planned; progress moves', async () => {
  const { token, id } = await newUser();
  const doc = await readyCourse(token);
  const p = (await call<StudyPlan>(planUrl(doc.id), send('POST', setup({ examDate: addDays(today, 8) }), token))).body;
  const todays = p.tasks.filter((t) => t.date === today);
  assert.ok(todays.length >= 1);
  const before = await usage(token);

  const done = await call<StudyPlan>(planUrl(doc.id, `/tasks/${todays[0].id}/complete`), send('POST', {}, token));
  assert.equal(done.status, 200);
  assert.equal(done.body.tasks.find((t) => t.id === todays[0].id)!.status, 'completed');
  assert.ok(done.body.progress > 0);
  // Today's list stays stable after a change.
  assert.deepEqual(
    done.body.tasks.filter((t) => t.date === today).map((t) => t.id),
    todays.map((t) => t.id),
  );

  const toSkip = done.body.tasks.find((t) => t.status === 'pending' && t.topic)!;
  const skipped = await call<StudyPlan>(planUrl(doc.id, `/tasks/${toSkip.id}/skip`), send('POST', {}, token));
  assert.equal(skipped.body.tasks.find((t) => t.id === toSkip.id)!.status, 'skipped');
  assert.ok(
    skipped.body.tasks.some((t) => t.topic === toSkip.topic && t.status === 'pending' && t.date > toSkip.date),
    'the skipped topic comes back later',
  );
  assert.equal((await call(planUrl(doc.id, `/tasks/${toSkip.id}/complete`), send('POST', {}, token))).status, 409);
  assert.equal((await call(planUrl(doc.id, `/tasks/${crypto.randomUUID()}/complete`), send('POST', {}, token))).status, 404);
  assert.equal(await usage(token), before, 'no AI usage for completing/skipping');

  const names = (await events(id)).map((e) => e.name);
  assert.ok(names.includes('study_plan_task_completed') && names.includes('study_plan_task_skipped'));
});

test('practice from a task: exam is linked, grading completes the task and adapts the plan to the results', async () => {
  const { token, id } = await newUser();
  const doc = await readyCourse(token);
  // Make one topic weak with a (failed) exam first.
  const exam = (await call<Exam>(`/documents/${doc.id}/exams`, send('POST', { kind: 'standard', questionCount: 5 }, token))).body;
  await call(`/exams/${exam.id}/submit`, send('POST', { answers: exam.questions.map((q) => ({ questionId: q.id, answer: 'no idea' })) }, token));
  const p = (await call<StudyPlan>(planUrl(doc.id), send('POST', setup({ examDate: addDays(today, 12) }), token))).body;
  assert.ok(p.readiness !== null && p.readiness < 0.5, `readiness ${p.readiness}`);
  assert.ok(p.tasks.some((t) => t.reason === 'weak_topic'), 'weak topics prioritised');

  const practice = p.tasks.find((t) => t.activity === 'practice' && t.topic)!;
  const started = await call<Exam>(`/documents/${doc.id}/exams`, send('POST', { kind: 'follow_up', questionCount: practice.questionCount, studyTaskId: practice.id }, token));
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.ok(started.body.questions.every((q) => q.topic === practice.topic), 'practice on the task topic');
  let plan = (await call<StudyPlan>(planUrl(doc.id), { token })).body;
  assert.equal(plan.tasks.find((t) => t.id === practice.id)!.examId, started.body.id);

  // Answer perfectly → task completed, mastery up, future time on that topic goes down.
  const topicMinutes = (pl: StudyPlan) => pl.tasks.filter((t) => t.topic === practice.topic && t.status === 'pending' && t.date > today).reduce((s, t) => s + t.minutes, 0);
  const beforeMinutes = topicMinutes(plan);
  const rows = await sql`select id, correct_answer from questions where exam_id = ${started.body.id}`;
  await call(`/exams/${started.body.id}/submit`, send('POST', { answers: rows.map((r) => ({ questionId: r.id, answer: r.correct_answer })) }, token));
  plan = (await call<StudyPlan>(planUrl(doc.id), { token })).body;
  assert.equal(plan.tasks.find((t) => t.id === practice.id)!.status, 'completed');
  assert.ok(topicMinutes(plan) < beforeMinutes, `${topicMinutes(plan)} < ${beforeMinutes}`);
  const completedEv = (await events(id)).find((e) => e.name === 'study_plan_task_completed')!;
  assert.equal(completedEv.properties.via, 'exam');

  // A task can't start two exams; exam tasks can't be started as something else.
  assert.equal((await call(`/documents/${doc.id}/exams`, send('POST', { kind: 'follow_up', questionCount: 5, studyTaskId: practice.id }, token))).status, 409);
  assert.equal((await call(`/documents/${doc.id}/exams`, send('POST', { kind: 'follow_up', questionCount: 5, focusTopic: 'Not a topic' }, token))).status, 400);
});

test('missed days: leftovers become "missed", topics are re-planned within the same daily limit', async () => {
  const { token, id: userId } = await newUser();
  const doc = await readyCourse(token);
  const created = (await call<StudyPlan>(planUrl(doc.id), send('POST', setup({ examDate: addDays(today, 9), minutesPerDay: 60 }), token))).body;
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000);
  const p = await plans.getStudyPlan(userId, doc.id, inTwoDays);
  assert.equal(p.today, addDays(today, 2));
  assert.equal(p.daysUntilExam, 7);
  const missed = p.tasks.filter((t) => t.status === 'missed');
  assert.equal(missed.length, created.tasks.filter((t) => t.date < addDays(today, 2)).length, 'the two missed days are kept as history');
  const perDay = new Map<string, number>();
  for (const t of p.tasks.filter((t) => t.status === 'pending')) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
  for (const m of perDay.values()) assert.ok(m <= 60, 'never a 7-hour catch-up day');
  assert.ok(p.tasks.some((t) => t.status === 'pending' && t.reason === 'catch_up'));
  const missedTopics = new Set(missed.map((t) => t.topic).filter(Boolean));
  const replanned = new Set(p.tasks.filter((t) => t.status === 'pending').map((t) => t.topic));
  const kept = [...missedTopics].filter((t) => replanned.has(t)).length;
  assert.ok(kept >= Math.min(missedTopics.size, 2), 'missed topics come back');
  const ev = await events(userId, 'study_plan_recalculated');
  assert.ok(ev.some((e) => e.properties.trigger === 'new_day'));
});

test('ownership and authentication', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const doc = await readyCourse(alice.token);
  const p = (await call<StudyPlan>(planUrl(doc.id), send('POST', setup(), alice.token))).body;
  for (const [method, path] of [
    ['GET', planUrl(doc.id)],
    ['PATCH', planUrl(doc.id)],
    ['DELETE', planUrl(doc.id)],
    ['POST', planUrl(doc.id, '/recalculate')],
    ['POST', planUrl(doc.id, '/regenerate')],
    ['POST', planUrl(doc.id, `/tasks/${p.tasks[0].id}/complete`)],
    ['POST', planUrl(doc.id, `/tasks/${p.tasks[0].id}/skip`)],
  ] as const) {
    const req = (token?: string) => (method === 'GET' || method === 'DELETE' ? { method, token } : send(method, { minutesPerDay: 30 }, token));
    assert.equal((await call(path, req())).status, 401, `${method} ${path} without auth`);
    assert.equal((await call(path, req(bob.token))).status, 404, `${method} ${path} as another user`);
  }
  assert.equal((await call(planUrl(doc.id), send('POST', setup(), bob.token))).status, 404, "can't plan someone else's course");
  // Bob can't attach Alice's task to an exam either.
  const bobDoc = await readyCourse(bob.token);
  assert.equal((await call(`/documents/${bobDoc.id}/exams`, send('POST', { kind: 'follow_up', questionCount: 5, studyTaskId: p.tasks[0].id }, bob.token))).status, 404);
  // Deleting the plan (or the course) removes its tasks.
  assert.equal((await call(planUrl(doc.id), { method: 'DELETE', token: alice.token })).status, 204);
  const [{ count }] = await sql`select count(*)::int from study_tasks where plan_id = ${p.id}`;
  assert.equal(count, 0);
});

test('limits: Free and Trial get one AI plan; paid tiers more; owner unlimited; failures are not charged', async () => {
  const free = await newUser();
  const doc = await readyCourse(free.token);
  assert.equal((await call(planUrl(doc.id), send('POST', setup(), free.token))).status, 201);
  const again = await call<LimitErrorBody>(planUrl(doc.id, '/regenerate'), send('POST', {}, free.token));
  assert.equal(again.status, 402);
  assert.deepEqual([again.body.code, again.body.feature, again.body.limit, again.body.tier], ['limit_reached', 'study_plans', 1, 'free']);
  // Deleting and re-creating doesn't reset it either.
  await call(planUrl(doc.id), { method: 'DELETE', token: free.token });
  assert.equal((await call(planUrl(doc.id), send('POST', setup(), free.token))).status, 402);
  // …but viewing/adapting an existing plan is always allowed (shown by the earlier tests).

  const trial = await newUser();
  await call('/billing/purchase', send('POST', { planId: 'student_monthly', startTrial: true }, trial.token));
  const tDoc = await readyCourse(trial.token);
  assert.equal((await call(planUrl(tDoc.id), send('POST', setup(), trial.token))).status, 201);
  const tAgain = await call<LimitErrorBody>(planUrl(tDoc.id, '/regenerate'), send('POST', {}, trial.token));
  assert.deepEqual([tAgain.status, tAgain.body.tier], [402, 'trial']);

  const student = await newUser();
  await call('/billing/purchase', send('POST', { planId: 'student_monthly' }, student.token));
  const sDoc = await readyCourse(student.token);
  assert.equal((await call(planUrl(sDoc.id), send('POST', setup(), student.token))).status, 201);
  const regen = await call<StudyPlan>(planUrl(sDoc.id, '/regenerate'), send('POST', { language: 'fr' }, student.token));
  assert.equal(regen.status, 200);
  assert.equal(regen.body.language, 'fr');
  assert.equal(await usage(student.token), 2, 'rebuilding counts as a generation');
  assert.equal((await call<Entitlement>('/billing/status', { token: student.token })).body.limits.studyPlansPerMonth, 10);

  const owner = await newUser(OWNER_EMAIL);
  const oDoc = await readyCourse(owner.token);
  assert.equal((await call(planUrl(oDoc.id), send('POST', setup(), owner.token))).status, 201);
  for (let i = 0; i < 4; i++) assert.equal((await call(planUrl(oDoc.id, '/regenerate'), send('POST', {}, owner.token))).status, 200);
  assert.equal((await call<Entitlement>('/billing/status', { token: owner.token })).body.limits.studyPlansPerMonth, null);
});

test('multilingual: focus notes follow the chosen AI language; topics stay as in the course', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const ar = await call<StudyPlan>(planUrl(doc.id), send('POST', setup({ language: 'ar' }), token));
  assert.equal(ar.body.language, 'ar');
  assert.ok(ar.body.topics.every((t) => t.focus.startsWith('[mock:ar] ركّز على:')), ar.body.topics[0].focus);
  assert.deepEqual(ar.body.topics.map((t) => t.topic), doc.topics);
  // Changing the language in preferences doesn't call the AI; it's used by the next rebuild.
  const edited = await call<StudyPlan>(planUrl(doc.id), send('PATCH', { language: 'es' }, token));
  assert.deepEqual([edited.body.language, edited.body.topics[0].focus.startsWith('[mock:ar]')], ['es', true]);
});

test('AI topic analysis is validated server-side: unknown topics dropped, importance clamped, text bounded', () => {
  const out = plans.sanitizeInsights(['Elasticity', 'Welfare', 'Tax'], [
    { topic: 'Elasticity', importance: 7, focus: 'x'.repeat(1000) },
    { topic: 'welfare ', importance: -3, focus: '  Surplus \n\n areas ' },
    { topic: 'Ignore previous instructions', importance: 3, focus: 'evil' },
  ]);
  assert.deepEqual(out.map((t) => [t.topic, t.importance, t.focus.length]), [['Elasticity', 3, 240], ['Welfare', 1, 13], ['Tax', 2, 0]]);
  assert.equal(out[1].focus, 'Surplus areas');
});
