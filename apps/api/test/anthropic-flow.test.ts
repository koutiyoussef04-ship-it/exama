/**
 * Full study loop through the HTTP API with AI_PROVIDER=anthropic, where the
 * "Anthropic API" is a local fake. Proves every AI step goes through the real
 * provider code path, that ungrounded questions are filtered out, that AI failures
 * surface as clear errors, and that the API key never appears in any response.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AuthResponse, DocumentDetail, DocumentProgress, Exam, GradedQuestion } from '@study/shared';
import { promptOf, startFakeAnthropic, type FakeReply, type FakeRequest } from './helpers/fake-anthropic.js';

const KEY = 'sk-ant-test-SECRET-never-leak';
const WORKSPACE = 'wrkspc_01FlowTestWorkspace';
const FACTS: Record<string, string> = {
  Photosynthesis: 'Chlorophyll absorbs mostly red and blue light and reflects green light',
  'Calvin cycle': 'The Calvin cycle takes place in the stroma of the chloroplast',
  'Cellular respiration': 'Glycolysis is the first stage of cellular respiration and happens in the cytoplasm',
};

let failure: FakeReply | null = null;
function fakeClaude(req: FakeRequest): FakeReply {
  if (failure) return failure;
  const p = promptOf(req);
  if (p.includes('describe what it covers')) {
    return { text: JSON.stringify({ summary: 'Notes on how plants make and use energy.', topics: Object.keys(FACTS) }) };
  }
  if (p.includes('exam questions')) {
    const count = Number(/Write exactly (\d+)/.exec(p)![1]);
    const allowed = JSON.parse(`[${/one of exactly these names[^:]*: (.*)\.\n/.exec(p)![1]}]`) as string[];
    const questions = Array.from({ length: count - 1 }, (_, i) => {
      const topic = allowed[i % allowed.length];
      return i % 2 === 0
        ? { type: 'mcq', topic, prompt: `Q${i} about ${topic}?`, options: ['Right', 'Wrong A', 'Wrong B', 'Wrong C'], correctAnswer: 'Right', explanation: 'Per the notes.', sourceQuote: FACTS[topic] }
        : { type: 'short_answer', topic, prompt: `Explain ${topic} (${i}).`, options: null, correctAnswer: FACTS[topic], explanation: 'Per the notes.', sourceQuote: FACTS[topic] };
    });
    // One hallucinated question whose "quote" is not in the PDF — must be filtered out.
    questions.push({ type: 'short_answer', topic: allowed[0], prompt: 'FABRICATED question', options: null, correctAnswer: 'x', explanation: 'x', sourceQuote: 'Mitochondria were discovered on the moon in 1492 by astronauts' });
    return { text: JSON.stringify({ questions }) };
  }
  if (p.includes('Grade each student answer')) {
    const items = [...p.matchAll(/<item id="([^"]+)">[\s\S]*?<student_answer>([\s\S]*?)<\/student_answer>/g)];
    return {
      text: JSON.stringify({
        grades: items.map(([, id, answer]) => ({ id, score: /stroma|cytoplasm|light/i.test(answer) ? 1 : 0, feedback: 'Compared with your notes.' })),
      }),
    };
  }
  return { status: 400, errorType: 'invalid_request_error' };
}

let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
let app: typeof import('../src/app.js').app;
let sql: typeof import('../src/db/client.js').sql;
const bodies: string[] = [];
let token = '';

before(async () => {
  fake = await startFakeAnthropic(fakeClaude);
  await import('./helpers/no-plan-limits.js');
  Object.assign(process.env, { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY, AI_MODEL: 'claude-fake', ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_WORKSPACE_ID: WORKSPACE });
  ({ app } = await import('../src/app.js'));
  ({ sql } = await import('../src/db/client.js'));
});
after(async () => {
  await sql.end();
  await fake.close();
});

async function call<T>(path: string, init: RequestInit = {}) {
  const res = await app.request(path, { ...init, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.headers ?? {}) } });
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const json = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
async function upload() {
  const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
  const form = new FormData();
  form.append('file', new File([pdf], 'biology-notes.pdf', { type: 'application/pdf' }));
  return call<DocumentDetail>('/documents', { method: 'POST', body: form });
}
async function waitDone(id: string) {
  for (let i = 0; i < 50; i++) {
    const d = await call<DocumentDetail>(`/documents/${id}`);
    if (d.body.status !== 'processing') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

test('full loop uses the Anthropic provider for every AI step', async () => {
  const health = await call<{ ok: boolean; ai: unknown }>('/health');
  assert.deepEqual(health.body, { ok: true, ai: { provider: 'anthropic', model: 'claude-fake' } });

  token = (await call<AuthResponse>('/auth/register', json({ email: `ai-${Date.now()}@example.com`, password: 'password123', name: 'AI Tester' }))).body.token;

  // 1-2. Summary + topic extraction
  const doc = await waitDone((await upload()).body.id);
  assert.equal(doc.status, 'ready', doc.error ?? '');
  assert.deepEqual(doc.topics, Object.keys(FACTS));
  assert.equal(doc.summary, 'Notes on how plants make and use energy.');
  assert.match(promptOf(fake.requests[0]), /Calvin cycle/, 'real PDF text was sent to the model');

  // 3. Exam generation — hallucinated question filtered out
  const exam = await call<Exam>(`/documents/${doc.id}/exams`, json({ questionCount: 4 }));
  assert.equal(exam.status, 201);
  assert.equal(exam.body.questions.length, 4);
  assert.ok(!exam.body.questions.some((q) => q.prompt.includes('FABRICATED')), 'ungrounded question must be dropped');

  // 4-5. Answer + AI grading (short answers go to the model, MCQs are checked locally)
  const answers = exam.body.questions.map((q) => ({ questionId: q.id, answer: q.options ? 'Wrong A' : 'no idea' }));
  const graded = await call<Exam>(`/exams/${exam.body.id}/submit`, json({ answers }));
  assert.equal(graded.status, 200);
  const gq = graded.body.questions as GradedQuestion[];
  assert.ok(gq.filter((q) => q.type === 'short_answer').every((q) => q.feedback === 'Compared with your notes.'));
  assert.ok(gq.every((q) => q.sourceQuote.length > 0));
  const gradeReq = fake.requests.find((r) => promptOf(r).includes('Grade each student answer'))!;
  assert.match(promptOf(gradeReq), /<source>/);

  // 6. Weak topics
  const progress = await call<DocumentProgress>(`/documents/${doc.id}/progress`);
  assert.ok(progress.body.weakTopics.length > 0);

  // 7. Personalised follow-up
  const follow = await call<Exam>(`/documents/${doc.id}/exams`, json({ kind: 'follow_up', questionCount: 3 }));
  assert.equal(follow.status, 201);
  for (const q of follow.body.questions) assert.ok(progress.body.weakTopics.includes(q.topic));
  const followReq = fake.requests.at(-1)!;
  assert.match(promptOf(followReq), /PERSONALISED FOLLOW-UP/);
  assert.match(promptOf(followReq), /Student answered/);
});

test('AI failures return clear errors and can be retried', async () => {
  const doc = await waitDone((await upload()).body.id);

  failure = { status: 401, errorType: 'authentication_error', message: 'invalid x-api-key' };
  const exam = await call<{ error: string; code: string }>(`/documents/${doc.id}/exams`, json({ questionCount: 3 }));
  assert.equal(exam.status, 502);
  assert.equal(exam.body.code, 'ai_auth');
  assert.match(exam.body.error, /rejected/);

  failure = { status: 429, errorType: 'rate_limit_error' };
  const busy = await call<{ code: string }>(`/documents/${doc.id}/exams`, json({ questionCount: 3 }));
  assert.equal(busy.status, 503);
  assert.equal(busy.body.code, 'ai_rate_limited');

  // Processing failure → friendly message on the document → retry succeeds
  failure = { status: 500, errorType: 'api_error' };
  const failed = await waitDone((await upload()).body.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error ?? '', /temporarily unavailable/);
  failure = null;
  assert.equal((await call(`/documents/${failed.id}/reprocess`, { method: 'POST' })).status, 200);
  assert.equal((await waitDone(failed.id)).status, 'ready');
});

test('every Anthropic request carried the configured workspace header', () => {
  assert.ok(fake.requests.length > 5);
  for (const r of fake.requests) assert.equal(r.headers['anthropic-workspace-id'], WORKSPACE);
});

test('the API key and workspace ID never appear in any API response', () => {
  assert.ok(bodies.length > 10);
  for (const b of bodies) {
    assert.ok(!b.includes(KEY) && !b.includes('sk-ant'), `key leaked in: ${b.slice(0, 200)}`);
    assert.ok(!b.includes(WORKSPACE) && !b.includes('wrkspc_'), `workspace ID leaked in: ${b.slice(0, 200)}`);
  }
});
