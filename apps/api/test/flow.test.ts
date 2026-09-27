/**
 * End-to-end test of the core loop against a real Postgres (DATABASE_URL) with the mock AI:
 * register → upload PDF → processing → exam → submit → weak areas → follow-up exam.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, DocumentProgress, Exam, GradedQuestion } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');

after(() => sql.end());

let token = '';
const call = async <T>(path: string, init: RequestInit = {}) => {
  const res = await app.request(path, {
    ...init,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
};
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

test('core study loop', async () => {
  const email = `student-${Date.now()}@example.com`;
  const reg = await call<AuthResponse>('/auth/register', json({ email, password: 'password123', name: 'Test Student' }));
  assert.equal(reg.status, 201);
  token = reg.body.token;

  assert.equal((await call('/documents')).status, 200);
  const anon = await app.request('/documents');
  assert.equal(anon.status, 401);

  // Upload
  const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
  const form = new FormData();
  form.append('file', new File([pdf], 'biology-notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form });
  assert.equal(up.status, 201);
  assert.equal(up.body.status, 'processing');

  // Wait for background processing
  let doc = up.body;
  for (let i = 0; i < 50 && doc.status === 'processing'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    doc = (await call<DocumentDetail>(`/documents/${doc.id}`)).body;
  }
  assert.equal(doc.status, 'ready', doc.error ?? '');
  assert.equal(doc.pageCount, 3);
  assert.ok(doc.topics.length > 0);

  // Follow-up before any exam is rejected
  assert.equal((await call(`/documents/${doc.id}/exams`, json({ kind: 'follow_up' }))).status, 409);

  // Generate + take an exam, answering everything wrong except the first question
  const exam = await call<Exam>(`/documents/${doc.id}/exams`, json({ questionCount: 5 }));
  assert.equal(exam.status, 201);
  assert.equal(exam.body.questions.length, 5);
  assert.ok(!('correctAnswer' in exam.body.questions[0]), 'answers must not leak before submission');

  const answers = exam.body.questions.map((q, i) => ({
    questionId: q.id,
    answer: i === 0 && q.options ? q.options[0] : 'no idea',
  }));
  const graded = await call<Exam>(`/exams/${exam.body.id}/submit`, json({ answers }));
  assert.equal(graded.status, 200);
  assert.equal(graded.body.status, 'graded');
  assert.ok((graded.body.questions as GradedQuestion[]).every((q) => typeof q.feedback === 'string'));
  assert.equal((await call(`/exams/${exam.body.id}/submit`, json({ answers }))).status, 409);

  // Weak areas
  const progress = await call<DocumentProgress>(`/documents/${doc.id}/progress`);
  assert.equal(progress.status, 200);
  assert.ok(progress.body.weakTopics.length > 0);
  assert.equal(progress.body.exams.length, 1);

  // Personalized follow-up targets only weak topics
  const follow = await call<Exam>(`/documents/${doc.id}/exams`, json({ kind: 'follow_up', questionCount: 4 }));
  assert.equal(follow.status, 201);
  assert.equal(follow.body.kind, 'follow_up');
  for (const q of follow.body.questions) assert.ok(progress.body.weakTopics.includes(q.topic), q.topic);

  // Ownership: another user cannot see this document
  const other = await call<AuthResponse>('/auth/register', json({ email: `other-${Date.now()}@example.com`, password: 'password123', name: 'Other' }));
  token = other.body.token;
  assert.equal((await call(`/documents/${doc.id}`)).status, 404);
  assert.equal((await call(`/exams/${exam.body.id}`)).status, 404);
  assert.equal((await call('/documents/not-a-uuid')).status, 404);
});

test('upload uses the optional "title" field for the document name (mobile sends a generated file name)', async () => {
  const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
  const form = new FormData();
  form.append('file', new File([pdf], '3F2A9C1E-5B7D-4E8A-9C0F-1234567890AB.pdf', { type: 'application/pdf' }));
  form.append('title', 'Lecture 1 – Plants.pdf');
  const res = await call<DocumentDetail>('/documents', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Lecture 1 – Plants');

  // Without "title" the file name is used, as before (web uploads).
  const plain = new FormData();
  plain.append('file', new File([pdf], 'week2.pdf', { type: 'application/pdf' }));
  const second = await call<DocumentDetail>('/documents', { method: 'POST', body: plain });
  assert.equal(second.body.title, 'week2');

  // Let background processing finish before the DB connection is closed.
  for (const id of [res.body.id, second.body.id]) {
    for (let i = 0; i < 50 && (await call<DocumentDetail>(`/documents/${id}`)).body.status === 'processing'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});
