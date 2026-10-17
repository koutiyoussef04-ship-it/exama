/**
 * Flashcards from a course's own material.
 *
 * Generation reuses the exam pipeline: the course's stored chunks (nothing is re-processed), the same
 * StudyAI layer, and the same grounding check — a card is kept only if its supporting quote really
 * occurs in the material sent to the model. Usage: each delivered card counts as one practice question
 * (reserved before the AI call, trimmed to what the plan has left, refunded if nothing is delivered).
 *
 * Abuse/cost safeguards: one generation per student at a time (409 flashcards_in_progress), a per-student
 * burst limit, at most 20 cards and the same excerpt budget as an exam.
 *
 * Review: a deck is played in rounds. Each card stores its answer for the current round and its most
 * recent answer overall, so progress survives refreshes, sign-outs and other devices.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CreateFlashcardDeckInput, Flashcard, FlashcardDeck, FlashcardDeckSummary, FlashcardProgress, FlashcardResult } from '@study/shared';
import { AIError, studyAI } from '../ai/index.js';
import type { GeneratedFlashcard } from '../ai/types.js';
import { resolveOutputLanguage } from '../ai/language.js';
import { track } from '../analytics/index.js';
import { releaseReservation, reserveFlashcards, settleReservation } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { documentChunks, flashcardDecks, flashcards } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { MaterialIndex, normalizeText } from '../lib/grounding.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { usableChunks } from './chunks.js';
import { getOwnedDocument } from './documents.js';

/** Same source-text budget as an exam. */
const EXCERPT_BUDGET_CHARS = 40_000;
const MAX_FRONT = 220;
const MAX_BACK = 450;

/** Per student: deck generations (bursts only — the plan allowance is the real limit). */
export const flashcardGenerationLimiter = new RateLimiter(8, 10 * 60_000, 'You’ve made several decks in a short time. Please wait a little and try again.');
const inFlight = new Set<string>();
export function resetFlashcardLimits() {
  flashcardGenerationLimiter.reset();
  inFlight.clear();
}

type DeckRow = typeof flashcardDecks.$inferSelect;
type CardRow = typeof flashcards.$inferSelect;

function progressOf(cards: CardRow[]): FlashcardProgress {
  const inRound = cards.filter((c) => c.inRound);
  const known = inRound.filter((c) => c.roundResult === 'known').length;
  const practice = inRound.filter((c) => c.roundResult === 'practice').length;
  return { total: inRound.length, reviewed: known + practice, known, practice, completed: inRound.length > 0 && known + practice === inRound.length };
}

const toCard = (c: CardRow): Flashcard => ({
  id: c.id,
  position: c.position,
  topic: c.topic,
  front: c.front,
  back: c.back,
  sourceQuote: c.sourceQuote,
  inRound: c.inRound,
  roundResult: c.roundResult ?? null,
  lastResult: c.lastResult ?? null,
});

