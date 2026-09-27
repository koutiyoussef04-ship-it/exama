/**
 * Product analytics: server events along the core loop, the client /events endpoint's
 * allowlist, privacy (no free text / secrets stored) and fault isolation.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Exam } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const analytics = await import('../src/analytics/index.js');

after(() => sql.end());

const PASSWORD = 'correct-horse-battery-staple';
const SECRET_ANSWER = 'my private written answer about chloroplasts 12345';
const ANON = crypto.randomUUID();

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, {
    ...rest,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const json = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });

type Row = { name: string; source: string; user_id: string | null; anonymous_id: string | null; properties: Record<string, unknown> };
async function eventsFor(userId: string): Promise<Row[]> {
  await analytics.flushAnalytics();
  return (await sql`select name, source, user_id, anonymous_id, properties from analytics_events where user_id = ${userId} order by created_at, name`) as unknown as Row[];
}
const byName = (rows: Row[], name: string) => rows.filter((r) => r.name === name);

async function waitProcessed(id: string, token: string) {
  for (let i = 0; i < 50; i++) {
    const d = await call<DocumentDetail>(`/documents/${id}`, { token });
    if (d.body.status !== 'processing') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('processing timeout');
}

let email = '';
let token = '';
let userId = '';

test('server records the core funnel events with minimal properties', async () => {
  email = `analytics-${Date.now()}@example.com`;
  const reg = await call<AuthResponse>('/auth/register', json({ email, password: PASSWORD, name: 'Private Name' }));
  token = reg.body.token;
  userId = reg.body.user.id;
  assert.equal((await call('/auth/login', json({ email, password: PASSWORD }))).status, 200);

  // Upload + processing
  const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
  const form = new FormData();
  form.append('file', new File([pdf], 'Secret Lecture Title.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  const doc = await waitProcessed(up.body.id, token);
  assert.equal(doc.status, 'ready');

  // Exam → submit with a written answer → practice → submit → delete
  const exam = await call<Exam>(`/documents/${doc.id}/exams`, { ...json({ questionCount: 4 }), token });
  const answers = exam.body.questions.map((q) => ({ questionId: q.id, answer: q.options ? 'definitely wrong' : SECRET_ANSWER }));
  assert.equal((await call(`/exams/${exam.body.id}/submit`, { ...json({ answers }), token })).status, 200);
  const practice = await call<Exam>(`/documents/${doc.id}/exams`, { ...json({ kind: 'follow_up', questionCount: 3 }), token });
  assert.equal(practice.status, 201);
  const practiceAnswers = practice.body.questions.map((q) => ({ questionId: q.id, answer: '' }));
  assert.equal((await call(`/exams/${practice.body.id}/submit`, { ...json({ answers: practiceAnswers }), token })).status, 200);
  assert.equal((await call(`/documents/${doc.id}`, { method: 'DELETE', token })).status, 204);

  const rows = await eventsFor(userId);
  assert.ok(rows.every((r) => r.source === 'server' && r.user_id === userId));
  for (const name of ['signup_completed', 'login_completed', 'upload_succeeded', 'document_processing_completed', 'course_deleted', 'exam_completed', 'practice_completed']) {
    assert.equal(byName(rows, name).length, 1, name);
  }
  assert.equal(byName(rows, 'exam_generation_started').length, 2);
  assert.equal(byName(rows, 'exam_generation_completed').length, 2);

  const upload = byName(rows, 'upload_succeeded')[0].properties;
  assert.equal(upload.document_id, doc.id);
  assert.equal(typeof upload.file_size_kb, 'number');

  const processed = byName(rows, 'document_processing_completed')[0].properties;
  assert.deepEqual(
    { success: processed.success, page_count: processed.page_count, topic_count: processed.topic_count },
    { success: true, page_count: 3, topic_count: doc.topics.length },
  );
  assert.equal(typeof processed.duration_ms, 'number');

  const gens = byName(rows, 'exam_generation_completed').map((r) => r.properties);
  assert.deepEqual(gens.map((g) => g.kind).sort(), ['follow_up', 'standard']);
  assert.ok(gens.every((g) => g.success === true && typeof g.exam_id === 'string'));

  const done = byName(rows, 'exam_completed')[0].properties;
  assert.equal(done.exam_id, exam.body.id);
  assert.equal(done.question_count, 4);
  assert.equal(done.answered_count, 4);
  assert.equal(typeof done.score_pct, 'number');
  assert.ok((done.weak_topic_count as number) > 0);
  const practiceDone = byName(rows, 'practice_completed')[0].properties;
  assert.equal(practiceDone.answered_count, 0);
  assert.equal(practiceDone.score_pct, 0);
});

test('processing failures are recorded with a category, not the error message', async () => {
  const bad = new FormData();
  // Valid PDF header but no readable content → processing fails.
  bad.append('file', new File([new TextEncoder().encode('%PDF-1.4 broken')], 'broken.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: bad, token });
  const doc = await waitProcessed(up.body.id, token);
  assert.equal(doc.status, 'failed');
  const failed = byName(await eventsFor(userId), 'document_processing_completed').find((r) => r.properties.document_id === doc.id)!;
  assert.equal(failed.properties.success, false);
  assert.equal(failed.properties.failure_reason, 'unreadable_pdf');
  assert.equal(Object.keys(failed.properties).sort().join(), 'document_id,duration_ms,failure_reason,success');
});

test('client events: accepted when allowlisted, linked to user when signed in, anonymous otherwise', async () => {
  const docId = '11111111-2222-4333-8444-555555555555';
  const signedIn = await call<{ accepted: number }>('/events', {
    ...json({
      anonymousId: ANON,
      events: [
        { name: 'app_opened', properties: { platform: 'ios', authenticated: true } },
        { name: 'upload_started', properties: { platform: 'ios', file_size_kb: 812 } },
        { name: 'upload_failed', properties: { platform: 'ios', failure_reason: 'network' } },
        { name: 'course_opened', properties: { document_id: docId, status: 'ready' } },
        { name: 'exam_started', properties: { exam_id: docId, document_id: docId, question_count: 8 } },
        { name: 'practice_started', properties: { exam_id: docId, document_id: docId, question_count: 6 } },
      ],
    }),
    token,
  });
  assert.equal(signedIn.status, 202);
  assert.equal(signedIn.body.accepted, 6);
  const client = (await eventsFor(userId)).filter((r) => r.source === 'client');
  assert.equal(client.length, 6);
  assert.ok(client.every((r) => r.anonymous_id === ANON));

  const anonId = crypto.randomUUID(); // fresh per run so re-runs don't see old rows
  assert.equal((await call('/events', json({ anonymousId: anonId, events: [{ name: 'app_opened', properties: { platform: 'android', authenticated: false } }] }))).status, 202);
  assert.equal((await call('/events', { ...json({ anonymousId: anonId, events: [{ name: 'app_opened', properties: { platform: 'web', authenticated: false } }] }), token: 'not-a-valid-token' })).status, 202);
  await analytics.flushAnalytics();
  const anon = (await sql`select user_id from analytics_events where anonymous_id = ${anonId}`) as unknown as { user_id: string | null }[];
  assert.equal(anon.length, 2);
  assert.ok(anon.every((r) => r.user_id === null));
});

test('client events: rejects unknown events, server-only events, extra/free-text properties and oversized batches', async () => {
  const send = (events: unknown[], anonymousId: unknown = ANON) => call('/events', { ...json({ anonymousId, events }), token });
  const ok = { name: 'app_opened', properties: { platform: 'ios', authenticated: true } };

  assert.equal((await send([{ name: 'something_else', properties: {} }])).status, 400);
  assert.equal((await send([{ name: 'signup_completed', properties: {} }])).status, 400, 'server-only event');
  assert.equal((await send([{ name: 'exam_completed', properties: {} }])).status, 400, 'server-only event');
  assert.equal((await send([{ ...ok, properties: { ...ok.properties, answer: SECRET_ANSWER } }])).status, 400, 'extra property');
  assert.equal((await send([{ name: 'upload_failed', properties: { platform: 'ios', failure_reason: 'the file was called Secret.pdf' } }])).status, 400, 'free-text reason');
  assert.equal((await send([{ name: 'course_opened', properties: { document_id: 'Secret Lecture Title', status: 'ready' } }])).status, 400, 'non-uuid id');
  assert.equal((await send(Array.from({ length: 21 }, () => ok))).status, 400, 'batch too large');
  assert.equal((await send([])).status, 400, 'empty batch');
  assert.equal((await send([ok], 'user@example.com')).status, 400, 'anonymousId must be a random uuid');
});

test('no passwords, emails, names, file names, PDF text or written answers are stored', async () => {
  const all = JSON.stringify(await eventsFor(userId));
  for (const secret of [PASSWORD, email, 'Private Name', 'Secret Lecture Title', SECRET_ANSWER, 'chloroplast', 'Calvin', 'Photosynthesis']) {
    assert.ok(!all.includes(secret), `analytics must not contain "${secret}"`);
  }
});

test('an analytics outage never breaks the product flow', async () => {
  const failing: import('../src/analytics/index.js').AnalyticsSink = {
    name: 'broken',
    record: async () => {
      throw new Error('analytics backend down');
    },
  };
  const original = [...analytics.sinks];
  analytics.sinks.splice(0, analytics.sinks.length, failing);
  try {
    const res = await call<AuthResponse>('/auth/register', json({ email: `outage-${Date.now()}@example.com`, password: PASSWORD, name: 'X' }));
    assert.equal(res.status, 201);
    const ev = await call('/events', json({ anonymousId: ANON, events: [{ name: 'app_opened', properties: { platform: 'ios', authenticated: false } }] }));
    assert.equal(ev.status, 202);
    await analytics.flushAnalytics();
  } finally {
    analytics.sinks.splice(0, analytics.sinks.length, ...original);
  }
});
