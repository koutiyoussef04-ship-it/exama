/**
 * Multilingual AI through the HTTP API (mock AI): the study language chosen at upload drives the
 * summary; exams/practice/feedback follow the requested language; "source" follows the material;
 * errors carry stable codes the app translates.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Exam, GradedQuestion } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock' });
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { detectLanguage } = await import('../src/ai/mock-study-ai.js');
after(() => sql.end());

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
let token = '';

async function call<T>(path: string, init: RequestInit = {}) {
  const res = await app.request(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

async function upload(language?: string, bytes: Uint8Array<ArrayBuffer> = pdf as Uint8Array<ArrayBuffer>) {
  const form = new FormData();
  form.append('file', new File([bytes], 'notes.pdf', { type: 'application/pdf' }));
  if (language !== undefined) form.append('language', language);
  return call<DocumentDetail & { code?: string }>('/documents', { method: 'POST', body: form });
}
async function settle(id: string) {
  for (let i = 0; i < 50; i++) {
    const d = await call<DocumentDetail>(`/documents/${id}`);
    if (d.body.status !== 'processing') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('still processing');
}

before(async () => {
  const r = await app.request('/auth/register', post({ email: `i18n-${Date.now()}@example.com`, password: 'password123', name: 'Polyglot' }));
  token = ((await r.json()) as AuthResponse).token;
});

test('summary follows the study language; the material language is detected', async () => {
  const es = await settle((await upload('es')).body.id);
  assert.equal(es.status, 'ready');
  assert.deepEqual([es.summaryLanguage, es.sourceLanguage], ['es', 'en']);
  assert.match(es.summary!, /^\[mock:es\]/);

  const source = await settle((await upload('source')).body.id);
  assert.deepEqual([source.summaryLanguage, source.sourceLanguage], ['en', 'en'], '"source" = same language as the material');

  const legacy = await settle((await upload()).body.id);
  assert.equal(legacy.summaryLanguage, 'en', 'older apps without the field get English');
  const bogus = await settle((await upload('klingon')).body.id);
  assert.equal(bogus.summaryLanguage, 'en', 'invalid values fall back to English');
});

test('exams, practice and feedback use the requested language (default: the course language)', async () => {
  const doc = await settle((await upload('fr')).body.id);

  const byDefault = await call<Exam>(`/documents/${doc.id}/exams`, post({ questionCount: 4 }));
  assert.equal(byDefault.status, 201);
  assert.equal(byDefault.body.language, 'fr', 'defaults to the course summary language');
  assert.ok(byDefault.body.questions.every((q) => q.prompt.startsWith('[mock:fr]')));

  // App in Spanish, material in English, exam in Arabic.
  const ar = await call<Exam>(`/documents/${doc.id}/exams`, post({ questionCount: 5, language: 'ar' }));
  assert.equal(ar.body.language, 'ar');
  assert.ok(ar.body.questions.every((q) => q.prompt.startsWith('[mock:ar]')));
  // Topic names stay exactly as extracted (mastery is tracked per topic).
  assert.ok(ar.body.questions.every((q) => doc.topics.includes(q.topic)));

  const answers = ar.body.questions.map((q, i) => ({ questionId: q.id, answer: i === 0 ? '' : q.type === 'mcq' ? 'wrong' : 'something' }));
  const graded = await call<Exam>(`/exams/${ar.body.id}/submit`, post({ answers }));
  assert.equal(graded.status, 200);
  const gq = graded.body.questions as GradedQuestion[];
  assert.equal(gq[0].feedback, 'لم تُقدَّم إجابة.', 'server-written feedback is localized');
  assert.ok(gq.filter((q, i) => i > 0 && q.type === 'mcq').every((q) => q.feedback.startsWith('إجابة خاطئة.')));
  assert.ok(gq.filter((q, i) => i > 0 && q.type === 'short_answer').every((q) => q.feedback.startsWith('[mock:ar]')), 'AI feedback in the exam language');

  // Weak-topic practice in Spanish, grounded in the same material.
  const practice = await call<Exam>(`/documents/${doc.id}/exams`, post({ kind: 'follow_up', questionCount: 3, language: 'es' }));
  assert.equal(practice.status, 201);
  assert.equal(practice.body.language, 'es');
  assert.ok(practice.body.questions.every((q) => q.prompt.startsWith('[mock:es]')));

  const src = await call<Exam>(`/documents/${doc.id}/exams`, post({ questionCount: 3, language: 'source' }));
  assert.equal(src.body.language, 'en', '"source" resolves to the detected material language');
  assert.equal((await call(`/documents/${doc.id}/exams`, post({ questionCount: 3, language: 'de' }))).status, 400, 'unsupported languages are rejected');
});

test('errors carry stable codes for translation (API + processing failures)', async () => {
  const notPdf = await upload('en', new TextEncoder().encode('hello world, not a pdf'));
  assert.deepEqual([notPdf.status, notPdf.body.code], [415, 'not_pdf']);

  const broken = await settle((await upload('en', new TextEncoder().encode('%PDF-1.4 this is not really a pdf'))).body.id);
  assert.deepEqual([broken.status, broken.errorCode], ['failed', 'pdf_unreadable']);
  assert.ok(broken.error, 'English fallback message kept');

  const missing = await call<{ code: string }>('/documents/00000000-0000-0000-0000-000000000000');
  assert.deepEqual([missing.status, missing.body.code], [404, 'not_found']);
  const noWeak = await call<{ code: string }>(`/documents/${(await settle((await upload('en')).body.id)).id}/exams`, post({ kind: 'follow_up' }));
  assert.deepEqual([noWeak.status, noWeak.body.code], [409, 'no_weak_topics']);
});

test('mock language detection (offline development)', () => {
  assert.equal(detectLanguage('La photosynthèse est le processus par lequel les plantes et les algues produisent du glucose.'), 'fr');
  assert.equal(detectLanguage('La fotosíntesis es el proceso por el que las plantas y los organismos producen glucosa.'), 'es');
  assert.equal(detectLanguage('التمثيل الضوئي هو العملية التي تستخدم فيها النباتات ضوء الشمس لإنتاج الغذاء من الماء وثاني أكسيد الكربون'), 'ar');
  assert.equal(detectLanguage('Photosynthesis is the process by which plants and algae produce glucose with light.'), 'en');
});
