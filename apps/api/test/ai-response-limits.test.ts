/**
 * Response-length limits for long AI replies (exams and flashcard decks).
 *
 * The fake model below behaves like a real one with a response limit: every item it writes "costs"
 * a number of tokens, and a reply that would need more than the request's max_tokens is cut off with
 * stop_reason "max_tokens". Before this fix, a 20-question exam was one reply of ~22 questions under a
 * 12,000-token limit and failed this way in production (Arabic and quotes in a second language cost
 * far more tokens per question than English).
 *
 * Covers: batching within the limit, splitting a batch that is still cut off, partial batch failures
 * (all-or-nothing, no duplicate calls), malformed output, Arabic content, and the exam service's
 * "never deliver an incomplete exam" rule end to end.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Exam } from '@study/shared';
import { AIError } from '../src/ai/errors.js';
import {
  batchSizes,
  FLASHCARD_REPLY_TOKENS,
  FLASHCARDS_PER_CALL,
  LLMStudyAI,
  QUESTION_REPLY_TOKENS,
  QUESTIONS_PER_CALL,
  replyBudget,
  topicsForPart,
} from '../src/ai/llm-study-ai.js';
import { AnthropicProvider } from '../src/ai/providers/anthropic.js';
import { MaterialIndex, validateQuestions } from '../src/lib/grounding.js';
import { promptOf, startFakeAnthropic, type FakeReply, type FakeRequest } from './helpers/fake-anthropic.js';

// ---------------------------------------------------------------- a fake model with a response limit

const countOf = (p: string) => Number(/Write exactly (\d+)/.exec(p)![1]);
const topicsOf = (p: string) => JSON.parse(`[${/one of exactly these names[^:]*: (.*)\.\n/.exec(p)![1]}]`) as string[];
const isExam = (p: string) => p.includes('exam questions');

type Model = {
  /** Tokens one generated item costs (English ≈ 300, Arabic ≈ 700 for a question). */
  tokensPerItem: number;
  /** Writes item `i` of a reply for this prompt. */
  item: (p: string, i: number) => Record<string, unknown>;
  /** Override a reply (failures, malformed output). Return null for the normal behaviour. */
  override?: (req: FakeRequest, n: number) => FakeReply | null;
};

function model(m: Model) {
  let n = 0;
  return (req: FakeRequest): FakeReply => {
    const o = m.override?.(req, n++);
    if (o) return o;
    const p = promptOf(req);
    const count = countOf(p);
    const items = Array.from({ length: count }, (_, i) => m.item(p, i));
    const text = JSON.stringify(isExam(p) ? { questions: items } : { cards: items });
    // Over the limit: the reply is cut off mid-way, exactly like the real API.
    if (count * m.tokensPerItem > req.body.max_tokens) return { text: text.slice(0, text.length / 2), stopReason: 'max_tokens' };
    return { text };
  };
}

const KEY = 'sk-ant-test-response-limits';
async function withModel(m: Model, fn: (ai: LLMStudyAI, requests: FakeRequest[]) => Promise<void>) {
  const fake = await startFakeAnthropic(model(m));
  try {
    await fn(new LLMStudyAI(new AnthropicProvider({ apiKey: KEY, model: 'claude-test', baseURL: fake.url, maxRetries: 0 })), fake.requests);
  } finally {
    await fake.close();
  }
}

// ---------------------------------------------------------------- Arabic course material

