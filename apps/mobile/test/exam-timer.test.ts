/**
 * Exam timer: elapsed time from timestamps (not interval counting), kept per exam across questions,
 * leaving and coming back, and re-renders; stopped on submit and shown on the results.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_EXAM_DURATION_SECONDS, submitExamSchema } from '@study/shared';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { createExamTimers, elapsedMs, formatElapsed, IDLE_CLOCK, monotonicNow, pauseClock, startClock, toDurationSeconds } from '../src/lib/exam-timer';
import { examDrafts } from '../src/lib/exam-drafts';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const SEC = 1000;
/** A controllable monotonic clock. */
const fakeClock = (start = 50_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};

test('format: MM:SS below an hour, HH:MM:SS from one hour', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(999), '00:00', 'whole seconds only');
  assert.equal(formatElapsed(9 * SEC), '00:09');
  assert.equal(formatElapsed(65 * SEC), '01:05');
  assert.equal(formatElapsed(59 * 60 * SEC + 59 * SEC), '59:59');
  assert.equal(formatElapsed(3600 * SEC), '01:00:00');
  assert.equal(formatElapsed(3 * 3600 * SEC + 25 * 60 * SEC + 7 * SEC), '03:25:07');
  assert.equal(formatElapsed(-5), '00:00');
  assert.match(formatElapsed(12 * 3600 * SEC), /^\d{2}:\d{2}:\d{2}$/, 'digits only, the same in every language');
});

test('progression: the time comes from timestamps, so it is right however often (or rarely) the screen updates', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  assert.equal(timers.elapsedMs('e1'), 0, 'nothing before the student opens the exam (generation does not count)');
  timers.start('e1');
  clock.advance(1500);
  assert.equal(timers.elapsedMs('e1'), 1500);
  clock.advance(42 * 60 * SEC); // no ticks at all in between (throttled tab, slow device)
  assert.equal(formatElapsed(timers.elapsedMs('e1')), '42:01');
  clock.advance(18 * 60 * SEC);
  assert.equal(formatElapsed(timers.elapsedMs('e1')), '01:00:01');
});

test('re-renders and repeated starts never reset or speed up the clock', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  timers.start('e1');
  clock.advance(10 * SEC);
  for (let i = 0; i < 20; i++) timers.start('e1'); // e.g. the effect running again
  clock.advance(5 * SEC);
  assert.equal(timers.elapsedMs('e1'), 15 * SEC);
  // Reading the time is free of side effects.
  for (let i = 0; i < 20; i++) timers.elapsedMs('e1');
  assert.equal(timers.elapsedMs('e1'), 15 * SEC);
});

test('navigation between questions: the clock keeps running (it belongs to the exam, not to a question)', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  timers.start('e1');
  for (let q = 0; q < 5; q++) clock.advance(30 * SEC); // five questions, back and forth
  assert.equal(timers.elapsedMs('e1'), 150 * SEC);
  assert.equal(timers.isRunning('e1'), true);
});

test('leaving and coming back: the time spent is kept, time away is not counted, and it resumes', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  timers.start('e1');
  clock.advance(2 * 60 * SEC);
  timers.pause('e1'); // left the exam screen / app went to the background
  assert.equal(timers.isRunning('e1'), false);
  clock.advance(30 * 60 * SEC); // away
  assert.equal(timers.elapsedMs('e1'), 2 * 60 * SEC);
  timers.pause('e1');
  assert.equal(timers.elapsedMs('e1'), 2 * 60 * SEC, 'pausing twice changes nothing');
  timers.start('e1'); // back on the exam (the screen was unmounted and mounted again)
  clock.advance(45 * SEC);
  assert.equal(formatElapsed(timers.elapsedMs('e1')), '02:45');
  // Answers are kept by the same per-session mechanism.
  examDrafts.set('e-resume', { q1: 'B' });
  assert.deepEqual(examDrafts.get('e-resume'), { q1: 'B' });
  examDrafts.clear('e-resume');
});

test('each exam has its own clock', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  timers.start('a');
  clock.advance(10 * SEC);
  timers.pause('a');
  timers.start('b');
  clock.advance(3 * SEC);
  assert.deepEqual([timers.elapsedMs('a'), timers.elapsedMs('b')], [10 * SEC, 3 * SEC]);
  timers.pause('unknown');
  assert.equal(timers.elapsedMs('unknown'), 0, 'pausing an exam that never started does not create a clock');
});

