/**
 * Deleted-email restriction: after an account is deleted, its email address can't be used to sign up
 * again for exactly DELETED_EMAIL_HOLD_DAYS (30) days, counted from the moment of the deletion. This
 * stops the delete-and-re-register loop (a new free trial, fresh allowances) while keeping almost
 * nothing about the deleted account:
 *
 * - stored: an HMAC-SHA256, keyed with the server secret (JWT_SECRET), of the normalized address, and
 *   the exact time the restriction ends. No address, name, user id, IP or reason. The address can't be
 *   read back from the hash, and without the secret it can't even be checked against a guess.
 * - normalized with `normalizeEmail`, the same rule as sign-up and sign-in (lower case only): distinct
 *   addresses stay distinct — dots and "+tags" are not merged.
 * - expired records are ignored immediately and deleted by a purge every 6 hours (and on start-up).
 * - the record is written inside the transaction that deletes the account, as its last step: if the
 *   deletion fails or is refused, no record exists.
 * - sign-up answers 409 `signup_email_unavailable` with a generic message: it doesn't say that the address
 *   had an account, nor when it can be used again.
 * - support can lift a restriction early: `npm run account:release-email -w @study/api -- someone@example.com`.
 *
 * Changing JWT_SECRET makes existing records stop matching (they still expire on schedule).
 *
 * Holds are per account type (student and organization accounts are separate identities): deleting a student
 * account never blocks an organization sign-up with the same address, and the reverse. Student holds keep the
 * original hash input, so records written before the split still match.
 */
import { createHmac } from 'node:crypto';
import { DELETED_EMAIL_HOLD_DAYS, normalizeEmail, type AccountType } from '@study/shared';
import { and, eq, gt, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { deletedEmailHolds } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export const HOLD_MS = DELETED_EMAIL_HOLD_DAYS * 86_400_000;
type Db = Pick<typeof db, 'insert' | 'select' | 'delete'>;

export const emailHoldHash = (email: string, accountType: AccountType = 'student') =>
  createHmac('sha256', config.JWT_SECRET)
    .update(accountType === 'student' ? `deleted-email-hold:${normalizeEmail(email)}` : `deleted-email-hold:${accountType}:${normalizeEmail(email)}`)
    .digest('hex');

/** Called inside the account-deletion transaction. Returns when the restriction ends (deletion + 30 days). */
export async function holdDeletedEmail(tx: Db, email: string, now = new Date(), accountType: AccountType = 'student'): Promise<Date> {
  const expiresAt = new Date(now.getTime() + HOLD_MS);
  await tx
    .insert(deletedEmailHolds)
    .values({ emailHash: emailHoldHash(email, accountType), expiresAt })
    .onConflictDoUpdate({ target: deletedEmailHolds.emailHash, set: { expiresAt } });
  return expiresAt;
}

/** Sign-up check: 409 signup_email_unavailable while a restriction is active — deliberately without details. */
export async function assertEmailNotHeld(email: string, accountType: AccountType = 'student', now = new Date()): Promise<void> {
  const [hold] = await db
    .select({ expiresAt: deletedEmailHolds.expiresAt })
    .from(deletedEmailHolds)
    .where(and(eq(deletedEmailHolds.emailHash, emailHoldHash(email, accountType)), gt(deletedEmailHolds.expiresAt, now)));
  if (hold) throw new HttpError(409, 'This email address can’t be used to create an account right now. Use a different email address, or contact support.', 'signup_email_unavailable');
}

/** Support: lift an active restriction early (e.g. an account deleted by mistake). Returns whether one existed. */
export async function releaseEmailHold(email: string, now = new Date(), accountType: AccountType = 'student'): Promise<boolean> {
  const rows = await db
    .delete(deletedEmailHolds)
    .where(and(eq(deletedEmailHolds.emailHash, emailHoldHash(email, accountType)), gt(deletedEmailHolds.expiresAt, now)))
    .returning({ h: deletedEmailHolds.emailHash });
  return rows.length > 0;
}

/** Deletes expired records. Returns how many were removed. */
export async function purgeExpiredEmailHolds(now = new Date()): Promise<number> {
  const rows = await db.delete(deletedEmailHolds).where(lte(deletedEmailHolds.expiresAt, now)).returning({ h: deletedEmailHolds.emailHash });
  return rows.length;
}

export function startEmailHoldMaintenance() {
  const run = () => purgeExpiredEmailHolds().catch((err) => console.error('[account] purging expired email holds failed', err));
  void run();
  setInterval(run, 6 * 3600_000).unref();
}