const AR_FACTS: Record<string, string> = {
  'البناء الضوئي': 'يمتص الكلوروفيل الضوء الأحمر والأزرق بشكل أساسي ويعكس الضوء الأخضر في أوراق النبات',
  'دورة كالفن': 'تحدث دورة كالفن في سدى البلاستيدة الخضراء وتستخدم الطاقة لتثبيت ثاني أكسيد الكربون',
  'التنفس الخلوي': 'التحلل السكري هو المرحلة الأولى من التنفس الخلوي ويحدث في السيتوبلازم داخل الخلية',
  'الميتوكوندريا': 'تنتج الميتوكوندريا معظم طاقة الخلية على شكل جزيئات أدينوسين ثلاثي الفوسفات',
  'الغشاء الخلوي': 'يتحكم الغشاء الخلوي في دخول المواد إلى الخلية وخروجها منها بشكل انتقائي',
  'النواة': 'تحتوي النواة على المادة الوراثية للخلية وتتحكم في أنشطتها المختلفة',
};
const AR_TOPICS = Object.keys(AR_FACTS);
const AR_EXCERPTS = Object.values(AR_FACTS).map((f) => `${f}.`);

let uid = 0;
const arQuestion = (p: string, i: number) => {
  const topics = topicsOf(p);
  const topic = topics[i % topics.length];
  const id = ++uid;
  return i % 2 === 0
    ? { type: 'mcq', topic, prompt: `السؤال ${id}: ما الذي يصح بشأن ${topic}؟`, options: ['الصحيح', 'خطأ أ', 'خطأ ب', 'خطأ ج'], correctAnswer: 'الصحيح', explanation: 'وفق المادة.', sourceQuote: AR_FACTS[topic] }
    : { type: 'short_answer', topic, prompt: `السؤال ${id}: اشرح ${topic}.`, options: null, correctAnswer: AR_FACTS[topic], explanation: 'وفق المادة.', sourceQuote: AR_FACTS[topic] };
};
const arCard = (p: string, i: number) => {
  const topics = topicsOf(p);
  const topic = topics[i % topics.length];
  return { topic, front: `بطاقة ${++uid}: ما ${topic}؟`, back: AR_FACTS[topic], sourceQuote: AR_FACTS[topic] };
};
const arExam = (count: number) => ({ excerpts: AR_EXCERPTS, topics: AR_TOPICS, count, language: 'ar' });

// ---------------------------------------------------------------- pure helpers

test('batch sizes: fewest batches within the per-call limit, as even as possible', () => {
  assert.deepEqual(batchSizes(22, 6), [6, 6, 5, 5]);
  assert.deepEqual(batchSizes(6, 6), [6]);
  assert.deepEqual(batchSizes(5, 6), [5]);
  assert.deepEqual(batchSizes(7, 6), [4, 3]);
  assert.deepEqual(batchSizes(22, 11), [11, 11]);
  assert.deepEqual(batchSizes(0, 6), []);
  for (let n = 1; n <= 40; n++) {
    const s = batchSizes(n, QUESTIONS_PER_CALL);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.ok(s.every((x) => x >= 1 && x <= QUESTIONS_PER_CALL));
  }
  // The biggest single reply stays far below the old 12,000 limit and finishes well within the timeout.
  assert.equal(replyBudget(QUESTIONS_PER_CALL, QUESTION_REPLY_TOKENS), 6000);
  assert.equal(replyBudget(FLASHCARDS_PER_CALL, FLASHCARD_REPLY_TOKENS), 5550);
});

test('topics are shared out between batches when there are enough of them', () => {
  assert.deepEqual(topicsForPart(['a', 'b', 'c', 'd', 'e'], 0, 2), ['a', 'c', 'e']);
  assert.deepEqual(topicsForPart(['a', 'b', 'c', 'd', 'e'], 1, 2), ['b', 'd']);
  assert.deepEqual(topicsForPart(['a'], 1, 4), ['a'], 'fewer topics than batches: every batch may use all of them');
  assert.deepEqual(topicsForPart(['a', 'b'], 0, 1), ['a', 'b']);
});

// ---------------------------------------------------------------- questions

