/**
 * Explicit, optional consent to marketing email (tips, news, offers, invitations to come back). A different category from the
 * daily study-plan email (`users.study_reminder_emails`, its own switch) and from account emails (no consent needed).
 *
 * This file is the ONLY place that records or withdraws consent. The rules it enforces:
 *   - consent exists only because a person said yes: sign-up with the box ticked, or the switch turned on in Account. The caller
 *     passes an explicit, validated `{ version, language }` (shared `marketingConsentSchema`); nothing here is called on
 *     sign-in, sign-up retries, email verification, password reset, profile or preference updates that don't mention it;
 *   - the time is the database's `now()` and the source is chosen by the server, never read from a request;
 *   - granting is idempotent: an account that already has consent is left exactly as it was (no refreshed timestamp, no second
 *     history row), so a retry can't make a consent look newer or duplicate it;
 *   - withdrawing is idempotent too and always wins: it clears the consent in the same transaction that writes the history row;
 *   - every change is also written to `marketing_consent_log`, so a consent can be demonstrated and a withdrawal shown to
 *     have been honoured.
 * Email verification never grants it; the campaign requires it on top of verification (reactivation-campaign.ts).
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { MarketingConsentInput, MarketingConsentSource, UnsubscribeCategory } from '@study/shared';
import { db } from '../db/client.js';
import { marketingConsentLog, users } from '../db/schema.js';
import { oneClickUrl, unsubscribePageUrl, unsubscribeToken, verifyUnsubscribeToken } from './study-reminders.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction: sign-up records consent in the same transaction that creates the account. */
type Executor = typeof db | Tx;

/** Records consent. Returns true when it was newly recorded, false when the account already had a consent (nothing changes). */
export async function grantMarketingConsent(userId: string, consent: MarketingConsentInput, source: MarketingConsentSource, tx: Executor = db): Promise<boolean> {
  const changed = await tx
    .update(users)
    .set({ marketingConsentAt: sql`now()`, marketingConsentVersion: consent.version, marketingConsentLanguage: consent.language, marketingConsentSource: source })
    .where(and(eq(users.id, userId), isNull(users.marketingConsentAt)))
    .returning({ id: users.id });
  if (!changed.length) return false;
  await tx.insert(marketingConsentLog).values({ userId, action: 'granted', version: consent.version, language: consent.language, source });
  return true;
}

/** Withdraws consent. Returns true when there was a consent to withdraw. Never grants anything. */
export async function withdrawMarketingConsent(userId: string, via: MarketingConsentSource | 'unsubscribe_link'): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ version: users.marketingConsentVersion, language: users.marketingConsentLanguage })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.marketingConsentAt)))
      .for('update');
    if (!current) return false;
    await tx.update(users).set({ marketingConsentAt: null, marketingConsentVersion: null, marketingConsentLanguage: null, marketingConsentSource: null }).where(eq(users.id, userId));
    await tx.insert(marketingConsentLog).values({ userId, action: 'withdrawn', version: current.version, language: current.language, source: via });
    return true;
  });
}

export async function hasMarketingConsent(userId: string): Promise<boolean> {
  const [u] = await db.select({ at: users.marketingConsentAt }).from(users).where(eq(users.id, userId));
  return !!u?.at;
}

/**
 * The signed link in an email stops what its `category` says: `marketing` withdraws the consent only; `study_reminders` (what a
 * link without a category means — every daily study-plan email already sent) switches the daily plan email off only; `all` does both.
 * Unknown or deleted accounts: nothing to do. Returns false for a link that isn't valid.
 */
export async function unsubscribeByCategory(token: string, category: UnsubscribeCategory = 'study_reminders'): Promise<boolean> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;
  if (category === 'study_reminders' || category === 'all') await db.update(users).set({ studyReminderEmails: false }).where(eq(users.id, userId));
  if (category === 'marketing' || category === 'all') await withdrawMarketingConsent(userId, 'unsubscribe_link');
  return true;
}

/**
 * The unsubscribe links every MARKETING email must carry (page and RFC 8058 one-click). A marketing email that built its own
 * links, or reused the study-reminder ones, would stop the wrong category: use this and nothing else.
 */
export function marketingUnsubscribeLinks(userId: string): { pageUrl: string; oneClickUrl: string | null } {
  const token = unsubscribeToken(userId);
  return { pageUrl: unsubscribePageUrl(token, 'marketing'), oneClickUrl: oneClickUrl(token, 'marketing') };
}
