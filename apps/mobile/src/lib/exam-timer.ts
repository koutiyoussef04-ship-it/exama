/**
 * Exam timer: how long the student has spent taking an exam, keyed by exam id.
 *
 * Kept next to the answer drafts (exam-drafts.ts) and with the same lifetime: in memory for this app
 * session, so it survives moving between questions, leaving the exam (back gesture, checking the
 * course) and coming back, and component re-renders. Cleared once the exam is graded.
 *
 * Timestamp-based, never counted by interval ticks: a clock is the time already spent plus the start
 * of the current run, read from a monotonic clock (performance.now), so a slow or throttled timer
 * cannot drift and a change of the device's wall clock cannot move it. The screen only re-renders
 * once a second to show the new value.
 *
 * The clock runs while the exam is on screen and the app is in the foreground; it is paused while
 * the student is elsewhere and stops when the exam is submitted.
 */
import { MAX_EXAM_DURATION_SECONDS } from '@study/shared';

export type ExamClock = { accumulatedMs: number; runningSince: number | null };

export const IDLE_CLOCK: ExamClock = { accumulatedMs: 0, runningSince: null };

/** Monotonic milliseconds (not wall-clock time). Date.now() only where performance.now() is missing. */
export const monotonicNow = (): number => (typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now());

export function startClock(c: ExamClock, now: number): ExamClock {
  return c.runningSince !== null ? c : { accumulatedMs: c.accumulatedMs, runningSince: now };
}

export function pauseClock(c: ExamClock, now: number): ExamClock {
  return c.runningSince === null ? c : { accumulatedMs: c.accumulatedMs + Math.max(0, now - c.runningSince), runningSince: null };
}

export function elapsedMs(c: ExamClock, now: number): number {
  return c.accumulatedMs + (c.runningSince === null ? 0 : Math.max(0, now - c.runningSince));
}

/** Whole seconds to report on submit, within what the API accepts. */
export function toDurationSeconds(ms: number): number {
  return Math.min(MAX_EXAM_DURATION_SECONDS, Math.max(0, Math.floor(ms / 1000)));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** MM:SS, or HH:MM:SS from one hour. Digits only, so it reads the same in every language. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The per-exam clocks. `now` is injectable for tests. */
export function createExamTimers(now: () => number = monotonicNow) {
  const clocks = new Map<string, ExamClock>();
  const get = (examId: string) => clocks.get(examId) ?? IDLE_CLOCK;
  return {
    /** Starts (or resumes) the clock. Starting a running clock changes nothing. */
    start: (examId: string) => void clocks.set(examId, startClock(get(examId), now())),
    /** Pauses the clock, keeping the time spent. Pausing an unknown or paused clock changes nothing. */
    pause: (examId: string) => {
      const c = clocks.get(examId);
      if (c) clocks.set(examId, pauseClock(c, now()));
    },
    elapsedMs: (examId: string) => elapsedMs(get(examId), now()),
    isRunning: (examId: string) => get(examId).runningSince !== null,
    clear: (examId: string) => void clocks.delete(examId),
  };
}

export const examTimers = createExamTimers();
