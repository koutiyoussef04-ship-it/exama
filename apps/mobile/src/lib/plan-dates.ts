/**
 * Calendar helpers for the study planner — pure (no React Native), unit-tested in test/plan-dates.test.ts.
 * Dates are "YYYY-MM-DD" strings in the student's own calendar; formatting uses UTC so a date never
 * shifts by a day because of the device's time zone.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const DAY = 86_400_000;

export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`; // m: 1-12
export const addDaysIso = (iso: string, days: number) => new Date(toUtc(iso) + days * DAY).toISOString().slice(0, 10);
export const diffDaysIso = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (iso: string) => new Date(toUtc(iso)).getUTCDay();

/** The device's local date today. */
export function todayIso(now = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** IANA time zone of the device, e.g. "Europe/Madrid" (UTC if unknown). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Weeks of a month for a calendar grid: each week has 7 cells (ISO date or null for padding).
 * `weekStart`: 1 = Monday (default), 0 = Sunday, 6 = Saturday.
 */
export function monthGrid(year: number, month: number, weekStart = 1): (string | null)[][] {
  const first = isoDate(year, month, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => isoDate(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Weekday numbers (0-6) in display order starting at `weekStart`. */
export const weekOrder = (weekStart = 1) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

/** Short localized weekday names indexed by weekday number (0 = Sunday). */
export function weekdayNames(locale: string, style: 'narrow' | 'short' = 'short'): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
  // 2026-09-27 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 27 + i))));
}

export function formatIso(iso: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(toUtc(iso)));
}

export const monthTitle = (year: number, month: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));

/** Moves an "HH:MM" time by `minutes`, clamped to 06:00–22:00. */
export function stepTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(22 * 60, Math.max(6 * 60, h * 60 + m + minutes));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "HH:MM" in the user's locale (e.g. 9:30 AM / 09:30). */
export function formatTime(time: string, locale: string): string {
  const [h, m] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, h, m)));
}
