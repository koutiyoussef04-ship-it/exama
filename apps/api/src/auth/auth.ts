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

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({})
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

/** Like verifyToken, but also requires the account to still exist (deleted accounts → null). */
export async function verifyActiveUser(token: string | null | undefined): Promise<string | null> {
  const userId = await verifyToken(token);
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  return user ? userId : null;
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
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new Error('bad sub');
    userId = payload.sub;
  } catch {
    throw new HttpError(401, 'Invalid or expired session', 'session_expired');
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  c.set('userId', userId);
  await next();
});
