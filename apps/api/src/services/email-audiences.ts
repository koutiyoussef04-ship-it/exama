/**
 * Who can Exama email, by type of email? One read-only report over the three kinds of email an operator can trigger or
 * the server sends, so nobody has to add up three dry runs or guess how many people each rule leaves.
 *
 *   account email  — the one-off reminder to confirm the address (services/verification-reminders.ts). Not marketing.
 *   daily study    — the daily study-plan email the server already sends (services/study-reminders.ts): confirmed addresses only.
 *   reactivation   — the "come back" campaign (services/reactivation-campaign.ts). Marketing.
 *
 * It never sends, stores or changes anything. "Eligible" for the reactivation campaign means: passes the campaign's
 * technical rules. It does NOT mean cleared to receive marketing: Exama's legal register says marketing needs consent, no
 * consent is recorded anywhere, and the privacy policy does not disclose marketing (docs/legal/open-items.md §3,
 * docs/email/who-we-can-email.md). `legallyCleared` says so in the data, so no caller can mistake one for the other.
 */
import { sql as pg } from '../db/client.js';
import { selectAudience, type ExcludeReason } from './reactivation-campaign.js';
import { selectReminderAudience, type DeliveryHistory, type ReminderExclude } from './verification-reminders.js';
import type { MailServer } from './address-vetting.js';

export type EmailAudiences = {
  now: Date;
  accounts: { total: number; confirmed: number; unconfirmed: number; /** unconfirmed AND never asked at sign-up */ legacyUnconfirmed: number };
  /** The reminder to confirm: one per account, ever. Counts ignore the daytime send window (it only delays a send by hours). */
  accountReminder: {
    now: number;
    /** If still unconfirmed 24 h from now (accounts whose sign-up link will have expired by then). */
    within24h: number;
    /** The same two numbers if the operator also includes accounts that predate verification (`--include-legacy`). */
    withLegacyNow: number;
    withLegacyWithin24h: number;
    /** Why the rest are held out right now (without legacy included). */
    heldNow: Partial<Record<ReminderExclude, number>>;
  };
  /** The existing daily study-plan email: needs a confirmed address and the preference on; also a plan, a Free plan and the local hour. */
  dailyStudyEmail: { confirmedWithEmailsOn: number; ofWhichWithAPlan: number };
  reactivationMarketing: {
    /** Passes the campaign's technical rules (confirmed adult, Free, inactive, not recently emailed…). */
    passesTechnicalRules: number;
    excluded: Partial<Record<ExcludeReason, number>>;
    /** Always false today: no marketing consent is recorded and the privacy policy does not disclose marketing. */
    legallyCleared: false;
  };
};

export async function emailAudiences(opts: { now?: Date; history?: DeliveryHistory | null; mx?: (domain: string) => Promise<MailServer>; userIds?: string[] } = {}): Promise<EmailAudiences> {
  const now = opts.now ?? new Date();
  const only = opts.userIds ?? null;
  const common = { history: opts.history ?? null, mx: opts.mx, userIds: opts.userIds, anyTime: true };
  const tomorrow = new Date(now.getTime() + 24 * 3_600_000);

  const [counts] = await pg<{ total: number; confirmed: number; legacy: number }[]>`
    select count(*)::int as total, count(*) filter (where email_verified_at is not null)::int as confirmed,
      count(*) filter (where email_verified_at is null and not email_verification_required)::int as legacy
    from users where (${only}::uuid[] is null or id = any(${only}::uuid[]))`;
  const [study] = await pg<{ on: number; plan: number }[]>`
    select count(*) filter (where u.study_reminder_emails)::int as on,
      count(*) filter (where u.study_reminder_emails and exists (select 1 from study_plans p where p.user_id = u.id))::int as plan
    from users u where u.email_verified_at is not null and (${only}::uuid[] is null or u.id = any(${only}::uuid[]))`;

  const [now0, in24, legacy0, legacy24, marketing] = await Promise.all([
    selectReminderAudience({ ...common, now }),
    selectReminderAudience({ ...common, now: tomorrow }),
    selectReminderAudience({ ...common, now, includeLegacy: true }),
    selectReminderAudience({ ...common, now: tomorrow, includeLegacy: true }),
    selectAudience({ step: 1, now, userIds: opts.userIds, anyTime: true }),
  ]);
  return {
    now,
    accounts: { total: counts!.total, confirmed: counts!.confirmed, unconfirmed: counts!.total - counts!.confirmed, legacyUnconfirmed: counts!.legacy },
    accountReminder: { now: now0.eligible.length, within24h: in24.eligible.length, withLegacyNow: legacy0.eligible.length, withLegacyWithin24h: legacy24.eligible.length, heldNow: now0.excluded },
    dailyStudyEmail: { confirmedWithEmailsOn: study!.on, ofWhichWithAPlan: study!.plan },
    reactivationMarketing: { passesTechnicalRules: marketing.eligible.length, excluded: marketing.excluded, legallyCleared: false },
  };
}
