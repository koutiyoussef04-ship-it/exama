/**
 * Daily study reminders — the pure part, unit-tested in test/reminders.test.ts.
 *
 * Reminders are now emails sent by the server each morning (apps/api/src/services/study-reminders.ts),
 * so they work on the web, iOS and Android alike. The app only shows and changes the preference, and
 * handles the unsubscribe link. The old on-device notifications are cancelled once (lib/reminders.ts).
 */
import type { EmailPreferences } from '@study/shared';

/** Identifier prefix of the local notifications older app versions scheduled (cancelled on launch). */
export const LEGACY_REMINDER_ID_PREFIX = 'exama-reminder-';

/**
 * What the Account card / plan offer shows:
 *   hidden   the server doesn't send them, or this account wouldn't get them (subscription or trial)
 *   verify   the email address isn't confirmed yet (they only go to confirmed addresses)
 *   on/off   the switch
 */
export type ReminderState = 'hidden' | 'verify' | 'on' | 'off';
export function reminderState(p: EmailPreferences | undefined): ReminderState {
  if (!p || !p.available || !p.sentToThisAccount) return 'hidden';
  if (!p.emailVerified) return 'verify';
  return p.studyReminders ? 'on' : 'off';
}

/** The plan screen offers reminders only when they are off or need a confirmed email. */
export const showReminderOffer = (s: ReminderState) => s === 'off' || s === 'verify';

/** `<user id>.<signature>` from the unsubscribe link. */
const TOKEN = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/i;

/**
 * The token from `/unsubscribe#token=…` (or a `token` route parameter). null when there is none,
 * '' when it can't be a real link (shown as invalid without asking the server).
 */
export function unsubscribeToken(hash: string | null | undefined, param?: string | string[] | null): string | null {
  const fromHash = hash ? new URLSearchParams(hash.replace(/^#/, '')).get('token') : null;
  const raw = fromHash ?? (Array.isArray(param) ? param[0] : param) ?? null;
  if (raw === null || raw === undefined) return null;
  const token = raw.trim();
  return TOKEN.test(token) ? token : '';
}
