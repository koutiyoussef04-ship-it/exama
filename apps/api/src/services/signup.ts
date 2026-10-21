/**
 * Sign-up with a confirmed email (SIGNUP_EMAIL_VERIFICATION, on by default and always in production).
 *
 *   register        → validates, refuses an address that already has an account (409 email_taken) or is held after a
 *                     deletion, stores a PENDING sign-up (password hashed, details, a single-use token — only its HMAC)
 *                     and emails the link <web app>/verify-email#token=…. No account, organization or session exists yet:
 *                     the answer is 202 { status: 'verification_pending' }.
 *   open the link   → the pending row is claimed once (a second use answers "already used"), and the account is created
 *                     from it in one transaction — user (email already verified), onboarding row, organization + admin
 *                     membership, marketing consent — exactly as an immediate sign-up used to. The link signs the person in.
 *   sign in early   → 403 signup_pending (only when the password matches a pending sign-up), so the app can say "check your email".
 *   new link        → the signed-out "send me a new link" (POST /auth/email-verification/request) also covers pending sign-ups:
 *                     the newest one gets a fresh token (the old link stops working) — same answer for every address.
 *
 * Each registration attempt is its own row with its own token, so a sign-up started by someone else for your address never
 * changes yours, and opening a link creates exactly the account that link was sent for; after that, every other pending row
 * for the address is removed. Limits: per client IP (registrations), per address (60 s between emails, 5 an hour), and the
 * unique email constraint on users settles races. Pending rows expire after 24 hours and are deleted a week later.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { EMAIL_VERIFICATION_RESEND_SECONDS, EMAIL_VERIFICATION_TTL_HOURS, SIGNUP_EMAILS_PER_HOUR, type Language, type MarketingConsentInput, type SignupPending, type User, type VerifyEmailResult } from '@study/shared';
import { track } from '../analytics/index.js';
import { hashPassword, signToken, verifyPassword } from '../auth/auth.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { pendingSignups, userOnboarding, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { assertEmailNotHeld } from './email-hold.js';
import { verificationAvailable, verificationEmail, verifyLimiter } from './email-verification.js';
import { grantMarketingConsent } from './marketing-consent.js';
import { createOrganization } from './organizations.js';

const TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 3_600_000;
const COOLDOWN_MS = EMAIL_VERIFICATION_RESEND_SECONDS * 1000;
const PURGE_AFTER_MS = 7 * 86_400_000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const TOO_MANY = 'Too many attempts. Please wait a little and try again.';

/** Per client IP: registrations (each one may send an email). */
export const registerLimiter = new RateLimiter(10, 60 * 60_000, TOO_MANY);
/** Per address: sign-up emails (registrations + new links). */
const signupEmailLimiter = new RateLimiter(SIGNUP_EMAILS_PER_HOUR, 60 * 60_000, TOO_MANY);
export function resetSignupRateLimits() {
  registerLimiter.reset();
  signupEmailLimiter.reset();
}

const hashToken = (token: string) => createHmac('sha256', config.JWT_SECRET).update(`signup:${token}`).digest('hex');

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type UserRow = typeof users.$inferSelect;
export const toUser = (u: UserRow, organizations: User['organizations'] = []): User => ({ id: u.id, email: u.email, name: u.name, accountType: u.accountType, organizations });

/** What an account is created from (a validated registration, now or when its link is opened). */
export type AccountDetails = {
  email: string;
  passwordHash: string;
  name: string;
  accountType: 'student' | 'organization';
  ageRange: UserRow['ageRange'];
  organizationName?: string | null;
  market?: 'training_provider' | 'academy' | null;
  marketingConsent?: MarketingConsentInput | null;
};

/**
 * Creates the account with everything that belongs to it, in the caller's transaction: the onboarding row (organization
 * staff skip the student questionnaire), the organization and its first admin membership, and marketing consent (students,
 * only when explicitly given). `verifiedAt`: set when the email was already confirmed (sign-up link).
 */