const toSummary = (d: DeckRow, cards: CardRow[]): FlashcardDeckSummary => ({
  id: d.id,
  documentId: d.documentId,
  cardCount: cards.length,
  language: d.language,
  round: d.round,
  progress: progressOf(cards),
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

const toDeck = (d: DeckRow, cards: CardRow[]): FlashcardDeck => ({
  ...toSummary(d, cards),
  cards: [...cards].sort((a, b) => a.position - b.position).map(toCard),
});

/** An even spread over the whole course (cards should cover all of it, not just the first pages). */
async function selectExcerpts(documentId: string): Promise<string[]> {
  const chunks = await db.select({ content: documentChunks.content }).from(documentChunks).where(usableChunks(documentId)).orderBy(asc(documentChunks.position));
  const step = Math.max(1, Math.floor(chunks.length / 14));
  const picked: string[] = [];
  let used = 0;
  for (const c of [...chunks.filter((_, i) => i % step === 0), ...chunks]) {
    if (picked.includes(c.content)) continue;
    if (used + c.content.length > EXCERPT_BUDGET_CHARS && picked.length > 0) break;
    picked.push(c.content);
    used += c.content.length;
  }
  return picked;
}

/** Keeps well-formed, grounded, non-duplicate cards; snaps topics to the course's names. */
export function validateFlashcards(cards: GeneratedFlashcard[], opts: { material: MaterialIndex; topics: string[] }) {
  const byLower = new Map(opts.topics.map((t) => [t.toLowerCase().trim(), t]));
  const seen = new Set<string>();
  const rejected = { ungrounded: 0, malformed: 0, duplicate: 0 };
  const kept: GeneratedFlashcard[] = [];
  for (const c of cards) {
    const front = typeof c.front === 'string' ? c.front.trim() : '';
    const back = typeof c.back === 'string' ? c.back.trim() : '';
    if (!front || !back || front.length > MAX_FRONT || back.length > MAX_BACK || normalizeText(front) === normalizeText(back)) {
      rejected.malformed++;
      continue;
    }
    const key = normalizeText(front);
    if (seen.has(key)) {
      rejected.duplicate++;
      continue;
    }
    if (typeof c.sourceQuote !== 'string' || !opts.material.contains(c.sourceQuote)) {
      rejected.ungrounded++;
      continue;
    }
    seen.add(key);
    const topic = byLower.get(String(c.topic ?? '').toLowerCase().trim()) ?? opts.topics[0] ?? 'General';
    kept.push({ topic, front, back, sourceQuote: c.sourceQuote.trim() });
  }
  return { kept, rejected };
}

export async function createFlashcardDeck(userId: string, documentId: string, input: Required<Pick<CreateFlashcardDeckInput, 'cardCount'>> & Pick<CreateFlashcardDeckInput, 'language'>): Promise<FlashcardDeck> {
  const doc = await getOwnedDocument(userId, documentId);
  if (doc.status !== 'ready') throw new HttpError(409, 'Document is still processing', 'document_processing');
  if (inFlight.has(userId)) throw new HttpError(409, 'Your flashcards are already being made.', 'flashcards_in_progress');
  flashcardGenerationLimiter.take(userId);
  inFlight.add(userId);
  const language = resolveOutputLanguage(input.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en');
  const startedAt = Date.now();
  const base = { document_id: documentId, requested_count: input.cardCount, language };
  try {
    const excerpts = await selectExcerpts(documentId);
    if (excerpts.join('').trim().length < 200) throw new HttpError(422, 'There isn’t enough readable text in this course to make flashcards.', 'flashcards_not_enough_material');

    // Plan check + reservation before any AI cost; the deck may be trimmed to what is left.
    const reservation = await reserveFlashcards(userId, input.cardCount);
    let deck: FlashcardDeck;
    try {
      const topics = doc.topics.length ? doc.topics : ['General'];
      // Ask for a couple extra: some may be discarded by the checks below.
      const raw = await studyAI.generateFlashcards({ excerpts, topics, count: reservation.questionCount + 2, language });
      const { kept, rejected } = validateFlashcards(raw, { material: new MaterialIndex(excerpts), topics });
      if (raw.length !== kept.length) console.warn(`[flashcards] dropped ${raw.length - kept.length}/${raw.length} generated cards`, rejected);
      if (kept.length === 0) throw new AIError('bad_output', `No valid grounded flashcards (rejected: ${JSON.stringify(rejected)})`);
      const generated = kept.slice(0, reservation.questionCount);
      deck = await db.transaction(async (tx) => {
        const [d] = await tx.insert(flashcardDecks).values({ userId, documentId, language }).returning();
        const rows = await tx
          .insert(flashcards)
          .values(generated.map((c, i) => ({ deckId: d.id, position: i, ...c })))
          .returning();
        return toDeck(d, rows);
      });
      await settleReservation(reservation, deck.cards.length); // only delivered cards count
    } catch (err) {
      await releaseReservation(reservation); // nothing delivered, nothing charged
      throw err;
    }
    void track('flashcards_generated', userId, { ...base, success: true, duration_ms: Date.now() - startedAt, card_count: deck.cards.length });
    return deck;
  } catch (err) {
    if (!(err instanceof HttpError && err.status < 500 && err.code !== 'flashcards_not_enough_material')) {
      void track('flashcards_generated', userId, {
        ...base,
        success: false,
        duration_ms: Date.now() - startedAt,
        failure_reason: err instanceof AIError ? `ai_${err.code}` : err instanceof HttpError ? (err.code ?? 'http') : 'other',
      });
    }
    throw err;
  } finally {
    inFlight.delete(userId);
  }
}

export async function listFlashcardDecks(userId: string, documentId: string): Promise<FlashcardDeckSummary[]> {
  await getOwnedDocument(userId, documentId);
  const decks = await db
    .select()
    .from(flashcardDecks)
    .where(and(eq(flashcardDecks.userId, userId), eq(flashcardDecks.documentId, documentId)))
    .orderBy(desc(flashcardDecks.createdAt));
  if (!decks.length) return [];
  const cards = await db.select().from(flashcards).where(inArray(flashcards.deckId, decks.map((d) => d.id)));
  return decks.map((d) => toSummary(d, cards.filter((c) => c.deckId === d.id)));
}

/** 404 for decks that don't exist or belong to someone else (never reveals which). */
async function ownedDeck(userId: string, deckId: string): Promise<DeckRow> {
  const [d] = await db.select().from(flashcardDecks).where(and(eq(flashcardDecks.id, deckId), eq(flashcardDecks.userId, userId)));
  if (!d) throw new HttpError(404, 'Deck not found', 'not_found');
  return d;
}
const cardsOf = (deckId: string) => db.select().from(flashcards).where(eq(flashcards.deckId, deckId)).orderBy(asc(flashcards.position));

export async function getFlashcardDeck(userId: string, deckId: string): Promise<FlashcardDeck> {
  const d = await ownedDeck(userId, deckId);
  return toDeck(d, await cardsOf(d.id));
}

/**
 * Records "knew it" / "needs practice" for a card in the current round. Answering the same card again
 * in the same round replaces the answer (counters are adjusted, never double-counted).
 */
export async function reviewFlashcard(userId: string, deckId: string, input: { cardId: string; result: FlashcardResult; round: number }): Promise<FlashcardDeck> {
  const d = await ownedDeck(userId, deckId);
  if (input.round !== d.round) throw new HttpError(409, 'This deck moved on to another round. Reload it to continue.', 'flashcards_round_changed', { round: d.round });
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, input.cardId), eq(flashcards.deckId, d.id)))
      .for('update');
    if (!card || !card.inRound) return null;
    const known = (card.roundResult === 'known' ? -1 : 0) + (input.result === 'known' ? 1 : 0);
    const practice = (card.roundResult === 'practice' ? -1 : 0) + (input.result === 'practice' ? 1 : 0);
    await tx
      .update(flashcards)
      .set({
        roundResult: input.result,
        lastResult: input.result,
        knownCount: sql`${flashcards.knownCount} + ${known}`,
        practiceCount: sql`${flashcards.practiceCount} + ${practice}`,
        reviewedAt: now,
      })
      .where(eq(flashcards.id, card.id));
    await tx.update(flashcardDecks).set({ updatedAt: now }).where(eq(flashcardDecks.id, d.id));
    return card;
  });
  if (!updated) throw new HttpError(404, 'Card not found in this round', 'not_found');
  const deck = toDeck({ ...d, updatedAt: now }, await cardsOf(d.id));
  // First time the round is finished: one analytics event (counts only).
  if (deck.progress.completed && updated.roundResult === null) {
    void track('flashcards_round_completed', userId, {
      document_id: d.documentId,
      deck_id: d.id,
      round: d.round,
      card_count: deck.progress.total,
      known_count: deck.progress.known,
      practice_count: deck.progress.practice,
    });
  }
  return deck;
}

