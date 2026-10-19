import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  deleteAccountSchema,
  MINIMUM_SIGNUP_AGE,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  requestVerificationSchema,
  resendVerificationSchema,
  verifyEmailSchema,
  type AuthResponse,
  type EmailVerificationState,
  type ResendVerificationResult,
  type User,
  type VerifyEmailResult,
} from '@study/shared';
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthEnv } from '../auth/auth.js';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { userOnboarding, users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { deleteAccount } from '../services/account.js';
import { createOrganization, listMemberships } from '../services/organizations.js';
import { assertEmailNotHeld } from '../services/email-hold.js';
import { grantMarketingConsent } from '../services/marketing-consent.js';
import { getVerificationState, requestVerification, resendVerification, sendVerificationAfterSignup, verifyEmail } from '../services/email-verification.js';
import { confirmPasswordReset, requestPasswordReset } from '../services/password-reset.js';

/** Rate-limit key for unauthenticated requests: the client IP as seen by the proxy in front of us. */
const clientKey = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';

const toUser = (u: typeof users.$inferSelect, organizations: User['organizations'] = []): User => ({ id: u.id, email: u.email, name: u.name, accountType: u.accountType, organizations });

export const authRoutes = new Hono<AuthEnv>()
  .post('/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ageRange?: unknown } | null;
    // Minimum age (13), checked first: nothing is looked up, created, emailed, logged or tracked for an
    // under-13 answer, and the answer itself is not kept.
    if (body?.ageRange === 'under_13') {
      throw new HttpError(403, `You need to be at least ${MINIMUM_SIGNUP_AGE} to create an Exama account.`, 'age_requirement_not_met');
    }
    // Older app versions don't ask the age question: they can't create accounts until they update.
    if (body?.ageRange === undefined || body.ageRange === null || body.ageRange === '') {
      throw new HttpError(400, 'Please update Exama to create an account.', 'age_range_required');
    }
    const input = parseBody(registerSchema, body);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    // Deleted in the last 30 days (same normalized address): 409 signup_email_unavailable, without saying why.
    await assertEmailNotHeld(input.email);
    const passwordHash = await hashPassword(input.password);
    // The onboarding row is created with the account (same transaction): only new accounts are ever asked.
    // An organization sign-up also creates the organization and its first admin membership here, so an
    // organization account never exists without its organization (and vice versa).
    const { user, organizations } = await db.transaction(async (tx) => {
      // New accounts are asked to confirm their email (see services/email-verification.ts).
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash, emailVerificationRequired: true, ageRange: input.ageRange, accountType: input.accountType })
        .returning();
      if (input.accountType === 'organization') {
        // Staff never see the student questionnaire.
        await tx.insert(userOnboarding).values({ userId: created.id, status: 'skipped', finishedAt: new Date() }).onConflictDoNothing();
        const org = await createOrganization(tx, created.id, { name: input.organizationName!, market: input.market! });
        return { user: created, organizations: [{ id: org.id, name: org.name, market: org.market, role: 'admin' as const }] };
      }
      await tx.insert(userOnboarding).values({ userId: created.id }).onConflictDoNothing();
      // Marketing consent: only when the client sent an explicit, valid `{ version, language }` (the box was ticked). Omitted, null or false
      // records nothing. Same transaction as the account: no account without its consent, no consent without its account. The time and
      // source are the server's.
      if (input.marketingConsent) await grantMarketingConsent(created.id, input.marketingConsent, 'signup', tx);
      return { user: created, organizations: [] };
    });
    void track('signup_completed', user.id, { account_type: user.accountType });
    // In the background: sign-up never waits for, or fails because of, the email.
    void sendVerificationAfterSignup(user, input.language ?? 'en');
    return c.json<AuthResponse>({ token: await signToken(user.id), user: toUser(user, organizations) }, 201);
  })
  .post('/login', async (c) => {
    const input = parseBody(loginSchema, await c.req.json());
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials');
    }
    void track('login_completed', user.id, {});
    return c.json<AuthResponse>({ token: await signToken(user.id, user.passwordChangedAt), user: toUser(user, await listMemberships(user.id)) });
  })
  // Forgot password → a one-time code by email. Always 202: never reveals whether the email has an account.
  // `retryAfterSeconds`: how long until another code can be requested (15-minute cooldown per account).
  .post('/password-reset/request', async (c) => {
    const input = parseBody(passwordResetRequestSchema, await c.req.json().catch(() => ({})));
    const { retryAfterSeconds } = await requestPasswordReset(input.email, input.language ?? 'en', clientKey(c));
    return c.json({ ok: true, retryAfterSeconds }, 202);
  })
  // Code + new password → new password set, older sessions ended, signed in.
  .post('/password-reset/confirm', async (c) => {
    const input = parseBody(passwordResetConfirmSchema, await c.req.json().catch(() => ({})));
    return c.json<AuthResponse>(await confirmPasswordReset(input.email, input.code, input.password, clientKey(c)));
  })
  // ---- Email verification ----
  .get('/email-verification', requireAuth, async (c) => c.json<EmailVerificationState>(await getVerificationState(c.var.userId)))
  // The link's token → email confirmed. 400 invalid, 409 already used, 410 expired. No session needed
  // (the link may be opened on another device).
  .post('/email-verification/verify', async (c) => {
    const { token } = parseBody(verifyEmailSchema, await c.req.json().catch(() => ({})));
    return c.json<VerifyEmailResult>(await verifyEmail(token, clientKey(c)));
  })
  // Signed in: a new link (60 s cooldown, 5 an hour; 503 email_send_failed if it couldn't be sent).
  .post('/email-verification/resend', requireAuth, async (c) => {
    const { language } = parseBody(resendVerificationSchema, await c.req.json().catch(() => ({})));
    const result = await resendVerification(c.var.userId, language ?? 'en', clientKey(c));
    return c.json<ResendVerificationResult>(result, result.sent ? 202 : 200);
  })
  // Signed out: always 202 with the same body, whether or not the email has an account.
  .post('/email-verification/request', async (c) => {
    const input = parseBody(requestVerificationSchema, await c.req.json().catch(() => ({})));
    return c.json(await requestVerification(input.email, input.language ?? 'en', clientKey(c)), 202);
  })
  .get('/me', requireAuth, async (c) => {
    const [user] = await db.select().from(users).where(eq(users.id, c.var.userId));
    if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
    return c.json<User>(toUser(user, await listMemberships(user.id)));
  })
  // Permanently deletes the account and all its data. Requires the current password.
  .delete('/me', requireAuth, async (c) => {
    const { password } = parseBody(deleteAccountSchema, await c.req.json().catch(() => ({})));
    return c.json(await deleteAccount(c.var.userId, password));
  });