export async function createAccount(tx: Tx, d: AccountDetails, verifiedAt: Date | null): Promise<{ user: UserRow; organizations: User['organizations'] }> {
  const [created] = await tx
    .insert(users)
    .values({ email: d.email, name: d.name, passwordHash: d.passwordHash, emailVerificationRequired: true, emailVerifiedAt: verifiedAt, ageRange: d.ageRange ?? null, accountType: d.accountType })
    .returning();
  if (d.accountType === 'organization') {
    await tx.insert(userOnboarding).values({ userId: created.id, status: 'skipped', finishedAt: new Date() }).onConflictDoNothing();
    const org = await createOrganization(tx, created.id, { name: d.organizationName!, market: d.market! });
    return { user: created, organizations: [{ id: org.id, name: org.name, market: org.market, role: 'admin' as const }] };
  }
  await tx.insert(userOnboarding).values({ userId: created.id }).onConflictDoNothing();
  if (d.marketingConsent) await grantMarketingConsent(created.id, d.marketingConsent, 'signup', tx);
  return { user: created, organizations: [] };
}

const lock = (tx: Tx, email: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup:${email}`}))`);

/** Removes pending sign-ups that expired more than a week ago (cheap; runs with every registration). */
const purgeOld = (now: number) => db.delete(pendingSignups).where(lt(pendingSignups.expiresAt, new Date(now - PURGE_AFTER_MS)));

/**
 * Registration: stores the pending sign-up and emails its link. Throws 409 email_taken (an account exists), 409
 * signup_email_unavailable (held after a deletion), 429 (per IP, or a link was sent to this address less than a minute ago,
 * or 5 this hour), 503 when email can't be sent (nothing is kept then).
 */
export async function startSignup(d: Omit<AccountDetails, 'passwordHash'> & { password: string; language: Language }, clientKey: string, now = Date.now()): Promise<SignupPending> {
  registerLimiter.take(clientKey);
  if (!verificationAvailable()) throw new HttpError(503, 'Sign-up is unavailable right now: we can’t send email. Please try again later.', 'email_unavailable');
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email));
  if (existing) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
  await assertEmailNotHeld(d.email);
  void purgeOld(now).catch(() => {});

  const passwordHash = await hashPassword(d.password);
  const token = randomBytes(32).toString('base64url');
  const row = await db.transaction(async (tx) => {
    await lock(tx, d.email);
    const [last] = await tx.select({ lastSentAt: pendingSignups.lastSentAt }).from(pendingSignups).where(eq(pendingSignups.email, d.email)).orderBy(desc(pendingSignups.lastSentAt)).limit(1);
    const wait = last ? last.lastSentAt.getTime() + COOLDOWN_MS - now : 0;
    if (wait > 0) throw new HttpError(429, 'We just sent a link to this address. Please check your inbox or wait a minute.', 'too_many_requests', { retryAfterSeconds: Math.ceil(wait / 1000) });
    if (!signupEmailLimiter.tryTake(d.email, now)) throw new HttpError(429, TOO_MANY, 'too_many_requests');
    const [created] = await tx
      .insert(pendingSignups)
      .values({
        email: d.email,
        passwordHash,
        name: d.name,
        accountType: d.accountType,
        ageRange: d.ageRange ?? null,
        organizationName: d.accountType === 'organization' ? (d.organizationName ?? null) : null,
        market: d.accountType === 'organization' ? (d.market ?? null) : null,
        marketingConsent: d.accountType === 'student' ? (d.marketingConsent ?? null) : null,
        language: d.language,
        tokenHash: hashToken(token),
        expiresAt: new Date(now + TTL_MS),
        lastSentAt: new Date(now),
        createdAt: new Date(now),
      })
      .returning({ id: pendingSignups.id });
    return created;
  });
  try {
    await sendMail(verificationEmail(d.email, token, d.language));
  } catch (err) {
    console.error('[signup] verification email failed:', err instanceof Error ? err.message : 'unknown error');
    await db.delete(pendingSignups).where(eq(pendingSignups.id, row.id));
    throw new HttpError(503, 'We couldn’t send the confirmation email. Please try again in a moment.', 'email_send_failed');
  }
  return { status: 'verification_pending', email: d.email, retryAfterSeconds: EMAIL_VERIFICATION_RESEND_SECONDS };
}

/**
 * The link of a pending sign-up → the account, signed in. Returns null when the token is not a sign-up token (the caller then
 * checks account verification links). Counts against the per-IP link limit.
 */
