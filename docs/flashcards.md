# Flashcards

Question → answer cards generated from a course's own material, beside "Start an exam" on the course
screen. Web, iOS and Android share the same screens (`apps/mobile`).

## Student journey

1. Course screen: two equal tiles, **Start an exam** (test your knowledge) and **Flashcards** (review
   and remember key concepts). The Flashcards tile opens the latest deck where the student left off
   ("4 of 10 reviewed · continue"), or makes the first deck (10 cards, in the study language).
2. Deck screen: one card at a time. Tap the card, "Show answer", or Space/Enter on the web turns it
   over (3D flip; instant with reduced motion). Then **Needs practice** or **I knew it**
   (web: ← / P and → / K; the arrows are mirrored in Arabic).
3. Every answer is saved on the server immediately (shown at once, rolled back if saving fails), so a
   refresh, sign-out or another device resumes at the same card.
4. End of a round: known/total, reviewed / knew it / need practice, then **Review the N difficult
   cards**, **Review all cards again**, **Make a new deck** (5, 10 or 20 cards), or back to the course.

## Generation, grounding and cost

- Uses the course's stored chunks (nothing is re-processed) with the same 40k-character excerpt
  budget as an exam, through the existing `StudyAI` layer (`generateFlashcards`: JSON validated with zod).
- Every card must carry a verbatim `sourceQuote` that is checked against the material (same
  `MaterialIndex` as exam questions); malformed, duplicate or ungrounded cards are dropped. No valid
  card → `ai_bad_output`. Thin material → 422 `flashcards_not_enough_material`.
- **Response-length limit:** large decks are written in parallel batches of at most 11 cards, each with
  a reply budget of 600 + 450 tokens per card (5,550 for 11), enough for Arabic. A batch cut off at
  `max_tokens` is split in two once; if any batch still fails, no deck is created and nothing is
  charged. Exams use the same mechanism (batches of 6 questions) — see `apps/api/src/ai/llm-study-ai.ts`
  and `test/ai-response-limits.test.ts`. Real-model check: `npm run ai:check -w @study/api -- --long`.
- **Usage:** each delivered card counts as **one practice question** of the plan's monthly allowance
  (shared with practice sets). The allowance is reserved before the AI call, the deck is trimmed to
  what is left, only delivered cards are charged, and everything is refunded on failure. Nothing left
  → 402 `limit_reached` / `practice_questions` → the existing paywall. Reviewing is always free.
- Safeguards: one generation per student at a time (409 `flashcards_in_progress`), at most 8
  generations per 10 minutes per student (429), at most 20 cards per deck.

## API

| Endpoint | Notes |
|---|---|
| `GET /documents/:id/flashcards` | the course's decks (summaries, newest first) |
| `POST /documents/:id/flashcards` `{cardCount: 5\|10\|20, language?}` | 201 deck · 402 · 409 · 422 · 429 · 502/503 `ai_*` |
| `GET /flashcards/:deckId` | deck with cards and round progress |
| `POST /flashcards/:deckId/review` `{cardId, result: known\|practice, round}` | 409 `flashcards_round_changed` for an older round |
| `POST /flashcards/:deckId/rounds` `{scope: all\|practice}` | 409 `flashcards_none_to_practice` |
| `DELETE /flashcards/:deckId` | 204 |

Decks of other students answer 404. `/flashcards/*` and `/documents/*` are covered by the
email-verification restriction when it is switched on.

## Database (migration `0014_flashcards.sql`, additive)

`flashcard_decks` (user, course, language, round) and `flashcards` (front, back, topic, source quote,
in_round, round_result, last_result, counters), with cascade deletes from users, documents and decks.

## Analytics

`flashcards_generated` (document id, requested/delivered counts, language, duration, success/failure
reason) and `flashcards_round_completed` (deck id, round, counts). Never card text.
