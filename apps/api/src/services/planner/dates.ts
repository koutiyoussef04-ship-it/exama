/**
 * Calendar-date helpers for the planner. Dates are "YYYY-MM-DD" strings in the student's own
 * calendar; arithmetic is done on UTC midnights so daylight-saving changes never shift a day.
 */

const toUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY);

/** Whole days from `from` to `to` (positive when `to` is later). */
export const diffDays = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => new Date(toUtc(date)).getUTCDay();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The student's local calendar date at `now` in time zone `tz` (falls back to UTC for unknown zones). */
export function localDate(now: Date, tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