export async function completeSignup(token: string, clientKey: string, now = Date.now()): Promise<VerifyEmailResult | null> {
  verifyLimiter.take(clientKey);
  if (!TOKEN_FORMAT.test(token)) return null;
  const [row] = await db.select().from(pendingSignups).where(eq(pendingSignups.tokenHash, hashToken(token)));
  if (!row) return null;
  const used = () => new HttpError(409, 'This link has already been used.', 'verification_link_used', { emailVerified: true });
  if (row.usedAt) throw used();
  if (row.expiresAt.getTime() <= now) throw new HttpError(410, 'This link has expired. Request a new one.', 'verification_link_expired');
  await assertEmailNotHeld(row.email);

  const at = new Date(now);
  const result = await db.transaction(async (tx) => {
    await lock(tx, row.email);
    const claimed = await tx
      .update(pendingSignups)
      .set({ usedAt: at })
      .where(and(eq(pendingSignups.id, row.id), isNull(pendingSignups.usedAt)))
      .returning({ id: pendingSignups.id });
    if (!claimed.length) throw used();
    // Another link for the same address was opened first: that account exists; sign in instead.
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, row.email));
    if (existing) throw used();
    const account = await createAccount(
      tx,
      { email: row.email, passwordHash: row.passwordHash, name: row.name, accountType: row.accountType, ageRange: row.ageRange, organizationName: row.organizationName, market: row.market, marketingConsent: row.marketingConsent as AccountDetails['marketingConsent'] },
      at,
    );
    // The address is taken now: every other pending sign-up for it is obsolete.
    await tx.delete(pendingSignups).where(and(eq(pendingSignups.email, row.email), isNull(pendingSignups.usedAt)));
    return account;
  });
  void track('signup_completed', result.user.id, { account_type: result.user.accountType });
  void track('email_verified', result.user.id, {});
  return { status: 'verified', auth: { token: await signToken(result.user.id), user: toUser(result.user, result.organizations) } };
}

/** Sign-in with the password of a sign-up that isn't confirmed yet → 403 signup_pending (otherwise nothing). */
export async function assertNoPendingSignup(email: string, password: string, now = Date.now()): Promise<void> {
  const rows = await db
    .select({ passwordHash: pendingSignups.passwordHash })
    .from(pendingSignups)
    .where(and(eq(pendingSignups.email, email), isNull(pendingSignups.usedAt), gt(pendingSignups.expiresAt, new Date(now - PURGE_AFTER_MS))))
    .orderBy(desc(pendingSignups.createdAt))
    .limit(3);
  for (const r of rows) {
    if (await verifyPassword(password, r.passwordHash)) {
      throw new HttpError(403, 'Confirm your email to finish creating your account: open the link we sent you.', 'signup_pending', { email });
    }
  }
}

/**
 * Signed-out "send me a new link" for an address without an account: the newest pending sign-up gets a fresh token and a
 * new email (60 s apart, 5 an hour per address). Silent in every other case (the caller answers the same for any address).
 */
export async function resendPendingSignup(email: string, language: Language, now = Date.now()): Promise<void> {
  if (!verificationAvailable()) return;
  const token = randomBytes(32).toString('base64url');
  const target = await db.transaction(async (tx) => {
    await lock(tx, email);
    const [row] = await tx
      .select({ id: pendingSignups.id, lastSentAt: pendingSignups.lastSentAt, language: pendingSignups.language })
      .from(pendingSignups)
      .where(and(eq(pendingSignups.email, email), isNull(pendingSignups.usedAt), gt(pendingSignups.expiresAt, new Date(now - PURGE_AFTER_MS))))
      .orderBy(desc(pendingSignups.createdAt))
      .limit(1);
    if (!row || row.lastSentAt.getTime() + COOLDOWN_MS > now) return null;
    if (!signupEmailLimiter.tryTake(email, now)) return null;
    await tx.update(pendingSignups).set({ tokenHash: hashToken(token), expiresAt: new Date(now + TTL_MS), lastSentAt: new Date(now) }).where(eq(pendingSignups.id, row.id));
    return row;
  });
  if (!target) return;
  await sendMail(verificationEmail(email, token, language ?? target.language)).catch((err) =>
    console.error('[signup] verification email failed:', err instanceof Error ? err.message : 'unknown error'),
  );
}
