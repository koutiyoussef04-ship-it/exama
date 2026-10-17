/** Exam screen: option markers, word count, progress states, and that the redesign keeps the exam behaviour. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { countWords, isAnswered, nextUnanswered, optionLetter, questionStates } from '../src/lib/exam-ui';
import i18n, { initI18n } from '../src/i18n';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('option markers follow the exam’s script', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => optionLetter(i, 'en')), ['A', 'B', 'C', 'D']);
  assert.deepEqual([0, 1, 2, 3].map((i) => optionLetter(i, 'fr')), ['A', 'B', 'C', 'D']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => optionLetter(i, 'ar')), ['أ', 'ب', 'ج', 'د', 'هـ', 'و']);
  assert.equal(optionLetter(7, 'en'), '8', 'beyond six options: a number');
  assert.equal(optionLetter(0, null), 'A');
});

test('word count works for any script and ignores extra spaces', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(' Mitosis  makes two\nidentical cells '), 5);
  assert.equal(countWords('الانقسام المتساوي ينتج خليتين'), 4);
  assert.equal(isAnswered('  '), false);
  assert.equal(isAnswered(' a '), true);
});

test('progress states: current, answered, open; next unanswered wraps around', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const answers = { a: 'x', c: '  ', d: 'y' };
  assert.deepEqual(questionStates(ids, answers, 1), ['answered', 'current', 'unanswered', 'answered']);
  assert.equal(nextUnanswered(ids, answers, 0), 1);
  assert.equal(nextUnanswered(ids, answers, 2), 1, 'wraps past the end');
  assert.equal(nextUnanswered(ids, { a: '1', b: '2', c: '3', d: '4' }, 0), null);
});

test('word count is pluralized in every language (Arabic: all six forms)', async () => {
  await initI18n('en');
  const cases: [string, number, string][] = [
    ['en', 1, '1 word'],
    ['en', 12, '12 words'],
    ['es', 1, '1 palabra'],
    ['fr', 3, '3 mots'],
    ['ar', 0, 'لا كلمات'],
    ['ar', 2, 'كلمتان'],
    ['ar', 5, '5 كلمات'],
    ['ar', 11, '11 كلمة'],
  ];
  for (const [lang, count, want] of cases) {
    await i18n.changeLanguage(lang);
    assert.equal(i18n.t('exam.wordCount', { count }), want, `${lang} ${count}`);
  }
  await i18n.changeLanguage('en');
});

test('the redesign keeps the exam behaviour: drafts, skip/next, confirm before submitting with gaps', () => {
  const screen = src('app/exams/[id].tsx');
  assert.match(screen, /examDrafts\.set\(exam\.id, answers\)/, 'answers survive leaving');
  assert.match(screen, /examDrafts\.clear\(exam\.id\)/, 'cleared after grading');
  assert.match(screen, /isAnswered\(answers\[q\.id\]\) \? t\('exam\.next'\) : t\('exam\.skip'\)/);
  assert.match(screen, /if \(unanswered > 0\) \{\s*const ok = await confirm\(/);
  assert.match(screen, /questions\.map\(\(x\) => \(\{ questionId: x\.id, answer: answers\[x\.id\] \?\? '' \}\)\)/, 'every question is sent, unanswered as empty');
  assert.match(screen, /trackOnce\(`started:\$\{exam\.id\}`/);
});

test('accessibility: radios with a checked state in a labelled group, labelled progress, map buttons, reduced motion', () => {
  const parts = src('components/exam-question.tsx');
  const screen = src('app/exams/[id].tsx');
  assert.match(parts, /accessibilityRole="radio"\s*accessibilityState=\{\{ checked: selected, selected \}\}/);
  assert.match(parts, /aria-checked=\{selected\}/, 'web screen readers get the checked state');
  assert.match(parts, /aria-valuenow=\{answered\}/);
  assert.match(screen, /accessibilityRole="radiogroup" accessibilityLabel=\{t\('exam\.chooseOne'\)\}/);
  assert.match(parts, /accessibilityRole="progressbar"[\s\S]{0,200}accessibilityValue=\{\{ min: 0, max: total, now: answered \}\}/);
  assert.match(parts, /accessibilityLabel=\{`\$\{t\('exam\.jumpTo', \{ n: i \+ 1 \}\)\}, \$\{stateLabel\}`\}/);
  assert.match(parts, /isReduceMotionEnabled\(\)/);
  assert.match(screen, /announceForAccessibility/);
  // Exam content keeps its own direction inside any app language.
  assert.match(parts, /<ContentDirection language=\{language\} style=\{\{ flex: 1 \}\}>/);
  // No physical left/right in the new layout (RTL mirrors through start/end and row order).
  assert.doesNotMatch(parts, /\b(marginLeft|marginRight|paddingLeft|paddingRight|left:|right:|textAlign: 'right'|textAlign: 'left')/);
});
