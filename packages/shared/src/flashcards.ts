/**
 * Flashcards: question → answer cards generated from a course's own material (every card is backed by
 * a verbatim quote, like exam questions). A deck is reviewed in rounds: each card is marked "knew it"
 * or "needs practice"; a new round can replay every card or only the ones that need practice.
 * Progress is stored per card on the server, so a refresh or another device resumes where it stopped.
 *
 * Usage: each generated card counts as one practice question of the plan's monthly allowance.
 */
import { z } from 'zod';
import { aiLanguageSchema } from './languages';

export const FLASHCARD_DECK_SIZES = [5, 10, 20] as const;
export type FlashcardDeckSize = (typeof FLASHCARD_DECK_SIZES)[number];
export const DEFAULT_FLASHCARD_DECK_SIZE: FlashcardDeckSize = 10;

export const createFlashcardDeckSchema = z.object({
  cardCount: z
    .number()
    .int()
    .refine((n) => (FLASHCARD_DECK_SIZES as readonly number[]).includes(n), 'Choose 5, 10 or 20 cards')
    .default(DEFAULT_FLASHCARD_DECK_SIZE),
  /** Language for the cards. Defaults to the course summary's language. */
  language: aiLanguageSchema.optional(),
});
export type CreateFlashcardDeckInput = z.input<typeof createFlashcardDeckSchema>;

export const FLASHCARD_RESULTS = ['known', 'practice'] as const;
export type FlashcardResult = (typeof FLASHCARD_RESULTS)[number];

export const reviewFlashcardSchema = z.object({
  cardId: z.uuid(),
  result: z.enum(FLASHCARD_RESULTS),
  /** The round the student is answering in; an answer for an older round is refused (409). */
  round: z.number().int().min(1),
});
export type ReviewFlashcardInput = z.input<typeof reviewFlashcardSchema>;

/** all = every card again; practice = only the cards marked "needs practice" last time. */
export const newFlashcardRoundSchema = z.object({ scope: z.enum(['all', 'practice']) });
export type NewFlashcardRoundInput = z.input<typeof newFlashcardRoundSchema>;

export type Flashcard = {
  id: string;
  position: number;
  topic: string;
  /** Question side. */
  front: string;
  /** Answer side. */
  back: string;
  /** Verbatim excerpt from the course material that supports the answer. */
  sourceQuote: string;
  /** Part of the current round. */
  inRound: boolean;
  /** Answer given in the current round (null = not reviewed yet in this round). */
  roundResult: FlashcardResult | null;
  /** Most recent answer in any round. */
  lastResult: FlashcardResult | null;
};

export type FlashcardProgress = {
  /** Cards in the current round, how many are answered, and how. */
  total: number;
  reviewed: number;
  known: number;
  practice: number;
  completed: boolean;
};

export type FlashcardDeckSummary = {
  id: string;
  documentId: string;
  cardCount: number;
  language: string;
  round: number;
  progress: FlashcardProgress;
  createdAt: string;
  updatedAt: string;
};

export type FlashcardDeck = FlashcardDeckSummary & { cards: Flashcard[] };