test('submission: the time is read at submit, stays fixed while grading, and the clock is removed after grading', () => {
  const clock = fakeClock();
  const timers = createExamTimers(clock.now);
  timers.start('e1');
  clock.advance(12 * 60 * SEC + 4 * SEC);
  const sent = toDurationSeconds(timers.elapsedMs('e1'));
  assert.equal(sent, 724);
  timers.pause('e1'); // grading: the screen stops the clock
  clock.advance(20 * SEC);
  assert.equal(toDurationSeconds(timers.elapsedMs('e1')), 724, 'grading time is not exam time');
  // Grading failed: the student is back on the exam and the clock resumes from where it stopped.
  timers.start('e1');
  clock.advance(6 * SEC);
  assert.equal(toDurationSeconds(timers.elapsedMs('e1')), 730);
  timers.clear('e1'); // graded
  assert.equal(timers.elapsedMs('e1'), 0);
  assert.equal(timers.isRunning('e1'), false);
});

test('pure clock helpers are immutable and never count backwards', () => {
  const running = startClock(IDLE_CLOCK, 100);
  assert.deepEqual(IDLE_CLOCK, { accumulatedMs: 0, runningSince: null });
  assert.equal(elapsedMs(running, 50), 0, 'a clock that went backwards adds nothing');
  const paused = pauseClock(running, 400);
  assert.deepEqual(paused, { accumulatedMs: 300, runningSince: null });
  assert.equal(pauseClock(paused, 9_999), paused);
  assert.equal(startClock(running, 999), running);
  assert.equal(typeof monotonicNow(), 'number');
});

test('the reported time is whole seconds within what the API accepts', () => {
  assert.equal(toDurationSeconds(59_999), 59);
  assert.equal(toDurationSeconds(-1), 0);
  assert.equal(toDurationSeconds(100 * 3600 * SEC), MAX_EXAM_DURATION_SECONDS, 'an exam left open for days is clamped, never refused');
  for (const ms of [0, 1234, 3600 * SEC, 100 * 3600 * SEC]) {
    assert.ok(submitExamSchema.safeParse({ answers: [{ questionId: crypto.randomUUID(), answer: 'x' }], durationSeconds: toDurationSeconds(ms) }).success, String(ms));
  }
  assert.ok(submitExamSchema.safeParse({ answers: [{ questionId: crypto.randomUUID(), answer: 'x' }] }).success, 'optional');
  assert.equal(submitExamSchema.safeParse({ answers: [{ questionId: crypto.randomUUID(), answer: 'x' }], durationSeconds: -3 }).success, false);
});

test('the exam screen: starts on opening, runs across questions, stops on submit, shows the time and keeps answers', () => {
  const screen = src('app/exams/[id].tsx');
  assert.match(screen, /const elapsed = useExamClock\(exam\.id, !submit\.isPending && !submit\.isSuccess\);/, 'paused while grading');
  assert.match(screen, /durationSeconds: toDurationSeconds\(examTimers\.elapsedMs\(exam\.id\)\)/, 'sent with the answers');
  assert.match(screen, /examTimers\.clear\(exam\.id\);/, 'removed once graded');
  assert.match(screen, /examDrafts\.set\(exam\.id, answers\)/, 'answers still saved');
  assert.match(screen, /elapsed=\{formatElapsed\(elapsed\)\}/);
  assert.match(screen, /exam\.durationSeconds != null &&/, 'results show the time when it was recorded');
  assert.match(screen, /formatElapsed\(exam\.durationSeconds \* 1000\)/);
  const hook = src('lib/use-exam-clock.ts');
  assert.match(hook, /useFocusEffect\(/, 'runs only while the exam screen is focused');
  assert.match(hook, /AppState\.addEventListener\('change'/, 'pauses in the background');
  assert.match(hook, /examTimers\.pause\(examId\)/);
  assert.doesNotMatch(hook, /elapsed\s*\+=|\+\+|\+ 1000/, 'never counts ticks');
  const hero = src('components/exam-question.tsx');
  assert.match(hero, /t\('exam\.timeElapsed'\)/);
  assert.match(hero, /writingDirection: 'ltr'/, 'digits read left to right in Arabic too');
});

test('timer labels exist in every app language', () => {
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    const exam = l.exam as Record<string, string>;
    for (const key of ['timeElapsed', 'timeElapsedA11y', 'timeTaken', 'timeTakenA11y']) {
      assert.ok(typeof exam[key] === 'string' && exam[key].trim().length > 0, `${lang}.exam.${key}`);
      if (key.endsWith('A11y')) assert.match(exam[key], /\{\{time\}\}/, `${lang}.exam.${key}`);
    }
  }
  assert.equal(en.exam.timeTaken, 'Time taken');
});
