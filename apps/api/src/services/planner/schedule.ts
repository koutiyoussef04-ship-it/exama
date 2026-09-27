/**
 * Deterministic study-plan scheduler — pure, no I/O, no AI.
 *
 * The AI only contributes topic importance (1-3) and short focus notes; everything about time
 * (dates, daily capacity, durations, phases, what fits) is decided here, so a plan can never ask
 * for more than the student said they can study in a day.
 *
 * Model
 *  - Each topic has a *learn* need (only if not studied yet) and a *practice* need that grows with
 *    weakness (1 − mastery) and importance, minus review already done since its latest result.
 *    High-mastery topics get a single light "keep fresh" review.
 *  - Available days (study weekdays, minus unavailable dates, before the exam) are split into
 *    phases: learn → practice (with mock exams) → review → final review. Short windows compress
 *    or skip phases; exam-today / 1-day windows are pure final review.
 *  - Days are filled up to the daily capacity: learn items first on learn days, then practice by
 *    largest remaining need ("deficit"), so weak/important topics get more time. Items can split
 *    across days. Whatever doesn't fit is reported as uncovered — never squeezed into one day.
 *  - With plenty of time the daily session is shortened (≥ 20 min) and spare days rotate light
 *    reviews, weakest first.
 */
import {
  PLAN_EXAM_QUESTIONS,
  PLAN_PRACTICE_QUESTIONS,
  WEAK_TOPIC_THRESHOLD,
  type PlanPhase,
  type PreparedLevel,
  type StudyPlanNotice,
  type TaskActivity,
  type TaskReason,
} from '@study/shared';
import { addDays, diffDays, weekday } from './dates.js';

export type PlannerTopic = {
  topic: string;
  importance: 1 | 2 | 3;
  /** 0..1, null = never tested. */
  mastery: number | null;
  /** Tested at least once, or its learn task was completed. */
  learned: boolean;
  /** Review/practice minutes completed since the topic's latest exam/practice result. */
  reviewedMinutes: number;
  /** A task on this topic was missed or skipped and not yet made up. */
  catchUp: boolean;
};

export type ScheduleInput = {
  today: string;
  examDate: string;
  minutesPerDay: number;
  studyDays: number[];
  unavailableDates: string[];
  preparedLevel: PreparedLevel;
  /** In course order. Empty = course without extracted topics. */
  topics: PlannerTopic[];
  /** First date to plan: today, or tomorrow to keep today's list stable. */
  startDate: string;
  /** Minutes already done or in progress on `startDate` (only relevant when it is today). */
  usedMinutesOnStart: number;
};

export type PlannedTask = {
  date: string;
  activity: TaskActivity;
  phase: PlanPhase;
  topic: string | null;
  minutes: number;
  reason: TaskReason;
  mastery: number | null;
  questionCount: number | null;
};

export type ScheduleResult = {
  tasks: PlannedTask[];
  /** Minutes planned per study day (≤ minutesPerDay). */
  dailyMinutes: number;
  uncoveredTopics: string[];
  notices: StudyPlanNotice[];
  daysUntilExam: number;
  availableDays: string[];
};

export const MIN_TASK = 10;
export const MAX_TASK = 45;
export const MIN_SESSION = 20;
export const MOCK_MINUTES = 25;
export const PRACTICE_MINUTES = 15;
/** Max minutes on exam day (a light final look, not cramming). */
export const EXAM_DAY_MINUTES = 30;

