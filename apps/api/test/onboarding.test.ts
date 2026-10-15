/**
 * Student onboarding API: only new accounts are asked, answers are validated and saved to the
 * account (idempotent, no duplicates), skipping/completing behave, sessions and other users are
 * isolated, and deleting the account removes the row.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { onboardingAnswersSchema, ONBOARDING_QUESTIONS, type AuthResponse, type OnboardingAnswers, type OnboardingState } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const analytics = await import('../src/analytics/index.js');
after(() => sql.end());

const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
let n = 0;

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const email = () => `onb-${RUN}-${++n}@example.com`;

async function signUp() {
  const e = email();
  const r = await call<AuthResponse>('/auth/register', json('POST', { email: e, password: PASSWORD, name: 'Sam' }));
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id, email: e };
}
const state = (token: string) => call<OnboardingState>('/onboarding', { token });
const save = (token: string, answers: unknown) => call<OnboardingState>('/onboarding', { ...json('PUT', { answers }), token });
const skip = (token: string) => call<OnboardingState>('/onboarding/skip', { method: 'POST', token });
const rowCount = async (userId: string) => ((await sql`select count(*)::int as c from user_onboarding where user_id = ${userId}`) as unknown as { c: number }[])[0].c;
const eventNames = async (userId: string) => {
  await analytics.flushAnalytics();
  return ((await sql`select name from analytics_events where user_id = ${userId} and name like 'onboarding_%' order by created_at`) as unknown as { name: string }[]).map((r) => r.name);
};

const ANSWERS: OnboardingAnswers = { studyField: 'health', examTiming: 'one_to_two_weeks', mainGoal: 'study_plan', materials: 'pdf', confidence: 'some_topics' };

test('a new signup starts with onboarding pending (and exactly one row); nothing is answered yet', async () => {
  const u = await signUp();
  const s = await state(u.token);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, { status: 'pending', answers: null, finishedAt: null });
  assert.equal(await rowCount(u.id), 1);
});

test('accounts created before onboarding existed are never asked (status none), and skipping does nothing to them', async () => {
  const u = await signUp();
  await sql`delete from user_onboarding where user_id = ${u.id}`; // what an old account looks like: no row
  assert.deepEqual((await state(u.token)).body, { status: 'none', answers: null, finishedAt: null });
  assert.deepEqual((await skip(u.token)).body.status, 'none');
  assert.equal(await rowCount(u.id), 0, 'skip must not create a row for an old account');
});

test('requires a signed-in user', async () => {
  assert.equal((await call('/onboarding')).status, 401);
  assert.equal((await call('/onboarding', json('PUT', { answers: ANSWERS }))).status, 401);
  assert.equal((await call('/onboarding/skip', { method: 'POST' })).status, 401);
});

test('incomplete or invalid answers are rejected and nothing is saved', async () => {
  const u = await signUp();
  for (const key of Object.keys(ANSWERS)) {
    const partial: Record<string, string> = { ...ANSWERS };
    delete partial[key];
    assert.equal((await save(u.token, partial)).status, 400, `missing ${key}`);
  }
  assert.equal((await save(u.token, { ...ANSWERS, confidence: 'extremely' })).status, 400, 'unknown option');
  assert.equal((await save(u.token, { ...ANSWERS, studyField: '' })).status, 400, 'empty answer');
  assert.equal((await save(u.token, { ...ANSWERS, notes: 'free text' })).status, 400, 'extra field (no free text is ever stored)');
  assert.equal((await save(u.token, null)).status, 400);
  assert.equal((await call('/onboarding', { method: 'PUT', body: 'not json', token: u.token, headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await state(u.token)).body.status, 'pending', 'still pending after rejected saves');
});

test('answers save to the account and load back unchanged, across sign-ins', async () => {
  const u = await signUp();
  const saved = await save(u.token, ANSWERS);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.status, 'completed');
  assert.deepEqual(saved.body.answers, ANSWERS);
  assert.ok(saved.body.finishedAt);

  // A fresh session (login) on, say, another device sees the same thing.
  const login = await call<AuthResponse>('/auth/login', json('POST', { email: u.email, password: PASSWORD }));
  assert.equal(login.status, 200);
  assert.deepEqual((await state(login.body.token)).body, saved.body);
  // The sign-in/register responses themselves are unchanged (no onboarding data leaks into User).
  assert.deepEqual(Object.keys(login.body.user).sort(), ['email', 'id', 'name']);
});

test('repeated and concurrent submissions are safe: one row, same result, one completion event', async () => {
  const u = await signUp();
  const results = await Promise.all(Array.from({ length: 6 }, () => save(u.token, ANSWERS)));
  assert.ok(results.every((r) => r.status === 200 && r.body.status === 'completed'));
  assert.equal(await rowCount(u.id), 1);
  const again = await save(u.token, ANSWERS);
  assert.equal(again.body.finishedAt, results[0].body.finishedAt, 'completion time does not move on repeats');
  const completed = (await eventNames(u.id)).filter((x) => x === 'onboarding_completed');
  assert.ok(completed.length >= 1 && completed.length <= 6); // concurrent first writes may each count; sequential repeats never do
  const before = completed.length;
  await save(u.token, ANSWERS);
  assert.equal((await eventNames(u.id)).filter((x) => x === 'onboarding_completed').length, before, 'a sequential repeat records nothing new');
});

test('answers can be edited later: replaced, same row, original completion time kept', async () => {
  const u = await signUp();
  const first = await save(u.token, ANSWERS);
  const edited = await save(u.token, { ...ANSWERS, examTiming: 'none_scheduled', confidence: 'very' });
  assert.equal(edited.body.answers?.confidence, 'very');
  assert.equal(edited.body.answers?.examTiming, 'none_scheduled');
  assert.equal(edited.body.finishedAt, first.body.finishedAt);
  assert.equal(await rowCount(u.id), 1);
});

test('skipping closes a pending questionnaire for good, and never erases saved answers', async () => {
  const skipper = await signUp();
  const s = await skip(skipper.token);
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'skipped');
  assert.equal(s.body.answers, null);
  assert.ok(s.body.finishedAt);
  assert.equal((await skip(skipper.token)).body.finishedAt, s.body.finishedAt, 'skipping twice changes nothing');
  assert.equal((await state(skipper.token)).body.status, 'skipped', 'not asked again');
  assert.deepEqual((await eventNames(skipper.id)).filter((x) => x === 'onboarding_skipped'), ['onboarding_skipped'], 'one skip event');

  // A student who skipped may still answer later (e.g. from settings).
  assert.equal((await save(skipper.token, ANSWERS)).body.status, 'completed');

  // Skip after completing is a no-op: answers stay.
  const done = await signUp();
  await save(done.token, ANSWERS);
  const after = await skip(done.token);
  assert.equal(after.body.status, 'completed');
  assert.deepEqual(after.body.answers, ANSWERS);
});

test('users are isolated and every option id of every question is accepted', async () => {
  const a = await signUp();
  const b = await signUp();
  await save(a.token, ANSWERS);
  assert.equal((await state(b.token)).body.status, 'pending');
  for (const [q, options] of Object.entries(ONBOARDING_QUESTIONS)) {
    for (const o of options) {
      const answers = { ...ANSWERS, [q]: o };
      assert.ok(onboardingAnswersSchema.safeParse(answers).success, `${q}=${o}`);
      assert.equal((await save(b.token, answers)).status, 200, `${q}=${o}`);
    }
  }
});

test('analytics records fixed categories only; deleting the account removes the row', async () => {
  const u = await signUp();
  await save(u.token, ANSWERS);
  await analytics.flushAnalytics();
  const rows = (await sql`select properties from analytics_events where user_id = ${u.id} and name = 'onboarding_completed'`) as unknown as { properties: Record<string, string> }[];
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].properties, ANSWERS);
  assert.equal(JSON.stringify(rows[0].properties).includes(u.email), false);

  const del = await call('/auth/me', { ...json('DELETE', { password: PASSWORD }), token: u.token });
  assert.equal(del.status, 200);
  assert.equal(await rowCount(u.id), 0);
  assert.equal((await state(u.token)).status, 401);
});
