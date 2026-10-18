/**
 * Exam timer, server side: the app reports the time spent (durationSeconds) with the submit; it is
 * stored on the exam (exams.duration_seconds) and returned with the graded results. Optional — older
 * apps that do not send it still submit — and validated, so a bad value never changes an exam.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Exam } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { MAX_EXAM_DURATION_SECONDS } = await import('@study/shared');

after(() => sql.end());

let token = '';
let documentId = '';
const call = async <T>(path: string, init: RequestInit = {}) => {
  const res = await app.request(path, { ...init, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
};
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const newExam = async () => {
  const r = await call<Exam>(`/documents/${documentId}/exams`, json({ questionCount: 3 }));
  assert.equal(r.status, 201);
  return r.body;
};
const answersFor = (exam: Exam) => exam.questions.map((q) => ({ questionId: q.id, answer: q.options ? q.options[0] : 'an answer' }));

before(async () => {
  const reg = await call<AuthResponse>('/auth/register', json({ email: `timer-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'Timer Student', ageRange: '18_24' }));
  assert.equal(reg.status, 201);
  token = reg.body.token;
  const form = new FormData();
  form.append('file', new File([await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url))], 'biology-notes.pdf', { type: 'application/pdf' }));
  let doc = (await call<DocumentDetail>('/documents', { method: 'POST', body: form })).body;
  for (let i = 0; i < 50 && doc.status === 'processing'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    doc = (await call<DocumentDetail>(`/documents/${doc.id}`)).body;
  }
  assert.equal(doc.status, 'ready');
  documentId = doc.id;
});

test('submit stores the time taken and the results return it (also when the exam is opened again later)', async () => {
  const exam = await newExam();
  assert.equal(exam.durationSeconds, undefined, 'an exam in progress has no time yet');
  const graded = await call<Exam>(`/exams/${exam.id}/submit`, json({ answers: answersFor(exam), durationSeconds: 754 }));
  assert.equal(graded.status, 200);
  assert.deepEqual([graded.body.status, graded.body.durationSeconds], ['graded', 754]);
  const again = await call<Exam>(`/exams/${exam.id}`);
  assert.deepEqual([again.body.status, again.body.durationSeconds], ['graded', 754], 'review screen after leaving and coming back');
  const [row] = await sql`select duration_seconds from exams where id = ${exam.id}`;
  assert.equal(row.duration_seconds, 754);
});

test('long exams keep hours (HH:MM:SS on screen); zero is a valid time', async () => {
  const long = await newExam();
  assert.equal((await call<Exam>(`/exams/${long.id}/submit`, json({ answers: answersFor(long), durationSeconds: 3 * 3600 + 25 }))).body.durationSeconds, 10_825);
  const instant = await newExam();
  assert.equal((await call<Exam>(`/exams/${instant.id}/submit`, json({ answers: answersFor(instant), durationSeconds: 0 }))).body.durationSeconds, 0);
});

test('older apps that send no time still submit; the results simply have no time', async () => {
  const exam = await newExam();
  const graded = await call<Exam>(`/exams/${exam.id}/submit`, json({ answers: answersFor(exam) }));
  assert.equal(graded.status, 200);
  assert.equal(graded.body.durationSeconds, null);
});

test('invalid times are refused before grading, and the exam (with its answers) can still be submitted', async () => {
  const exam = await newExam();
  for (const durationSeconds of [-1, 1.5, MAX_EXAM_DURATION_SECONDS + 1, '60', null, Number.MAX_SAFE_INTEGER]) {
    const r = await call<{ code?: string }>(`/exams/${exam.id}/submit`, json({ answers: answersFor(exam), durationSeconds }));
    assert.equal(r.status, 400, `durationSeconds ${String(durationSeconds)}`);
  }
  assert.equal((await call<Exam>(`/exams/${exam.id}`)).body.status, 'in_progress', 'nothing was graded or stored');
  const ok = await call<Exam>(`/exams/${exam.id}/submit`, json({ answers: answersFor(exam), durationSeconds: MAX_EXAM_DURATION_SECONDS }));
  assert.deepEqual([ok.status, ok.body.durationSeconds], [200, MAX_EXAM_DURATION_SECONDS]);
  // A second submit cannot overwrite the recorded time.
  assert.equal((await call(`/exams/${exam.id}/submit`, json({ answers: answersFor(exam), durationSeconds: 5 }))).status, 409);
  assert.equal((await call<Exam>(`/exams/${exam.id}`)).body.durationSeconds, MAX_EXAM_DURATION_SECONDS);
});

test('the migration adds one nullable column and no table', async () => {
  const sqlText = await readFile(new URL('../drizzle/0019_exam_duration.sql', import.meta.url), 'utf8');
  assert.equal(sqlText.trim(), 'ALTER TABLE "exams" ADD COLUMN "duration_seconds" integer;');
});