test('a 22-question Arabic exam is written in 4 batches that each fit the response limit', async () => {
  await withModel({ tokensPerItem: 700, item: arQuestion }, async (ai, requests) => {
    const out = await ai.generateQuestions(arExam(22));
    assert.equal(out.length, 22);
    assert.equal(requests.length, 4, 'one request per batch, nothing repeated');
    assert.deepEqual(requests.map((r) => countOf(promptOf(r))), [6, 6, 5, 5]);
    for (const r of requests) {
      const p = promptOf(r);
      assert.ok(r.body.max_tokens <= 6000, `max_tokens ${r.body.max_tokens}`);
      assert.ok(countOf(p) * 700 <= r.body.max_tokens, 'an Arabic batch fits its budget');
      assert.match(p, /write "prompt", "options", "correctAnswer" and "explanation" in Modern Standard Arabic/);
      assert.match(p, /VERBATIM excerpt/);
      assert.match(p, /This is part \d of 4 of the exam/);
    }
    // 6 topics over 4 batches: each batch gets its own share, together all of them.
    const perBatch = requests.map((r) => topicsOf(promptOf(r)));
    assert.deepEqual(perBatch.flat().sort(), [...AR_TOPICS].sort());
    // Arabic quotes come back verbatim and pass the grounding check against the Arabic material.
    const { kept, rejected } = validateQuestions(out, { material: new MaterialIndex(AR_EXCERPTS), allowedTopics: AR_TOPICS });
    assert.equal(kept.length, 22, JSON.stringify(rejected));
    assert.ok(kept.every((q) => AR_TOPICS.includes(q.topic)));
  });
});

test('short exams are still a single request, with the same prompt as before', async () => {
  await withModel({ tokensPerItem: 300, item: arQuestion }, async (ai, requests) => {
    const out = await ai.generateQuestions(arExam(5));
    assert.equal(out.length, 5);
    assert.equal(requests.length, 1);
    assert.doesNotMatch(promptOf(requests[0]), /This is part/);
    assert.equal(requests[0].body.max_tokens, replyBudget(5, QUESTION_REPLY_TOKENS));
  });
});

test('a batch still cut off by the response limit is split in two once — the other batches are not re-run', async () => {
  // Very verbose output: 6 × 1,100 = 6,600 tokens > 6,000, but 3 × 1,100 fits.
  await withModel({ tokensPerItem: 1100, item: arQuestion }, async (ai, requests) => {
    const out = await ai.generateQuestions(arExam(12));
    assert.equal(out.length, 12);
    const counts = requests.map((r) => countOf(promptOf(r)));
    assert.deepEqual(counts.slice(0, 2), [6, 6], 'two batches of 6, both cut off');
    assert.deepEqual(counts.slice(2).sort(), [3, 3, 3, 3], 'each split once into 3 + 3');
    assert.equal(requests.length, 6, 'no request was sent twice');
  });
});

test('if a split half is still cut off, the whole exam fails (no partial exam) and no further requests are made', async () => {
  await withModel({ tokensPerItem: 5000, item: arQuestion }, async (ai, requests) => {
    await assert.rejects(ai.generateQuestions(arExam(12)), (err: unknown) => {
      assert.ok(err instanceof AIError);
      assert.equal(err.code, 'bad_output');
      assert.equal(err.truncated, true);
      return true;
    });
    assert.equal(requests.length, 6, '2 batches + 2 splits each, then stop');
  });
});

test('partial failure: one batch fails, the call fails — the successful batches are not returned or retried', async () => {
  const failSecond = (req: FakeRequest) => (/This is part 2 of/.test(promptOf(req)) ? ({ status: 500, errorType: 'api_error' } as FakeReply) : null);
  await withModel({ tokensPerItem: 300, item: arQuestion, override: failSecond }, async (ai, requests) => {
    await assert.rejects(ai.generateQuestions(arExam(22)), (err: unknown) => err instanceof AIError && err.code === 'unavailable');
    assert.equal(requests.length, 4, 'each batch requested once');
  });
});

