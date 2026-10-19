/**
 * Account deletion (App Store guideline 5.1.1(v)): removes the account and everything it owns.
 *
 * - personal documents (→ document_chunks, materials, exams, questions, answers, plan) and personal usage_ledger
 *   rows are deleted first; the users row then cascades to topic_mastery, subscriptions, course_creations, …
 * - organization data is never touched: organization courses, materials, bank items and usage only lose the
 *   link to the person (user_id → null); their files live under `org/<id>/`, not under the user folder.
 * - analytics_events keep their anonymous counts but lose the link to the person
 *   (user_id set to null; the random per-install id is also cleared for their events).
 * - uploaded PDFs and lecture recordings: running processing jobs are stopped first, then the user's
 *   whole storage folder is removed after the database commit.
 * - sessions: requireAuth rejects tokens of accounts that no longer exist.
 * - the email address can't sign up again for exactly 30 days: only a keyed hash of it is kept, until
 *   then (services/email-hold.ts), written as the last step of the deletion transaction.
 *
 * Store subscriptions (Apple, Google Play) are NOT cancelled by deleting the account — the store bills the
 * user's store account. The app tells the user to cancel there first; the response says whether one was active.
 * Web subscriptions (Stripe) ARE cancelled by us, first: if Stripe cannot cancel, nothing is deleted.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { track } from '../analytics/index.js';
import { verifyPassword } from '../auth/auth.js';
import { getEntitlement } from '../billing/entitlements.js';
import { stripeBilling } from '../billing/index.js';
import { cancelStripeBillingForAccountDeletion } from '../billing/stripe-service.js';
import { db } from '../db/client.js';
import type { DeleteAccountResult } from '@study/shared';
import { adminAuditLog, analyticsEvents, documents, usageLedger, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { storage } from '../storage/index.js';
import { holdDeletedEmail } from './email-hold.js';
import { cancelUserMaterialJobs } from './materials/index.js';

export async function deleteAccount(userId: string, password: string): Promise<DeleteAccountResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(403, 'Incorrect password', 'password_incorrect');
  }

  const e = await getEntitlement(userId);
  const hadActiveSubscription = e.provider !== null && (e.status === 'active' || e.status === 'trialing' || e.status === 'cancelled');

  // A web (Stripe) subscription would keep billing a person without an account: cancel it before deleting anything.
  await cancelStripeBillingForAccountDeletion(stripeBilling, userId);

  await cancelUserMaterialJobs(userId);
  const holdEnds = await db.transaction(async (tx) => {
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
    // The owner's audit trail keeps the access record, but no longer points at the deleted account.
    await tx.update(adminAuditLog).set({ targetUserId: null }).where(eq(adminAuditLog.targetUserId, userId));
    // Personal courses and usage are deleted explicitly (their user_id is "set null" on delete, so that an
    // organization's courses survive a staff member's deletion; a personal row with no owner is refused by a
    // check constraint, so forgetting this step fails loudly instead of leaving orphans).
    await tx.delete(documents).where(and(eq(documents.userId, userId), isNull(documents.organizationId))); // cascades to materials, chunks, exams, plan
    await tx.delete(usageLedger).where(and(eq(usageLedger.userId, userId), isNull(usageLedger.organizationId)));
    await tx.delete(users).where(eq(users.id, userId)); // cascades to the remaining user-owned rows; organization rows keep their data
    return holdDeletedEmail(tx, user.email);
  });

  // Files last: if this fails the account is already gone; log loudly so ops can clean up.
  try {
    await storage.deletePrefix(`${userId}/`);
  } catch (err) {
    console.error(`[account] could not delete stored files for a deleted account (${userId}):`, err);
  }

  void track('account_deleted', null, { had_active_subscription: hadActiveSubscription });
  return { hadActiveSubscription, emailReusableAt: holdEnds.toISOString() };
}
