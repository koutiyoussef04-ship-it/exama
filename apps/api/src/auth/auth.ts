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
import { HttpError } from '../lib/errors.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const TOKEN_TTL = '30d';

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/**
 * `pwc` = when the password last changed (ms, 0 = never). A reset changes it, so every session
 * issued before the reset stops working (see requireAuth).
 */
export async function signToken(userId: string, passwordChangedAt: Date | null = null): Promise<string> {
  return new SignJWT({ pwc: passwordChangedAt?.getTime() ?? 0 })
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

/** Like verifyToken, but also requires the account to still exist (deleted accounts → null). */
export async function verifyActiveUser(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  let userId: string | undefined;
  let pwc: unknown;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    userId = payload.sub;
    pwc = payload.pwc;
  } catch {
    return null;
  }
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await db.select({ id: users.id, passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, userId));
  return user && !issuedBeforePasswordChange(pwc, user.passwordChangedAt) ? userId : null;
}

export type AuthEnv = { Variables: { userId: string } };

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
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new Error('bad sub');
    userId = payload.sub;
    pwc = payload.pwc;
  } catch {
    throw new HttpError(401, 'Invalid or expired session', 'session_expired');
  }
  const [user] = await db.select({ id: users.id, passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  // The password was reset after this session started (e.g. someone else knew it): sign in again.
  if (issuedBeforePasswordChange(pwc, user.passwordChangedAt)) throw new HttpError(401, 'Your session has expired', 'session_expired');
  c.set('userId', userId);
  await next();
});
