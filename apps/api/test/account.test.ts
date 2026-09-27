/**
 * Account deletion: password re-auth, every user-owned row and file removed, analytics
 * anonymized, sessions invalidated, and other accounts untouched.
 */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Exam } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true' });
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { config } = await import('../src/config.js');
after(() => sql.end());

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
const RUN = Date.now();

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const json = (method: string, body: unknown, token?: string) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

async function newUser(tag: string) {
  const r = await call<AuthResponse>('/auth/register', json('POST', { email: `del-${tag}-${RUN}@example.com`, password: 'password123', name: 'Del' }));
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id, email: `del-${tag}-${RUN}@example.com` };
}
async function readyCourse(token: string) {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  assert.equal(up.status, 201);
  for (let i = 0; i < 50; i++) {
    if ((await call<DocumentDetail>(`/documents/${up.body.id}`, { token })).body.status === 'ready') return up.body.id;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('not ready');
}
const exists = (p: string) => access(p).then(() => true, () => false);
const counts = async (userId: string) => {
  const [r] = await sql`
    select
      (select count(*) from users where id = ${userId})::int as users,
      (select count(*) from documents where user_id = ${userId})::int as documents,
      (select count(*) from exams where user_id = ${userId})::int as exams,
      (select count(*) from topic_mastery where user_id = ${userId})::int as mastery,
      (select count(*) from subscriptions where user_id = ${userId})::int as subscriptions,
      (select count(*) from usage_ledger where user_id = ${userId})::int as usage,
      (select count(*) from analytics_events where user_id = ${userId})::int as events`;
  return r;
};

test('delete account: removes all data and files, anonymizes analytics, invalidates sessions', async () => {
  const victim = await newUser('victim');
  const bystander = await newUser('bystander');
  const docId = await readyCourse(victim.token);
  const otherDoc = await readyCourse(bystander.token);
  const exam = await call<Exam>(`/documents/${docId}/exams`, json('POST', { questionCount: 4 }, victim.token));
  assert.equal(exam.status, 201);
  const answers = exam.body.questions.map((q) => ({ questionId: q.id, answer: 'wrong' }));
  assert.equal((await call(`/exams/${exam.body.id}/submit`, json('POST', { answers }, victim.token))).status, 200);
  await call('/billing/purchase', json('POST', { planId: 'student_monthly', startTrial: true }, victim.token));
  const anonymousId = crypto.randomUUID();
  await call('/events', json('POST', { anonymousId, events: [{ name: 'app_opened', properties: { platform: 'ios', authenticated: false } }] }));
  await call('/events', json('POST', { anonymousId, events: [{ name: 'app_opened', properties: { platform: 'ios', authenticated: true } }] }, victim.token));
  await flushAnalytics();

  const before = await counts(victim.id);
  assert.ok(before.documents === 1 && before.exams === 1 && before.mastery > 0 && before.subscriptions === 1 && before.usage > 0 && before.events > 0);
  const [{ n: questionsBefore }] = await sql`select count(*)::int as n from questions where exam_id = ${exam.body.id}`;
  assert.ok(questionsBefore > 0);
  const userDir = join(resolve(config.STORAGE_DIR), victim.id);
  assert.ok(await exists(userDir), 'uploaded file stored');

  // Guard rails: auth required, password required and checked.
  assert.equal((await call('/auth/me', { method: 'DELETE' })).status, 401);
  assert.equal((await call('/auth/me', json('DELETE', {}, victim.token))).status, 400);
  const wrong = await call<{ code: string }>('/auth/me', json('DELETE', { password: 'not-it' }, victim.token));
  assert.deepEqual([wrong.status, wrong.body.code], [403, 'password_incorrect']);
  assert.equal((await counts(victim.id)).users, 1, 'nothing deleted on a wrong password');

  const del = await call<{ hadActiveSubscription: boolean }>('/auth/me', json('DELETE', { password: 'password123' }, victim.token));
  assert.equal(del.status, 200);
  assert.equal(del.body.hadActiveSubscription, true);
  await flushAnalytics();

  // Every user-owned row is gone (cascade), including chunks/questions/answers.
  assert.deepEqual(await counts(victim.id), { users: 0, documents: 0, exams: 0, mastery: 0, subscriptions: 0, usage: 0, events: 0 });
  const [{ n: chunks }] = await sql`select count(*)::int as n from document_chunks where document_id = ${docId}`;
  const [{ n: qs }] = await sql`select count(*)::int as n from questions where exam_id = ${exam.body.id}`;
  assert.deepEqual([chunks, qs], [0, 0]);
  assert.equal(await exists(userDir), false, 'uploaded files deleted');

  // Analytics kept only as anonymous counts: no user link and no install id.
  const [{ n: linked }] = await sql`select count(*)::int as n from analytics_events where anonymous_id = ${anonymousId}`;
  assert.equal(linked, 0);
  const [deletedEvent] = await sql`select user_id, properties from analytics_events where name = 'account_deleted' order by created_at desc limit 1`;
  assert.equal(deletedEvent.user_id, null);

  // The old session no longer works anywhere.
  for (const path of ['/auth/me', '/documents', '/billing/status']) {
    const r = await call<{ code: string }>(path, { token: victim.token });
    assert.deepEqual([r.status, r.body.code], [401, 'account_deleted'], path);
  }
  assert.equal((await call('/auth/login', json('POST', { email: victim.email, password: 'password123' }))).status, 401);

  // Other accounts are untouched.
  assert.equal((await call(`/documents/${otherDoc}`, { token: bystander.token })).status, 200);
  assert.ok(await exists(join(resolve(config.STORAGE_DIR), bystander.id)));

  // The email can be used again for a brand-new, empty account.
  const again = await call<AuthResponse>('/auth/register', json('POST', { email: victim.email, password: 'password123', name: 'New' }));
  assert.equal(again.status, 201);
  assert.notEqual(again.body.user.id, victim.id);
  assert.equal((await call<DocumentDetail[]>('/documents', { token: again.body.token })).body.length, 0);
});
