/**
 * Email/password auth with stateless JWTs.
 * Everything auth-specific lives in this file, so swapping to a hosted
 * provider (Clerk, Supabase Auth, Better Auth...) later only touches here + routes/auth.ts.
 */
import bcrypt from 'bcryptjs';
import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { AccountType } from '@study/shared';
import { HttpError } from '../lib/errors.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const TOKEN_TTL = '30d';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/**
 * `pwc` = when the password last changed (ms, 0 = never). A reset changes it, so every session
 * issued before the reset stops working (see requireAuth).
 * `act` = the account type the session belongs to (student / organization). Student and organization accounts
 * are separate identities (the same email can have one of each): requireAuth checks the claim against the
 * account, so a session can never be used as the other identity. Sessions issued before the claim existed
 * have none and stay valid (`sub` alone already names exactly one account).
 */
export async function signToken(userId: string, passwordChangedAt: Date | null = null, accountType?: AccountType): Promise<string> {
  return new SignJWT(accountType ? { pwc: passwordChangedAt?.getTime() ?? 0, act: accountType } : { pwc: passwordChangedAt?.getTime() ?? 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

/** Returns the user id for a valid token, or null. Never throws. */
export async function verifyToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** A token issued before the last password change (reset) is no longer valid. */
const issuedBeforePasswordChange = (pwc: unknown, changedAt: Date | null) => (typeof pwc === 'number' ? pwc : 0) !== (changedAt?.getTime() ?? 0);

/** A token naming an account type must belong to an account of that type (absent claim: older session, accepted). */
const wrongAccountType = (act: unknown, accountType: AccountType) => act !== undefined && act !== accountType;

/** Like verifyToken, but also requires the account to still exist (deleted accounts → null). */
export async function verifyActiveUser(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  let userId: string | undefined;
  let pwc: unknown;
  let act: unknown;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    userId = payload.sub;
    pwc = payload.pwc;
    act = payload.act;
  } catch {
    return null;
  }
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await db
    .select({ id: users.id, passwordChangedAt: users.passwordChangedAt, accountType: users.accountType })
    .from(users)
    .where(eq(users.id, userId));
  return user && !issuedBeforePasswordChange(pwc, user.passwordChangedAt) && !wrongAccountType(act, user.accountType) ? userId : null;
}

export type AuthEnv = { Variables: { userId: string; accountType: AccountType } };

/**
 * Requires `Authorization: Bearer <token>` and sets c.var.userId.
 * Also checks the account still exists, so tokens of a deleted account stop working immediately.
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Not authenticated', 'unauthenticated');
  let userId: string;
  let pwc: unknown;
  let act: unknown;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new Error('bad sub');
    userId = payload.sub;
    pwc = payload.pwc;
    act = payload.act;
  } catch {
    throw new HttpError(401, 'Invalid or expired session', 'session_expired');
  }
  const [user] = await db
    .select({ id: users.id, passwordChangedAt: users.passwordChangedAt, accountType: users.accountType })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  // The password was reset after this session started (e.g. someone else knew it): sign in again.
  if (issuedBeforePasswordChange(pwc, user.passwordChangedAt)) throw new HttpError(401, 'Your session has expired', 'session_expired');
  if (wrongAccountType(act, user.accountType)) throw new HttpError(401, 'Invalid or expired session', 'session_expired');
  c.set('userId', userId);
  c.set('accountType', user.accountType);
  await next();
});

/**
 * Requires `requireAuth` before it. Student features (documents, exams, flashcards, purchases) belong to student
 * accounts; organization accounts work inside /orgs. 403 `student_account_required` / `organization_account_required`.
 */
export const requireAccountType = (accountType: AccountType) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (c.var.accountType !== accountType) {
      throw accountType === 'student'
        ? new HttpError(403, 'This is available with a student account.', 'student_account_required')
        : new HttpError(403, 'This is available with an organization account.', 'organization_account_required');
    }
    await next();
  });

/**
 * App-level guard for the student areas (courses, exams, flashcards): a signed-in ORGANIZATION account gets 403
 * `student_account_required`. Anything else passes through to the routes, whose requireAuth answers 401 for a missing
 * or invalid session. The account type comes from the token's `act` claim (signed by us; an account's type never
 * changes) or, for older sessions without it, from the database.
 */
export const studentAreaOnly = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  let sub: string | undefined;
  let act: unknown;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    sub = payload.sub;
    act = payload.act;
  } catch {
    return next();
  }
  let accountType = act;
  if (accountType === undefined && sub && /^[0-9a-f-]{36}$/i.test(sub)) {
    const [row] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.id, sub));
    accountType = row?.accountType;
  }
  if (accountType === 'organization') throw new HttpError(403, 'This is available with a student account.', 'student_account_required');
  return next();
});

/**
 * Requires `requireAuth` before it. The B2B owner dashboard: an ORGANIZATION account whose b2b_role is
 * 'owner', read from the database on every request (never from the token or the client). Anyone else gets
 * 404, so the dashboard's existence is not revealed.
 */
export const requireB2BOwner = createMiddleware<AuthEnv>(async (c, next) => {
  const [row] = await db.select({ accountType: users.accountType, b2bRole: users.b2bRole }).from(users).where(eq(users.id, c.var.userId));
  if (!row || row.accountType !== 'organization' || row.b2bRole !== 'owner') throw new HttpError(404, 'Not found', 'not_found');
  await next();
});