/** Starts the next round with every card, or only those that needed practice. Free (no AI). */
export async function startFlashcardRound(userId: string, deckId: string, scope: 'all' | 'practice'): Promise<FlashcardDeck> {
  const d = await ownedDeck(userId, deckId);
  const cards = await cardsOf(d.id);
  const chosen = scope === 'all' ? cards : cards.filter((c) => c.lastResult === 'practice');
  if (chosen.length === 0) throw new HttpError(409, 'No cards need more practice.', 'flashcards_none_to_practice');
  const ids = new Set(chosen.map((c) => c.id));
  const now = new Date();
  const [next] = await db.transaction(async (tx) => {
    await tx.update(flashcards).set({ inRound: false, roundResult: null }).where(eq(flashcards.deckId, d.id));
    await tx.update(flashcards).set({ inRound: true }).where(inArray(flashcards.id, [...ids]));
    return tx
      .update(flashcardDecks)
      .set({ round: sql`${flashcardDecks.round} + 1`, updatedAt: now })
      .where(eq(flashcardDecks.id, d.id))
      .returning();
  });
  return toDeck(next, await cardsOf(d.id));
}

export async function deleteFlashcardDeck(userId: string, deckId: string): Promise<void> {
  const d = await ownedDeck(userId, deckId);
  await db.delete(flashcardDecks).where(eq(flashcardDecks.id, d.id));
}
