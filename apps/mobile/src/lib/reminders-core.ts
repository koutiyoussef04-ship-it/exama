/**
 * Daily study reminders — the pure part (no React Native), unit-tested in test/reminders.test.ts.
 *
 * One local notification per day at most, at the time the student chose, in the device's local
 * time zone. Only days with something meaningful to do get one:
 *   - study-plan tasks planned for that day (their course and first topic), with an "exam coming
 *     up" wording in the last 3 days before an exam;
 *   - otherwise (no plan tasks at all), a single "next practice session is ready" nudge on the next
 *     reminder slot — only if there is an unfinished exam/practice set or weak topics to practise.
 * Nothing is scheduled when there is nothing to do. Scheduled a week ahead and rebuilt whenever
 * the app opens, so reminders stop by themselves when the student stops studying.
 */
import type { StudyPlan } from '@study/shared';
import { addDaysIso, diffDaysIso, todayIso } from './plan-dates';

export type ReminderSettings = { enabled: boolean; hour: number; minute: number };
export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, hour: 18, minute: 0 };
export const REMINDER_DAYS_AHEAD = 7;
export const REMINDER_ID_PREFIX = 'exama-reminder-';

export function parseReminderSettings(raw: string | null): ReminderSettings {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<ReminderSettings>) : {};
    const hour = Number.isInteger(v.hour) && v.hour! >= 0 && v.hour! <= 23 ? v.hour! : DEFAULT_REMINDER.hour;
    const minute = Number.isInteger(v.minute) && v.minute! >= 0 && v.minute! <= 59 ? v.minute! : DEFAULT_REMINDER.minute;
    return { enabled: v.enabled === true, hour, minute };
  } catch {
    return DEFAULT_REMINDER;
  }
}

/** Moves the reminder time by `deltaMinutes`, wrapping around midnight (30-minute steps in the UI). */
export function shiftTime(s: Pick<ReminderSettings, 'hour' | 'minute'>, deltaMinutes: number) {
  const total = (((s.hour * 60 + s.minute + deltaMinutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

export type ReminderCourse = {
  documentId: string;
  title: string;
  plan: Pick<StudyPlan, 'examDate' | 'tasks'> | null;
  /** An exam or practice set started but not submitted. */
  hasUnfinished: boolean;
  /** Weak topics the student can practise (Student/Pro/trial analysis). */
  hasWeakTopics: boolean;
};

export type ReminderKind = 'plan' | 'exam_soon' | 'practice';
export type ReminderText = (kind: ReminderKind, v: { course: string; topic: string; minutes: number; more: number; days: number }) => { title: string; body: string };

export type ScheduledReminder = {
  id: string;
  /** Local date (YYYY-MM-DD) and time it fires. */
  date: string;
  at: Date;
  title: string;
  body: string;
  data: { url: string; kind: ReminderKind };
};

export function buildReminders(input: { settings: ReminderSettings; courses: ReminderCourse[]; now: Date; text: ReminderText; days?: number }): ScheduledReminder[] {
  const { settings, courses, now, text } = input;
  if (!settings.enabled) return [];
  const today = todayIso(now);
  const at = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y!, m! - 1, d!, settings.hour, settings.minute, 0, 0); // device local time
  };
  // The first slot is today if the chosen time hasn't passed yet, else tomorrow.
  const first = at(today).getTime() > now.getTime() ? today : addDaysIso(today, 1);
  const out: ScheduledReminder[] = [];

  for (let i = 0; i < (input.days ?? REMINDER_DAYS_AHEAD); i++) {
    const date = addDaysIso(first, i);
    const due = courses
      .map((c) => ({ c, tasks: (c.plan?.tasks ?? []).filter((t) => t.date === date && t.status === 'pending') }))
      .filter((x) => x.tasks.length > 0 && x.c.plan && diffDaysIso(date, x.c.plan.examDate) >= 0);
    if (!due.length) continue;
    // The course with the nearest exam first.
    due.sort((a, b) => diffDaysIso(date, a.c.plan!.examDate) - diffDaysIso(date, b.c.plan!.examDate));
    const { c, tasks } = due[0]!;
    const days = diffDaysIso(date, c.plan!.examDate);
    const kind: ReminderKind = days <= 3 ? 'exam_soon' : 'plan';
    const minutes = due.reduce((sum, x) => sum + x.tasks.reduce((s, t) => s + t.minutes, 0), 0);
    const more = due.reduce((n, x) => n + x.tasks.length, 0) - 1;
    const { title, body } = text(kind, { course: c.title, topic: tasks[0]!.topic ?? c.title, minutes, more, days });
    out.push({ id: `${REMINDER_ID_PREFIX}${date}`, date, at: at(date), title, body, data: { url: `/plan/${c.documentId}`, kind } });
  }

  // No plan tasks ahead at all: one gentle nudge, only if there is something ready to do.
  if (!out.length) {
    const c = courses.find((x) => x.hasUnfinished) ?? courses.find((x) => x.hasWeakTopics);
    if (c) {
      const { title, body } = text('practice', { course: c.title, topic: c.title, minutes: 0, more: 0, days: 0 });
      out.push({ id: `${REMINDER_ID_PREFIX}${first}`, date: first, at: at(first), title, body, data: { url: `/documents/${c.documentId}`, kind: 'practice' } });
    }
  }
  return out;
}
