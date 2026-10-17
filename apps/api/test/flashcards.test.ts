/**
 * Flashcards API: grounded generation from the stored course material, validation of AI output
 * (empty / malformed / ungrounded / failing), review rounds and persisted progress, isolation between
 * students, usage limits (shared practice allowance, refunded when nothing is delivered), duplicate
 * and burst protection. Runs with the real Free plan limits (no override).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse, DocumentDetail, Entitlement, FlashcardDeck, FlashcardDeckSummary } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true' });
delete process.env.PLAN_LIMITS_OVERRIDE;
delete process.env.PLAN_FEATURES_OVERRIDE;
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { studyAI, AIError } = await import('../src/ai/index.js');
const analytics = await import('../src/analytics/index.js');
const { resetFlashcardLimits } = await import('../src/services/flashcards.js');
const { normalizeText } = await import('../src/lib/grounding.js');
after(() => sql.end());

const original = studyAI.generateFlashcards.bind(studyAI);
beforeEach(() => {
  resetFlashcardLimits();
  studyAI.generateFlashcards = original;
});

const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
let n = 0;
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.7.${++n % 250}.2`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string; feature?: string } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

async function student(tag: string) {
  const email = `fc-${tag}-${RUN}-${++n}@example.com`;
  const r = await call<AuthResponse>('/auth/register', json('POST', { email, password: PASSWORD, name: 'Flo', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  return { email, token: r.body.token, id: r.body.user.id };
}
async function course(token: string) {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  assert.equal(up.status, 201);
  for (let i = 0; i < 100; i++) {
    const d = await call<DocumentDetail>(`/documents/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('course not ready');
}
const generate = (token: string, docId: string, body: object = {}) => call<FlashcardDeck>(`/documents/${docId}/flashcards`, { ...json('POST', body), token });
const review = (token: string, deck: FlashcardDeck, cardId: string, result: string, round = deck.round) =>
  call<FlashcardDeck>(`/flashcards/${deck.id}/review`, { ...json('POST', { cardId, result, round }), token });
const usage = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body.usage.practiceQuestionsThisMonth;
const chunkText = async (docId: string) => normalizeText(((await sql`select content from document_chunks where document_id = ${docId}`) as unknown as { content: string }[]).map((r) => r.content).join(' '));

test('a deck is generated from the course material: grounded cards, charged per card, no card text in analytics', async () => {
  const s = await student('gen');
  const doc = await course(s.token);
  const before = await usage(s.token);
  const r = await generate(s.token, doc.id);
  assert.equal(r.status, 201);
  const deck = r.body;
  assert.ok(deck.cards.length >= 3 && deck.cards.length <= 10, `${deck.cards.length} cards`);
  assert.equal(deck.cardCount, deck.cards.length);
  assert.equal(deck.round, 1);
  assert.deepEqual(deck.progress, { total: deck.cards.length, reviewed: 0, known: 0, practice: 0, completed: false });
  const material = await chunkText(doc.id);
  for (const [i, c] of deck.cards.entries()) {
    assert.equal(c.position, i);
    assert.ok(c.front && c.back && c.front !== c.back);
    assert.ok(material.includes(normalizeText(c.sourceQuote)), 'every card is backed by the material');
    assert.ok(doc.topics.includes(c.topic) || c.topic === 'General', c.topic);
    assert.deepEqual([c.inRound, c.roundResult, c.lastResult], [true, null, null]);
  }
  assert.equal((await usage(s.token)) - before, deck.cards.length, 'one practice question per delivered card');

  await analytics.flushAnalytics();
  const [ev] = (await sql`select properties from analytics_events where user_id = ${s.id} and name = 'flashcards_generated'`) as unknown as { properties: Record<string, unknown> }[];
  assert.equal(ev.properties.success, true);
  assert.equal(ev.properties.card_count, deck.cards.length);
  assert.ok(!JSON.stringify(ev.properties).includes(deck.cards[0].front), 'never the card text');

  const list = await call<FlashcardDeckSummary[]>(`/documents/${doc.id}/flashcards`, { token: s.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((d) => d.id), [deck.id]);
  assert.equal((list.body[0] as unknown as { cards?: unknown }).cards, undefined, 'summaries only');
});

test('card count is validated (5, 10 or 20) and the course must be yours and ready', async () => {
  const s = await student('validate');
  const doc = await course(s.token);
  for (const cardCount of [0, 3, 7, 21, 100, 'ten']) assert.equal((await generate(s.token, doc.id, { cardCount })).status, 400, String(cardCount));
  const five = await generate(s.token, doc.id, { cardCount: 5 });
  assert.equal(five.status, 201);
  assert.ok(five.body.cards.length <= 5);
  const other = await student('validate-other');
  assert.equal((await generate(other.token, doc.id)).status, 404, 'someone else’s course');
  assert.equal((await generate(s.token, '00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await call(`/documents/${doc.id}/flashcards`, json('POST', {}))).status, 401);
  await sql`update documents set status = 'processing' where id = ${doc.id}`;
  assert.equal((await generate(s.token, doc.id)).body.code, 'document_processing');
});

test('reviewing: knew it / needs practice, answers can change without double counting, progress survives a new sign-in', async () => {
  const s = await student('review');
  const doc = await course(s.token);
  const deck = (await generate(s.token, doc.id, { cardCount: 5 })).body;
  const [a, b] = deck.cards;
  let d = (await review(s.token, deck, a.id, 'known')).body;
  assert.deepEqual([d.progress.reviewed, d.progress.known, d.progress.practice], [1, 1, 0]);
  d = (await review(s.token, deck, b.id, 'practice')).body;
  d = (await review(s.token, deck, b.id, 'known')).body; // changed their mind
  assert.deepEqual([d.progress.reviewed, d.progress.known, d.progress.practice], [2, 2, 0]);
  const counts = (await sql`select known_count, practice_count from flashcards where id = ${b.id}`) as unknown as { known_count: number; practice_count: number }[];
  assert.deepEqual(counts[0], { known_count: 1, practice_count: 0 }, 'no double counting');

  for (const result of ['maybe', '', null]) assert.equal((await review(s.token, deck, a.id, result as string)).status, 400);
  assert.equal((await review(s.token, deck, a.id, 'known', 7)).body.code, 'flashcards_round_changed');
  assert.equal((await review(s.token, deck, '00000000-0000-4000-8000-000000000000', 'known')).status, 404);

  // A new session (another device, or after signing out) sees the same progress.
  const login = await call<AuthResponse>('/auth/login', json('POST', { email: s.email, password: PASSWORD }));
  const again = (await call<FlashcardDeck>(`/flashcards/${deck.id}`, { token: login.body.token })).body;
  assert.deepEqual(again.progress, d.progress);
  assert.equal(again.cards.find((c) => c.id === a.id)?.roundResult, 'known');
});

test('rounds: finishing a round, replaying only the difficult cards, then everything', async () => {
  const s = await student('rounds');
  const doc = await course(s.token);
  const deck = (await generate(s.token, doc.id, { cardCount: 5 })).body;
  assert.ok(deck.cards.length >= 3);
  let d = deck;
  for (const [i, c] of deck.cards.entries()) d = (await review(s.token, deck, c.id, i < 2 ? 'practice' : 'known')).body;
  assert.equal(d.progress.completed, true);
  assert.deepEqual([d.progress.known, d.progress.practice], [deck.cards.length - 2, 2]);
  // Re-answering a card of a finished round doesn't record a second completion.
  await review(s.token, deck, deck.cards[4 % deck.cards.length].id, 'known');

  const hard = await call<FlashcardDeck>(`/flashcards/${deck.id}/rounds`, { ...json('POST', { scope: 'practice' }), token: s.token });
  assert.equal(hard.status, 200);
  assert.equal(hard.body.round, 2);
  assert.deepEqual(hard.body.cards.filter((c) => c.inRound).map((c) => c.id), deck.cards.slice(0, 2).map((c) => c.id));
  assert.deepEqual(hard.body.progress, { total: 2, reviewed: 0, known: 0, practice: 0, completed: false });
  assert.equal((await review(s.token, deck, deck.cards[0].id, 'known')).body.code, 'flashcards_round_changed', 'answers for the old round are refused');
  const out = await review(s.token, hard.body, deck.cards[3].id, 'known');
  assert.equal(out.status, 404, 'a card outside the round');
  for (const c of hard.body.cards.filter((x) => x.inRound)) d = (await review(s.token, hard.body, c.id, 'known')).body;
  assert.equal(d.progress.completed, true);
  assert.equal((await call(`/flashcards/${deck.id}/rounds`, { ...json('POST', { scope: 'practice' }), token: s.token })).body.code, 'flashcards_none_to_practice');
  const all = await call<FlashcardDeck>(`/flashcards/${deck.id}/rounds`, { ...json('POST', { scope: 'all' }), token: s.token });
  assert.equal(all.body.round, 3);
  assert.equal(all.body.progress.total, deck.cards.length);
  assert.equal((await call(`/flashcards/${deck.id}/rounds`, { ...json('POST', { scope: 'some' }), token: s.token })).status, 400);

  await analytics.flushAnalytics();
  const done = (await sql`select properties from analytics_events where user_id = ${s.id} and name = 'flashcards_round_completed' order by created_at`) as unknown as { properties: Record<string, number> }[];
  assert.deepEqual(done.map((e) => e.properties.round), [1, 2], 'one event per finished round');
});

test('students cannot see or change each other’s decks', async () => {
  const owner = await student('owner');
  const doc = await course(owner.token);
  const deck = (await generate(owner.token, doc.id, { cardCount: 5 })).body;
  const intruder = await student('intruder');
  assert.equal((await call(`/flashcards/${deck.id}`, { token: intruder.token })).status, 404);
  assert.equal((await review(intruder.token, deck, deck.cards[0].id, 'known')).status, 404);
  assert.equal((await call(`/flashcards/${deck.id}/rounds`, { ...json('POST', { scope: 'all' }), token: intruder.token })).status, 404);
  assert.equal((await call(`/flashcards/${deck.id}`, { method: 'DELETE', token: intruder.token })).status, 404);
  assert.equal((await call(`/documents/${doc.id}/flashcards`, { token: intruder.token })).status, 404);
  assert.equal((await call(`/flashcards/${deck.id}`)).status, 401);
  assert.equal((await call('/flashcards/not-a-uuid', { token: owner.token })).status, 404);
  assert.equal((await call<FlashcardDeck>(`/flashcards/${deck.id}`, { token: owner.token })).body.progress.reviewed, 0, 'untouched');
});

test('usage: the Free plan’s practice allowance is shared, decks are trimmed to what is left, then the paywall answer', async () => {
  const s = await student('limits');
  const doc = await course(s.token);
  const first = await generate(s.token, doc.id, { cardCount: 10 });
  assert.equal(first.status, 201);
  const used = await usage(s.token);
  assert.ok(used <= 12);
  if (used < 12) {
    const second = await generate(s.token, doc.id, { cardCount: 10 });
    assert.equal(second.status, 201);
    assert.ok(second.body.cards.length <= 12 - used, 'trimmed to the remaining allowance');
  }
  // Exhaust whatever is left, then the limit answer (opens the paywall in the app).
  await sql`insert into usage_ledger (user_id, kind, amount) values (${s.id}, 'practice_questions', 12)`;
  const blocked = await generate(s.token, doc.id);
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.code, 'limit_reached');
  assert.equal(blocked.body.feature, 'practice_questions');
  // Reviewing existing decks never costs anything.
  assert.equal((await review(s.token, first.body, first.body.cards[0].id, 'known')).status, 200);
});

test('AI problems: empty, malformed, ungrounded or failed output gives a clear error and refunds the allowance', async () => {
  const s = await student('ai');
  const doc = await course(s.token);
  const before = await usage(s.token);
  const cases: [string, () => Promise<unknown>, number][] = [
    ['empty', async () => [], 502],
    ['malformed', async () => [{ topic: 'x', front: '', back: '', sourceQuote: '' }, { front: 'only a front' }], 502],
    ['ungrounded', async () => [{ topic: doc.topics[0], front: 'What is the capital of Mars?', back: 'Olympus City.', sourceQuote: 'This sentence does not appear anywhere in the uploaded course material at all.' }], 502],
    ['duplicates', async () => Array.from({ length: 3 }, () => ({ topic: doc.topics[0], front: 'Same?', back: 'Same.', sourceQuote: 'Nothing like this is in the material, it is invented text for the test.' })), 502],
    ['provider down', async () => { throw new AIError('unavailable', 'down'); }, 503],
  ];
  for (const [name, fake, status] of cases) {
    studyAI.generateFlashcards = fake as typeof studyAI.generateFlashcards;
    const r = await generate(s.token, doc.id, { cardCount: 5 });
    assert.equal(r.status, status, name);
    assert.match(r.body.code ?? '', /^ai_/, name);
  }
  assert.equal(await usage(s.token), before, 'nothing delivered, nothing charged');
  assert.equal((await call<FlashcardDeckSummary[]>(`/documents/${doc.id}/flashcards`, { token: s.token })).body.length, 0, 'no empty decks left behind');

  // Partially good output keeps only the grounded cards and charges only those.
  studyAI.generateFlashcards = async (input) => {
    const good = await original(input);
    return [...good.slice(0, 2), { topic: doc.topics[0], front: 'Invented?', back: 'Invented.', sourceQuote: 'A completely made up sentence that the course never contains anywhere.' }];
  };
  const partial = await generate(s.token, doc.id, { cardCount: 5 });
  assert.equal(partial.status, 201);
  assert.equal(partial.body.cards.length, 2);
  assert.equal((await usage(s.token)) - before, 2);
});

test('not enough readable material: a clear error and no charge', async () => {
  const s = await student('thin');
  const doc = await course(s.token);
  await sql`update document_chunks set content = 'Too short.' where document_id = ${doc.id}`;
  const before = await usage(s.token);
  const r = await generate(s.token, doc.id);
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'flashcards_not_enough_material');
  assert.equal(await usage(s.token), before);
});

test('duplicate taps and bursts: one generation at a time per student, and a burst limit', async () => {
  const s = await student('dup');
  const doc = await course(s.token);
  studyAI.generateFlashcards = async (input) => {
    await new Promise((r) => setTimeout(r, 300));
    return original(input);
  };
  const [x, y] = await Promise.all([generate(s.token, doc.id, { cardCount: 5 }), generate(s.token, doc.id, { cardCount: 5 })]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  assert.equal([x, y].find((r) => r.status === 409)!.body.code, 'flashcards_in_progress');
  assert.equal((await call<FlashcardDeckSummary[]>(`/documents/${doc.id}/flashcards`, { token: s.token })).body.length, 1, 'only one deck');

  studyAI.generateFlashcards = async () => [];
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push((await generate(s.token, doc.id, { cardCount: 5 })).status);
  assert.equal(statuses.at(-1), 429, `burst limit: ${statuses.join(',')}`);
});

test('deleting a deck, a course or the account removes the decks and cards', async () => {
  const s = await student('cleanup');
  const doc = await course(s.token);
  const d1 = (await generate(s.token, doc.id, { cardCount: 5 })).body;
  const d2 = (await generate(s.token, doc.id, { cardCount: 5 })).body;
  assert.equal((await call(`/flashcards/${d1.id}`, { method: 'DELETE', token: s.token })).status, 204);
  assert.equal((await call(`/flashcards/${d1.id}`, { token: s.token })).status, 404);
  assert.equal((await call(`/documents/${doc.id}`, { method: 'DELETE', token: s.token })).status, 204);
  const left = (await sql`select (select count(*) from flashcard_decks where id = ${d2.id})::int as decks, (select count(*) from flashcards where deck_id = ${d2.id})::int as cards`) as unknown as { decks: number; cards: number }[];
  assert.deepEqual(left[0], { decks: 0, cards: 0 });
});