const PREP_LEARN: Record<PreparedLevel, number> = { zero: 1.3, familiar: 0.9, confident: 0.6 };
/** Assumed weakness of a topic that has never been tested. */
const PREP_WEAKNESS: Record<PreparedLevel, number> = { zero: 0.7, familiar: 0.5, confident: 0.35 };
const STRONG = 0.85;

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const floor5 = (n: number) => Math.floor(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const weakness = (t: PlannerTopic, level: PreparedLevel) => (t.mastery === null ? PREP_WEAKNESS[level] : 1 - t.mastery);
export const isWeak = (t: PlannerTopic) => t.mastery !== null && t.mastery < WEAK_TOPIC_THRESHOLD;
/** Proven weakness (low exam/practice results) outranks assumed weakness of untested topics. */
export const priority = (t: PlannerTopic, level: PreparedLevel) => t.importance * (weakness(t, level) + 0.15) * (isWeak(t) ? 1.5 : 1);

export function learnNeed(t: PlannerTopic, level: PreparedLevel): number {
  return t.learned ? 0 : clamp(round5(15 * t.importance * PREP_LEARN[level]), MIN_TASK, 60);
}

export function practiceNeed(t: PlannerTopic, level: PreparedLevel): number {
  if (t.mastery !== null && t.mastery >= STRONG) return Math.max(0, 10 * t.importance - t.reviewedMinutes);
  // Proven weak topics count as at least "normal" importance and get more time per point of weakness.
  const imp = isWeak(t) ? Math.max(t.importance, 2) : t.importance;
  const perWeakness = isWeak(t) ? 70 : 50;
  return Math.max(0, round5(imp * (10 + perWeakness * weakness(t, level))) - t.reviewedMinutes);
}

/** Study days from `from` up to (not including) the exam, respecting weekdays and unavailable dates. */
export function availableDays(input: Pick<ScheduleInput, 'examDate' | 'studyDays' | 'unavailableDates'>, from: string): string[] {
  const out: string[] = [];
  const blocked = new Set(input.unavailableDates);
  for (let d = from; diffDays(d, input.examDate) > 0; d = addDays(d, 1)) {
    if (input.studyDays.includes(weekday(d)) && !blocked.has(d)) out.push(d);
  }
  return out;
}

/** Phase of day i (0-based) out of n available days. */
export function phaseFor(i: number, n: number, hasUnlearned: boolean): PlanPhase {
  const last = n - 1;
  if (n === 1 || i === last) return 'final';
  if (n >= 14 && i === last - 1) return 'final';
  if (n <= 3) return hasUnlearned && i === 0 ? 'learn' : 'practice';
  const frac = i / n;
  const learnFrac = hasUnlearned ? (n < 10 ? 0.35 : 0.4) : 0;
  if (frac < learnFrac) return 'learn';
  if (frac >= (n < 10 ? 0.7 : 0.75)) return 'review';
  return 'practice';
}

/** Days (indexes) that get a mock exam: one for short windows, then about weekly. */
export function mockDays(n: number, hasUnlearned: boolean, dailyMinutes: number): Set<number> {
  const out = new Set<number>();
  // A mock takes ~25 min: in a short window with short sessions, practice is a better use of the time.
  if (n < 4 || (n < 10 && dailyMinutes < 60)) return out;
  const lastFree = n - (n >= 14 ? 3 : 2); // never on final-review days
  if (n < 10) {
    out.add(Math.min(lastFree, Math.floor(n * 0.6)));
    return out;
  }
  const start = Math.floor(n * (hasUnlearned ? 0.45 : 0.2));
  for (let i = start; i <= lastFree; i += 7) out.add(i);
  out.add(Math.min(lastFree, Math.floor(n * 0.85)));
  return out;
}

type Item = { topic: PlannerTopic; remaining: number };

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const level = input.preparedLevel;
  const daysUntilExam = diffDays(input.today, input.examDate);
  const notices: StudyPlanNotice[] = [];
  const empty = (dailyMinutes = input.minutesPerDay): ScheduleResult => ({
    tasks: [],
    dailyMinutes,
    uncoveredTopics: [],
    notices,
    daysUntilExam,
    availableDays: [],
  });

  if (daysUntilExam < 0) {
    notices.push('exam_passed');
    return empty();
  }
  if (input.topics.length === 0) notices.push('no_topics');

  // ---- Days and capacity ----
  const examToday = daysUntilExam === 0;
  if (examToday) notices.push('exam_today');
  const days = examToday
    ? diffDays(input.startDate, input.today) === 0
      ? [input.today]
      : []
    : availableDays(input, input.startDate);
  if (days.length === 0) {
    if (!examToday) notices.push('no_study_days');
    return empty();
  }
  const n = days.length;
  const byPriority = [...input.topics].sort((a, b) => priority(b, level) - priority(a, level) || input.topics.indexOf(a) - input.topics.indexOf(b));
  const learnQueue: Item[] = byPriority.filter((t) => learnNeed(t, level) > 0).map((t) => ({ topic: t, remaining: learnNeed(t, level) }));
  const hasUnlearned = learnQueue.length > 0;
  const phases = days.map((_, i) => phaseFor(i, n, hasUnlearned));
  const mocks = mockDays(n, hasUnlearned, input.minutesPerDay);
  for (const i of mocks) phases[i] = 'test';

  const need =
    learnQueue.reduce((s, it) => s + it.remaining, 0) +
    input.topics.reduce((s, t) => s + practiceNeed(t, level), 0) +
    mocks.size * MOCK_MINUTES +
    (input.topics.length === 0 ? n * MIN_SESSION : 0);
  let daily = input.minutesPerDay;
  if (examToday) daily = Math.min(daily, EXAM_DAY_MINUTES);
  else if (need / n < input.minutesPerDay) {
    daily = clamp(Math.ceil((need * 1.15) / n / 5) * 5, MIN_SESSION, input.minutesPerDay);
  }
  if (daily < input.minutesPerDay && !examToday) notices.push('light_schedule');

  // ---- Fill days ----
  const tasks: PlannedTask[] = [];
  const allocated = new Map<string, number>(); // practice/review minutes per topic
  const scheduled = new Set<string>(); // topics that got any task
  const questionsEvery = n > 14 ? 2 : 1; // long plans: practice questions every other day (AI allowance)
  let lastQuestionsDay = -Infinity;
  const hasWeak = input.topics.some(isWeak);
  const learnStarted = new Set<string>(); // learn scheduled (practice may follow)
  const catchUpUsed = new Set<string>();

  const reasonFor = (t: PlannerTopic, fallback: TaskReason): TaskReason => {
    if (t.catchUp && !catchUpUsed.has(t.topic)) {
      catchUpUsed.add(t.topic);
      return 'catch_up';
    }
    if (isWeak(t)) return 'weak_topic';
    if (t.mastery !== null && t.mastery >= STRONG) return 'keep_fresh';
    return fallback;
  };

  const push = (date: string, phase: PlanPhase, activity: TaskActivity, topic: PlannerTopic | null, minutes: number, reason: TaskReason, questionCount: number | null = null) => {
    tasks.push({ date, phase, activity, topic: topic?.topic ?? null, minutes, reason, mastery: topic?.mastery ?? null, questionCount });
    if (topic) scheduled.add(topic.topic);
  };

  /** Next practice/review topic: biggest remaining need first; when all needs are met, light rotation. */
  const nextPracticeTopic = (usedToday: Set<string>): PlannerTopic | null => {
    const eligible = input.topics.filter((t) => (t.learned || learnStarted.has(t.topic)) && !usedToday.has(t.topic));
    if (eligible.length === 0) return null;
    const deficit = (t: PlannerTopic) => practiceNeed(t, level) - (allocated.get(t.topic) ?? 0);
    const withNeed = eligible.filter((t) => deficit(t) > 0);
    const pool = withNeed.length ? withNeed : eligible;
    const score = (t: PlannerTopic) => (withNeed.length ? deficit(t) + priority(t, level) : priority(t, level) / (1 + (allocated.get(t.topic) ?? 0) / 15));
    return [...pool].sort((a, b) => score(b) - score(a) || input.topics.indexOf(a) - input.topics.indexOf(b))[0];
  };

  let learnedToday = new Set<string>();
  const takeLearn = (date: string, phase: PlanPhase, cap: number): number => {
    // One piece of a topic per day: a long topic continues tomorrow, so days mix topics.
    const idx = learnQueue.findIndex((it) => !learnedToday.has(it.topic.topic));
    const item = learnQueue[idx];
    if (!item || cap < MIN_TASK) return 0;
    const minutes = floor5(Math.min(item.remaining, cap, MAX_TASK));
    if (minutes < MIN_TASK) return 0;
    push(date, phase, 'learn', item.topic, minutes, item.topic.catchUp && !catchUpUsed.has(item.topic.topic) ? (catchUpUsed.add(item.topic.topic), 'catch_up') : item.topic.importance === 3 ? 'important_topic' : 'new_material');
    learnStarted.add(item.topic.topic);
    learnedToday.add(item.topic.topic);
    item.remaining -= minutes;
    if (item.remaining < MIN_TASK) learnQueue.splice(idx, 1);
    return minutes;
  };

  for (let i = 0; i < n; i++) {
    const date = days[i];
    const phase = phases[i];
    let cap = date === input.startDate ? Math.max(0, daily - input.usedMinutesOnStart) : daily;
    const usedToday = new Set<string>();
    learnedToday = new Set<string>();
    let practiceWithQuestions = false;

    // No topics: whole-course sessions.
    if (input.topics.length === 0) {
      if (phase === 'test' && cap >= MIN_SESSION) {
        push(date, 'test', 'exam', null, Math.min(MOCK_MINUTES, cap), 'mock_exam', PLAN_EXAM_QUESTIONS);
        cap -= Math.min(MOCK_MINUTES, cap);
      }
      if (cap >= MIN_TASK) push(date, phase, phase === 'learn' ? 'learn' : 'review', null, floor5(Math.min(cap, MAX_TASK)), phase === 'final' ? 'final_review' : 'whole_course');
      continue;
    }

    if (phase === 'test' && cap >= MIN_SESSION) {
      const m = Math.min(MOCK_MINUTES, cap);
      push(date, 'test', 'exam', null, m, 'mock_exam', PLAN_EXAM_QUESTIONS);
      cap -= m;
    }

    if (phase === 'final') {
      // Weakest / most important first; short focused reviews. Up to 3 rounds if there is time.
      for (let round = 0; round < 3 && cap >= MIN_TASK; round++) {
        for (const t of byPriority) {
          if (cap < MIN_TASK) break;
          if (!(t.learned || learnStarted.has(t.topic))) continue;
          if (round > 0 && !isWeak(t) && t.importance < 3) continue; // extra rounds: weak/central topics only
          const m = floor5(Math.min(cap, examToday ? 15 : 20));
          push(date, 'final', isWeak(t) ? 'weak_review' : 'review', t, m, 'final_review');
          allocated.set(t.topic, (allocated.get(t.topic) ?? 0) + m);
          cap -= m;
        }
        // Nothing studied yet (e.g. exam tomorrow, starting from zero): cover the top topics now.
        while (round === 0 && !examToday && cap >= MIN_TASK && learnQueue.length) {
          const took = takeLearn(date, 'final', Math.min(cap, 20));
          if (!took) break;
          cap -= took;
        }
      }
      continue;
    }

    if (phase === 'learn') {
      // Leave room for proven weak topics so new material never crowds them out completely.
      const reserve = hasWeak ? Math.min(PRACTICE_MINUTES, floor5(cap / 3)) : 0;
      while (cap - reserve >= MIN_TASK && learnQueue.length) {
        const took = takeLearn(date, 'learn', cap - reserve);
        if (!took) break;
        cap -= took;
      }
    } else if (learnQueue.length && cap >= MIN_TASK * 2) {
      // Keep covering new material outside the learn phase, but leave room for practice.
      cap -= takeLearn(date, phase, Math.floor(cap / 2));
    }

    // Practice / review to fill the rest of the day.
    for (let guard = 0; cap >= MIN_TASK && guard < 12; guard++) {
      const t = nextPracticeTopic(usedToday);
      if (!t) break;
      const withQuestions =
        !practiceWithQuestions && phase !== 'review' && cap >= PRACTICE_MINUTES && i - lastQuestionsDay >= questionsEvery;
      const deficit = practiceNeed(t, level) - (allocated.get(t.topic) ?? 0);
      const m = withQuestions ? PRACTICE_MINUTES : floor5(Math.min(cap, clamp(round5(deficit > 0 ? deficit : 15), MIN_TASK, 30)));
      if (m < MIN_TASK || m > cap) break;
      const activity: TaskActivity = withQuestions ? 'practice' : isWeak(t) ? 'weak_review' : 'review';
      const fallback: TaskReason = t.mastery === null ? (t.importance === 3 ? 'important_topic' : 'new_material') : t.importance === 3 ? 'important_topic' : 'keep_fresh';
      push(date, phase === 'learn' ? 'practice' : phase, activity, t, m, reasonFor(t, fallback), withQuestions ? PLAN_PRACTICE_QUESTIONS : null);
      if (withQuestions) {
        practiceWithQuestions = true;
        lastQuestionsDay = i;
      }
      allocated.set(t.topic, (allocated.get(t.topic) ?? 0) + m);
      usedToday.add(t.topic);
      cap -= m;
    }
  }

  // Topics that never got time (or whose material couldn't be covered) — most important are planned first.
  const uncovered = input.topics
    .filter((t) => !scheduled.has(t.topic) || learnQueue.some((it) => it.topic === t))
    .map((t) => t.topic);
  if (uncovered.length) notices.push('not_enough_time');

  // Order within each day: exam first, then learn, practice, reviews (stable); merge split pieces.
  const rank: Record<TaskActivity, number> = { exam: 0, learn: 1, practice: 2, weak_review: 3, review: 4 };
  tasks.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank[a.activity] - rank[b.activity]));
  const merged: PlannedTask[] = [];
  for (const t of tasks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.date === t.date && prev.topic === t.topic && prev.activity === t.activity && t.activity !== 'exam' && t.activity !== 'practice') {
      prev.minutes += t.minutes;
    } else merged.push({ ...t });
  }
  return { tasks: merged, dailyMinutes: daily, uncoveredTopics: uncovered, notices, daysUntilExam, availableDays: days };
}
