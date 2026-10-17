/**
 * Flashcards (client): next card, optimistic answers, the course tile, web keyboard shortcuts (incl.
 * right-to-left), the screens' wiring (both platforms share them), and translations in all languages.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type Flashcard, type FlashcardDeck, type FlashcardDeckSummary } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import { applyReview, cardNumber, deckTileStatus, keyAction, nextCard, practiceCount, progressOf, roundCards } from '../src/lib/flashcards';

const card = (i: number, extra: Partial<Flashcard> = {}): Flashcard => ({
  id: `c${i}`,
  position: i,
  topic: 'Photosynthesis',
  front: `Q${i}?`,
  back: `A${i}.`,
  sourceQuote: 'a quote from the material',
  inRound: true,
  roundResult: null,
  lastResult: null,
  ...extra,
});
const deck = (cards: Flashcard[], round = 1): FlashcardDeck => ({
  id: 'd1',
  documentId: 'doc',
  cardCount: cards.length,
  language: 'en',
  round,
  progress: progressOf(cards),
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
  cards,
});

test('the next card is the first unanswered one of the round, in deck order; none when the round is done', () => {
  const d = deck([card(2), card(0, { roundResult: 'known' }), card(1), card(3, { inRound: false })]);
  assert.deepEqual(roundCards(d).map((c) => c.id), ['c0', 'c1', 'c2']);
  assert.equal(nextCard(d)?.id, 'c1');
  assert.equal(cardNumber(d, nextCard(d)!), 2, '"Card 2 of 3"');
  assert.equal(nextCard(deck([card(0, { roundResult: 'known' })])), null);
});

test('answering shows immediately (optimistic) and can be changed without double counting', () => {
  let d = deck([card(0), card(1), card(2)]);
  d = applyReview(d, 'c0', 'known');
  d = applyReview(d, 'c1', 'practice');
  assert.deepEqual(d.progress, { total: 3, reviewed: 2, known: 1, practice: 1, completed: false });
  d = applyReview(d, 'c1', 'known');
  assert.deepEqual(d.progress, { total: 3, reviewed: 2, known: 2, practice: 0, completed: false });
  d = applyReview(d, 'c2', 'practice');
  assert.equal(d.progress.completed, true);
  assert.equal(practiceCount(d), 1);
  const outside = deck([card(0), card(1, { inRound: false })]);
  assert.deepEqual(applyReview(outside, 'c1', 'known').progress, outside.progress, 'cards outside the round are untouched');
});

test('the course tile: new, resume where you left off, or done (with cards to practise)', () => {
  const summary = (p: Partial<FlashcardDeckSummary['progress']>): FlashcardDeckSummary => ({
    ...deck([card(0)]),
    progress: { total: 10, reviewed: 0, known: 0, practice: 0, completed: false, ...p },
  });
  assert.deepEqual(deckTileStatus(undefined), { kind: 'new' });
  assert.deepEqual(deckTileStatus(summary({ reviewed: 4 })), { kind: 'resume', reviewed: 4, total: 10 });
  assert.deepEqual(deckTileStatus(summary({ reviewed: 10, known: 7, practice: 3, completed: true })), { kind: 'done', practice: 3, total: 10 });
});

test('web keyboard: Space/Enter reveal, then → / K knew it and ← / P needs practice (mirrored in RTL)', () => {
  assert.equal(keyAction({ key: ' ' }, false), 'flip');
  assert.equal(keyAction({ key: 'Enter' }, false), 'flip');
  assert.equal(keyAction({ key: 'ArrowRight' }, false), null, 'answer keys need the answer shown first');
  assert.equal(keyAction({ key: 'ArrowRight' }, true), 'known');
  assert.equal(keyAction({ key: 'ArrowLeft' }, true), 'practice');
  assert.equal(keyAction({ key: 'K' }, true), 'known');
  assert.equal(keyAction({ key: 'p' }, true), 'practice');
  assert.equal(keyAction({ key: 'ArrowLeft' }, true, true), 'known', 'RTL: ← points forward');
  assert.equal(keyAction({ key: 'ArrowRight' }, true, true), 'practice');
  assert.equal(keyAction({ key: 'k', ctrlKey: true }, true), null);
  assert.equal(keyAction({ key: ' ', targetTag: 'INPUT' }, false), null);
});

test('screens: the deck route is signed-in only; the course screen shows Flashcards next to Start an exam', () => {
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  const signedIn = layout.slice(layout.indexOf('guard={!!user}'), layout.indexOf('</Stack.Protected>', layout.indexOf('guard={!!user}')));
  assert.ok(signedIn.includes('name="flashcards/[id]"'));
  const course = readFileSync(new URL('../src/app/documents/[id].tsx', import.meta.url), 'utf8');
  const tiles = course.split('<StudyTiles>').slice(1);
  assert.equal(tiles.length, 2, 'first visit and returning layouts');
  for (const block of tiles) {
    const end = block.indexOf('</StudyTiles>');
    assert.ok(block.slice(0, end).includes("t('study.") && block.slice(0, end).includes('<FlashcardsTile'), 'exam tile and flashcards tile together');
  }
  assert.ok(!course.includes("examSubtitle', { count"), 'the exam tile passes {{questions}}, not {{count}}');
  assert.equal(course.split("t('study.examSubtitle', { questions: EXAM_LENGTH })").length - 1, 2);
  const screen = readFileSync(new URL('../src/app/flashcards/[id].tsx', import.meta.url), 'utf8');
  assert.ok(screen.includes("Platform.OS !== 'web'") && screen.includes("document.addEventListener('keydown'"), 'keyboard only on the web');
  const parts = readFileSync(new URL('../src/components/flashcards.tsx', import.meta.url), 'utf8');
  assert.ok(parts.includes('isReduceMotionEnabled') && parts.includes('backfaceVisibility'), 'flip respects reduced motion');
  assert.ok(!/from 'react-dom'|document\.|window\./.test(parts), 'shared components use no web-only APIs (they run on iOS/Android too)');
});

const FC_KEYS = ['tileTitle', 'tileSubtitle', 'tileResume', 'tileDone', 'making', 'makingDetail', 'question', 'answer', 'tapToFlip', 'showAnswer', 'knewIt', 'needPractice', 'keyFlip', 'keyKnown', 'keyPractice', 'cardOf', 'doneTitle', 'doneAllTitle', 'knewOf', 'statReviewed', 'statKnown', 'statPractice', 'reviewAll', 'newDeckTitle', 'usesPractice', 'makeNewDeck', 'backToCourse'];
for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
  test(`${lang}: flashcards and study tiles are translated (no raw keys)`, async () => {
    await initI18n(lang);
    const tr = (k: string, o?: Record<string, unknown>): string => String(i18n.t(k as 'nav.flashcards', o as never));
    for (const k of FC_KEYS) assert.ok(!tr(`flashcards.${k}`).startsWith('flashcards.'), `${lang} flashcards.${k}`);
    for (const n of [0, 1, 2, 5, 11, 20]) {
      for (const k of ['cards', 'reviewDifficult', 'tileDonePractice', 'statKnownA11y', 'statPracticeA11y']) assert.ok(!tr(`flashcards.${k}`, { count: n }).startsWith('flashcards.'), `${lang} ${k} ${n}`);
    }
    assert.ok(tr('flashcards.cardOf', { current: 3, total: 10 }).includes('3'));
    for (const k of ['startExam', 'newExam']) assert.ok(!tr(`study.${k}`).startsWith('study.'));
    assert.ok(tr('study.examSubtitle', { questions: 8 }).includes('8'));
    for (const c of ['flashcards_in_progress', 'flashcards_not_enough_material', 'flashcards_round_changed', 'flashcards_none_to_practice']) assert.ok(!tr(`errors.codes.${c}`).startsWith('errors.'));
    if (lang === 'ar') assert.match(tr('flashcards.knewIt'), /\p{Script=Arabic}/u);
  });
}
