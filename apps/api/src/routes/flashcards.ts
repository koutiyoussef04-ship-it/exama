import { Hono } from 'hono';
import { createFlashcardDeckSchema, newFlashcardRoundSchema, reviewFlashcardSchema, type FlashcardDeck, type FlashcardDeckSummary } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { parseBody } from '../lib/errors.js';
import { createFlashcardDeck, deleteFlashcardDeck, getFlashcardDeck, listFlashcardDecks, reviewFlashcard, startFlashcardRound } from '../services/flashcards.js';

/** Mounted at /documents: a course's decks, and generating a new one (AI; uses the practice allowance). */
export const flashcardDocumentRoutes = new Hono<AuthEnv>()
  .use('/:id/flashcards', requireAuth)
  .get('/:id/flashcards', async (c) => c.json<FlashcardDeckSummary[]>(await listFlashcardDecks(c.var.userId, c.req.param('id'))))
  // Body: { cardCount?: 5 | 10 | 20, language? } → 201 deck. 402 limit, 409 in progress, 422 not enough material.
  .post('/:id/flashcards', async (c) => {
    const input = parseBody(createFlashcardDeckSchema, await c.req.json().catch(() => ({})));
    return c.json<FlashcardDeck>(await createFlashcardDeck(c.var.userId, c.req.param('id'), input), 201);
  });

/** Mounted at /flashcards: one deck (owner only), its reviews and rounds. No AI, no usage. */
export const flashcardRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .get('/:deckId', async (c) => c.json<FlashcardDeck>(await getFlashcardDeck(c.var.userId, c.req.param('deckId'))))
  // Body: { cardId, result: 'known' | 'practice', round }
  .post('/:deckId/review', async (c) => {
    const input = parseBody(reviewFlashcardSchema, await c.req.json().catch(() => ({})));
    return c.json<FlashcardDeck>(await reviewFlashcard(c.var.userId, c.req.param('deckId'), input));
  })
  // Body: { scope: 'all' | 'practice' }
  .post('/:deckId/rounds', async (c) => {
    const { scope } = parseBody(newFlashcardRoundSchema, await c.req.json().catch(() => ({})));
    return c.json<FlashcardDeck>(await startFlashcardRound(c.var.userId, c.req.param('deckId'), scope));
  })
  .delete('/:deckId', async (c) => {
    await deleteFlashcardDeck(c.var.userId, c.req.param('deckId'));
    return c.body(null, 204);
  });