test('malformed output: only the bad batch is retried once; twice malformed fails the whole call', async () => {
  let bad = 0;
  const once = (req: FakeRequest) => (/This is part 3 of/.test(promptOf(req)) && bad++ === 0 ? { text: 'Sorry, here is the JSON: {"questions": [ oops' } : null);
  await withModel({ tokensPerItem: 300, item: arQuestion, override: once }, async (ai, requests) => {
    const out = await ai.generateQuestions(arExam(22));
    assert.equal(out.length, 22);
    assert.equal(requests.length, 5, '4 batches + 1 retry of the malformed one');
  });
  const always = (req: FakeRequest) => (/This is part 3 of/.test(promptOf(req)) ? { text: '{"questions": "not a list"}' } : null);
  await withModel({ tokensPerItem: 300, item: arQuestion, override: always }, async (ai, requests) => {
    await assert.rejects(ai.generateQuestions(arExam(22)), (err: unknown) => err instanceof AIError && err.code === 'bad_output' && !err.truncated);
    assert.equal(requests.length, 5);
  });
});

test('a top-up request tells the model which questions the exam already has', async () => {
  await withModel({ tokensPerItem: 300, item: arQuestion }, async (ai, requests) => {
    await ai.generateQuestions({ ...arExam(3), avoid: ['السؤال القديم: ما البناء الضوئي؟'] });
    assert.match(promptOf(requests[0]), /already in the exam\. Do not repeat or rephrase them:\n- السؤال القديم: ما البناء الضوئي؟/);
  });
});

test('validation drops a question repeated by two batches', () => {
  const q = { type: 'short_answer' as const, topic: 'النواة', prompt: 'اشرح النواة.', options: null, correctAnswer: AR_FACTS['النواة'], explanation: 'وفق المادة.', sourceQuote: AR_FACTS['النواة'] };
  const material = new MaterialIndex(AR_EXCERPTS);
  const { kept, rejected } = validateQuestions([q, { ...q, prompt: ' اشرح   النواة ' }], { material, allowedTopics: AR_TOPICS });
  assert.equal(kept.length, 1);
  assert.equal(rejected.duplicate, 1);
  const again = validateQuestions([q], { material, allowedTopics: AR_TOPICS, alreadyKept: kept });
  assert.equal(again.kept.length, 0, 'a top-up cannot repeat a question already in the exam');
});

// ---------------------------------------------------------------- flashcards

test('a 20-card Arabic deck (22 requested) fits: 2 batches of 11; the old single budget would have been cut off', async () => {
  const oldBudget = Math.min(8000, 400 + 22 * 220); // before this fix: one reply of 5,240 tokens for 22 cards
  assert.ok(22 * 350 > oldBudget, 'Arabic cards (~350 tokens each) did not fit the old single reply');
  await withModel({ tokensPerItem: 350, item: arCard }, async (ai, requests) => {
    const cards = await ai.generateFlashcards({ excerpts: AR_EXCERPTS, topics: AR_TOPICS, count: 22, language: 'ar' });
    assert.equal(cards.length, 22);
    assert.deepEqual(requests.map((r) => countOf(promptOf(r))), [11, 11]);
    for (const r of requests) {
      assert.equal(r.body.max_tokens, 5550);
      assert.match(promptOf(r), /write "front" and "back" in Modern Standard Arabic/);
      assert.match(promptOf(r), /This is part \d of 2 of the deck/);
    }
    assert.ok(cards.every((c) => Object.values(AR_FACTS).includes(c.sourceQuote)), 'quotes verbatim');
  });
});

