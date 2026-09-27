/**
 * Account deletion (App Store guideline 5.1.1(v)): removes the account and everything it owns.
 *
 * - users row → cascades to documents, document_chunks, exams, questions, answers,
 *   topic_mastery, subscriptions and usage_ledger (all `on delete cascade`).
 * - analytics_events keep their anonymous counts but lose the link to the person
 *   (user_id set to null; the random per-install id is also cleared for their events).
 * - uploaded PDFs and lecture recordings: running processing jobs are stopped first, then the user's
 *   whole storage folder is removed after the database commit.
 * - sessions: requireAuth rejects tokens of accounts that no longer exist.
 *
 * Store subscriptions (Apple) are NOT cancelled by deleting the account — Apple bills the Apple ID.
 * The app tells the user to cancel in Settings first; the response says whether one was active.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { track } from '../analytics/index.js';
import { verifyPassword } from '../auth/auth.js';
import { getEntitlement } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { analyticsEvents, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { storage } from '../storage/index.js';
import { cancelUserMaterialJobs } from './materials/index.js';

export async function deleteAccount(userId: string, password: string): Promise<{ hadActiveSubscription: boolean }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(403, 'Incorrect password', 'password_incorrect');
  }

  const e = await getEntitlement(userId);
  const hadActiveSubscription = e.provider !== null && (e.status === 'active' || e.status === 'trialing' || e.status === 'cancelled');

  await cancelUserMaterialJobs(userId);
  await db.transaction(async (tx) => {
    // Anonymize analytics: drop the user link and the install id that could re-link it.
    const anonIds = await tx
      .selectDistinct({ id: analyticsEvents.anonymousId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.userId, userId));
    await tx.update(analyticsEvents).set({ userId: null, anonymousId: null }).where(eq(analyticsEvents.userId, userId));
    const ids = anonIds.map((r) => r.id).filter((x): x is string => !!x);
    // …and from that install's signed-out events (other accounts' events are left alone).
    if (ids.length) {
      await tx
        .update(analyticsEvents)
        .set({ anonymousId: null })
        .where(and(inArray(analyticsEvents.anonymousId, ids), isNull(analyticsEvents.userId)));
    }
    await tx.delete(users).where(eq(users.id, userId)); // cascades to all user-owned rows
  });

  // Files last: if this fails the account is already gone; log loudly so ops can clean up.
  try {
    await storage.deletePrefix(`${userId}/`);
  } catch (err) {
    console.error(`[account] could not delete stored files for a deleted account (${userId}):`, err);
  }

  void track('account_deleted', null, { had_active_subscription: hadActiveSubscription });
  return { hadActiveSubscription };
}
