/**
 * Flashcards, client side — pure (no React Native) so it is unit tested: which card is next, local
 * (optimistic) answers, the course-tile status, and the web keyboard shortcuts. The server stores
 * every answer and decides the rounds; this only mirrors it.
 */
import type { Flashcard, FlashcardDeck, FlashcardDeckSummary, FlashcardProgress, FlashcardResult } from '@study/shared';

/** Cards of the current round, in deck order. */
export const roundCards = (deck: Pick<FlashcardDeck, 'cards'>): Flashcard[] => deck.cards.filter((c) => c.inRound).sort((a, b) => a.position - b.position);

/** The card to show: the first one of the round not answered yet (null when the round is done). */
export function nextCard(deck: Pick<FlashcardDeck, 'cards'>): Flashcard | null {
  return roundCards(deck).find((c) => c.roundResult === null) ?? null;
}

/** 1-based position of `card` within the round ("Card 3 of 10"). */
export const cardNumber = (deck: Pick<FlashcardDeck, 'cards'>, card: Flashcard) => roundCards(deck).findIndex((c) => c.id === card.id) + 1;

export function progressOf(cards: Flashcard[]): FlashcardProgress {
  const round = cards.filter((c) => c.inRound);
  const known = round.filter((c) => c.roundResult === 'known').length;
  const practice = round.filter((c) => c.roundResult === 'practice').length;
  return { total: round.length, reviewed: known + practice, known, practice, completed: round.length > 0 && known + practice === round.length };
}

/** The deck as it will be once the server has stored this answer (shown immediately). */
export function applyReview(deck: FlashcardDeck, cardId: string, result: FlashcardResult): FlashcardDeck {
  const cards = deck.cards.map((c) => (c.id === cardId && c.inRound ? { ...c, roundResult: result, lastResult: result } : c));
  return { ...deck, cards, progress: progressOf(cards) };
}

/** Cards answered "needs practice" in the last answer (what "Review the difficult cards" replays). */
export const practiceCount = (deck: Pick<FlashcardDeck, 'cards'>) => deck.cards.filter((c) => c.lastResult === 'practice').length;

export type DeckTileStatus = { kind: 'new' } | { kind: 'resume'; reviewed: number; total: number } | { kind: 'done'; practice: number; total: number };

/** What the Flashcards tile on the course screen says about the latest deck. */
export function deckTileStatus(latest: FlashcardDeckSummary | undefined): DeckTileStatus {
  if (!latest) return { kind: 'new' };
  const p = latest.progress;
  return p.completed ? { kind: 'done', practice: p.practice, total: p.total } : { kind: 'resume', reviewed: p.reviewed, total: p.total };
}

export type KeyAction = 'flip' | 'known' | 'practice';

/**
 * Web keyboard: Space/Enter reveal the answer; then → or K = "I knew it", ← or P = "Needs practice".
 * In right-to-left layouts the arrows follow the screen (→ is "back"), so the letters always work.
 * Keys typed into a form field, or with a modifier, are ignored.
 */
export function keyAction(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; targetTag?: string | null }, revealed: boolean, rtl = false): KeyAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.targetTag && /^(input|textarea|select)$/i.test(e.targetTag)) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (!revealed) return key === ' ' || key === 'Enter' ? 'flip' : null;
  if (key === 'k' || key === (rtl ? 'ArrowLeft' : 'ArrowRight')) return 'known';
  if (key === 'p' || key === (rtl ? 'ArrowRight' : 'ArrowLeft')) return 'practice';
  return null;
}