test('flashcards: a cut-off batch is split once; a failed batch fails the whole deck', async () => {
  // 11 × 520 = 5,720 > 5,550: both batches are cut off; 6 × 520 and 5 × 520 fit their halves' budgets.
  await withModel({ tokensPerItem: 520, item: arCard }, async (ai, requests) => {
    const cards = await ai.generateFlashcards({ excerpts: AR_EXCERPTS, topics: AR_TOPICS, count: 22, language: 'ar' });
    assert.equal(cards.length, 22);
    assert.deepEqual(requests.map((r) => countOf(promptOf(r))).sort((a, b) => b - a), [11, 11, 6, 6, 5, 5]);
  });
  const failFirst = (req: FakeRequest) => (/This is part 1 of/.test(promptOf(req)) ? ({ status: 529, errorType: 'overloaded_error' } as FakeReply) : null);
  await withModel({ tokensPerItem: 350, item: arCard, override: failFirst }, async (ai, requests) => {
    await assert.rejects(ai.generateFlashcards({ excerpts: AR_EXCERPTS, topics: AR_TOPICS, count: 22, language: 'ar' }), (err: unknown) => err instanceof AIError && err.code === 'rate_limited');
    assert.equal(requests.length, 2);
  });
});

// ---------------------------------------------------------------- exams end to end (HTTP API + database)

const FACTS: Record<string, string> = {
  Photosynthesis: 'Chlorophyll absorbs mostly red and blue light and reflects green light',
  'Calvin cycle': 'The Calvin cycle takes place in the stroma of the chloroplast',
  'Cellular respiration': 'Glycolysis is the first stage of cellular respiration and happens in the cytoplasm',
};
/** Behaviour of the fake model for exam requests in the API tests below. */
let examModel: { tokensPerItem: number; ungroundedPerReply?: (reply: number) => number; failPart?: number } = { tokensPerItem: 300 };
let examReplies = 0;
const examPrompts: string[] = [];

function apiModel(req: FakeRequest): FakeReply {
  const p = promptOf(req);
  if (p.includes('describe what it covers')) return { text: JSON.stringify({ summary: 'Notes on how plants make and use energy.', topics: Object.keys(FACTS) }) };
  if (!isExam(p)) return { status: 400, errorType: 'invalid_request_error' };
  examPrompts.push(p);
  // A batch the provider refuses (not retried by the SDK, unlike 5xx/overloaded).
  if (examModel.failPart && p.includes(`This is part ${examModel.failPart} of`)) return { status: 400, errorType: 'invalid_request_error' };
  const reply = examReplies++;
  const count = countOf(p);
  const topics = topicsOf(p);
  const bad = examModel.ungroundedPerReply?.(reply) ?? 0;
  const questions = Array.from({ length: count }, (_, i) => {
    const topic = topics[i % topics.length];
    const id = ++uid;
    return {
      type: 'short_answer',
      topic,
      prompt: `Question ${id}: explain ${topic}.`,
      options: null,
      correctAnswer: FACTS[topic],
      explanation: 'Per the notes.',
      // The last `bad` questions of this reply cite something that is not in the PDF.
      sourceQuote: i >= count - bad ? 'Mitochondria were discovered on the moon in 1492 by astronauts' : FACTS[topic],
    };
  });
  const text = JSON.stringify({ questions });
  if (count * examModel.tokensPerItem > req.body.max_tokens) return { text: text.slice(0, 100), stopReason: 'max_tokens' };
  return { text };
}

let fake: Awaited<ReturnType<typeof startFakeAnthropic>>;
let app: typeof import('../src/app.js').app;
let sql: typeof import('../src/db/client.js').sql;
let token = '';
let docId = '';

before(async () => {
  fake = await startFakeAnthropic(apiModel);
  process.env.PLAN_LIMITS_OVERRIDE = JSON.stringify({
    free: { courses: null, courseUploadsPerMonth: null, examGenerationsPerMonth: null, practiceQuestionsPerMonth: null, maxQuestionsPerExam: 20 },
  });
  Object.assign(process.env, { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: KEY, AI_MODEL: 'claude-fake', ANTHROPIC_BASE_URL: fake.url });
  ({ app } = await import('../src/app.js'));
  ({ sql } = await import('../src/db/client.js'));
});
after(async () => {
  await sql?.end();
  await fake?.close();
});

