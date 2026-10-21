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
  type SignupPending,
  type User,
  type VerifyEmailResult,
} from '@study/shared';
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthEnv } from '../auth/auth.js';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { config } from '../config.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { deleteAccount } from '../services/account.js';
import { findAccount } from '../services/accounts.js';
import { listMemberships } from '../services/organizations.js';
import { assertNoPendingSignup, completeSignup, createAccount, resendPendingSignup, startSignup, toUser } from '../services/signup.js';
import { assertEmailNotHeld } from '../services/email-hold.js';
import { getVerificationState, requestVerification, resendVerification, sendVerificationAfterSignup, verifyEmail } from '../services/email-verification.js';
import { confirmPasswordReset, requestPasswordReset } from '../services/password-reset.js';

/** Rate-limit key for unauthenticated requests: the client IP as seen by the proxy in front of us. */
const clientKey = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';


export const authRoutes = new Hono<AuthEnv>()
  .post('/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ageRange?: unknown; accountType?: unknown } | null;
    // Minimum age (13), checked first: nothing is looked up, created, emailed, logged or tracked for an
    // under-13 answer, and the answer itself is not kept.
    if (body?.ageRange === 'under_13') {
      throw new HttpError(403, `You need to be at least ${MINIMUM_SIGNUP_AGE} to create an Exama account.`, 'age_requirement_not_met');
    }
    // Students state an age group (older app versions don't ask: they can't create accounts until they update).
    // Organization (staff) sign-ups are not asked.
    const organization = body?.accountType === 'organization';
    if (!organization && (body?.ageRange === undefined || body.ageRange === null || body.ageRange === '')) {
      throw new HttpError(400, 'Please update Exama to create an account.', 'age_range_required');
    }
    const input = parseBody(registerSchema, body);
    const details = {
      email: input.email,
      name: input.name,
      accountType: input.accountType,
      ageRange: input.accountType === 'organization' ? null : (input.ageRange ?? null),
      organizationName: input.organizationName ?? null,
      market: input.market ?? null,
      marketingConsent: input.accountType === 'student' && input.marketingConsent ? input.marketingConsent : null,
    };
    // Default (and always in production): no account until the email is confirmed — see services/signup.ts.
    if (config.SIGNUP_EMAIL_VERIFICATION) {
      return c.json<SignupPending>(await startSignup({ ...details, password: input.password, language: input.language ?? 'en' }, clientKey(c)), 202);
    }
    // Development/tests only (SIGNUP_EMAIL_VERIFICATION=false): the account and a session at once, as before.
    // Taken = an account of the SAME type (a student account and an organization account with one email are separate).
    if (await findAccount(input.email, input.accountType)) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    // Deleted in the last 30 days (same normalized address and account type): 409 signup_email_unavailable, without saying why.
    await assertEmailNotHeld(input.email, input.accountType);
    const passwordHash = await hashPassword(input.password);
    const { user, organizations } = await db.transaction((tx) => createAccount(tx, { ...details, passwordHash }, null));
    void track('signup_completed', user.id, { account_type: user.accountType });
    // In the background: sign-up never waits for, or fails because of, the email.
    void sendVerificationAfterSignup(user, input.language ?? 'en');
    return c.json<AuthResponse>({ token: await signToken(user.id, null, user.accountType), user: toUser(user, organizations) }, 201);
  })
  // `accountType` (sent by the app's sign-in form) selects exactly that identity: the organization sign-in never
  // signs into the student account with the same email, and vice versa. Absent (older app versions): the student
  // account if the email has one, otherwise the organization account — as before the split.
  .post('/login', async (c) => {
    const input = parseBody(loginSchema, await c.req.json());
    const user = await findAccount(input.email, input.accountType);
    if (!user) {
      // A sign-up waiting for its email link (right password): say so instead of "incorrect password".
      await assertNoPendingSignup(input.email, input.password, input.accountType);
      throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials');
    }
    void track('login_completed', user.id, {});
    return c.json<AuthResponse>({ token: await signToken(user.id, user.passwordChangedAt, user.accountType), user: toUser(user, await listMemberships(user.id)) });
  })
  // Forgot password → a one-time code by email. Always 202: never reveals whether the email has an account.
  // `retryAfterSeconds`: how long until another code can be requested (15-minute cooldown per account).
  .post('/password-reset/request', async (c) => {
    const input = parseBody(passwordResetRequestSchema, await c.req.json().catch(() => ({})));
    const { retryAfterSeconds } = await requestPasswordReset(input.email, input.language ?? 'en', clientKey(c), Date.now(), input.accountType);
    return c.json({ ok: true, retryAfterSeconds }, 202);
  })
  // Code + new password → new password set, older sessions ended, signed in.
  .post('/password-reset/confirm', async (c) => {
    const input = parseBody(passwordResetConfirmSchema, await c.req.json().catch(() => ({})));
    return c.json<AuthResponse>(await confirmPasswordReset(input.email, input.code, input.password, clientKey(c), Date.now(), input.accountType));
  })
  // ---- Email verification ----
  .get('/email-verification', requireAuth, async (c) => c.json<EmailVerificationState>(await getVerificationState(c.var.userId)))
  // The link's token → email confirmed. 400 invalid, 409 already used, 410 expired. No session needed
  // (the link may be opened on another device).
  .post('/email-verification/verify', async (c) => {
    const { token } = parseBody(verifyEmailSchema, await c.req.json().catch(() => ({})));
    // A pending sign-up's link creates the account and signs in; otherwise it is an existing account's link.
    return c.json<VerifyEmailResult>((await completeSignup(token, clientKey(c))) ?? (await verifyEmail(token, null)));
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
    return c.json(await requestVerification(input.email, input.language ?? 'en', clientKey(c), Date.now(), resendPendingSignup, input.accountType), 202);
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