async function call<T>(path: string, init: RequestInit = {}) {
  const res = await app.request(path, { ...init, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const post = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
const examCount = async () => Number((await sql`select count(*)::int as n from exams where document_id = ${docId}`)[0].n);

async function course() {
  if (docId) return;
  token = (await call<AuthResponse>('/auth/register', post({ email: `limits-${Date.now()}@example.com`, password: 'password123', name: 'Limits', ageRange: '18_24' }))).body.token;
  const form = new FormData();
  form.append('file', new File([await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url))], 'biology-notes.pdf', { type: 'application/pdf' }));
  docId = (await call<DocumentDetail>('/documents', { method: 'POST', body: form })).body.id;
  for (let i = 0; i < 50; i++) {
    if ((await call<DocumentDetail>(`/documents/${docId}`)).body.status !== 'processing') return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const reset = (m: typeof examModel) => {
  examModel = m;
  examReplies = 0;
  examPrompts.length = 0;
};

test('API: a 20-question exam with long answers is generated in batches and is complete', async () => {
  await course();
  // 700 tokens per question: the old single 22-question reply (15,400 tokens) would not fit 12,000.
  reset({ tokensPerItem: 700 });
  const before = await examCount();
  const exam = await call<Exam>(`/documents/${docId}/exams`, post({ questionCount: 20 }));
  assert.equal(exam.status, 201, JSON.stringify(exam.body));
  assert.equal(exam.body.questions.length, 20);
  assert.equal(new Set(exam.body.questions.map((q) => q.prompt)).size, 20, 'no repeated questions');
  assert.deepEqual(examPrompts.map(countOf), [6, 6, 5, 5]);
  assert.equal(await examCount(), before + 1);
});

test('API: questions dropped by the grounding check are replaced by ONE top-up request', async () => {
  await course();
  reset({ tokensPerItem: 300, ungroundedPerReply: (r) => (r < 2 ? 3 : 0) }); // first two batches each cite 3 invented quotes
  const exam = await call<Exam>(`/documents/${docId}/exams`, post({ questionCount: 10 }));
  assert.equal(exam.status, 201, JSON.stringify(exam.body));
  assert.equal(exam.body.questions.length, 10);
  assert.equal(examPrompts.length, 3, '2 batches (6 + 6) + 1 top-up');
  assert.match(examPrompts[2], /already in the exam\. Do not repeat or rephrase them/);
  assert.equal(countOf(examPrompts[2]), 10 - 6 + 2, 'asks only for the missing questions (+2 spare)');
});

test('API: still short after the top-up → no exam is created and nothing is charged', async () => {
  await course();
  reset({ tokensPerItem: 300, ungroundedPerReply: () => 4 }); // every reply: 4 invented quotes
  const before = await examCount();
  const exam = await call<{ code: string }>(`/documents/${docId}/exams`, post({ questionCount: 10 }));
  assert.equal(exam.status, 502);
  assert.equal(exam.body.code, 'ai_bad_output');
  assert.deepEqual(examPrompts.map(countOf), [6, 6, 4, 4], 'one top-up round (8 questions → 2 batches), never more');
  assert.equal(await examCount(), before, 'no incomplete exam saved');
});

test('API: one failed batch → no exam is created (the student can simply try again)', async () => {
  await course();
  reset({ tokensPerItem: 300, failPart: 2 });
  const before = await examCount();
  const exam = await call<{ code: string }>(`/documents/${docId}/exams`, post({ questionCount: 20 }));
  assert.equal(exam.status, 502);
  assert.equal(exam.body.code, 'ai_bad_request');
  assert.equal(examPrompts.length, 4, 'every batch requested once; no top-up after a failure');
  assert.equal(await examCount(), before);
  // Nothing was charged: a new exam can be generated straight away.
  reset({ tokensPerItem: 300 });
  assert.equal((await call<Exam>(`/documents/${docId}/exams`, post({ questionCount: 20 }))).status, 201);
});
