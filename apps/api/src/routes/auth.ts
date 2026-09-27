import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteAccountSchema, loginSchema, registerSchema, type AuthResponse, type User } from '@study/shared';
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthEnv } from '../auth/auth.js';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { deleteAccount } from '../services/account.js';

const toUser = (u: typeof users.$inferSelect): User => ({ id: u.id, email: u.email, name: u.name });

export const authRoutes = new Hono<AuthEnv>()
  .post('/register', async (c) => {
    const input = parseBody(registerSchema, await c.req.json());
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    const [user] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) })
      .returning();
    void track('signup_completed', user.id, {});
    return c.json<AuthResponse>({ token: await signToken(user.id), user: toUser(user) }, 201);
  })
  .post('/login', async (c) => {
    const input = parseBody(loginSchema, await c.req.json());
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Incorrect email or password', 'invalid_credentials');
    }
    void track('login_completed', user.id, {});
    return c.json<AuthResponse>({ token: await signToken(user.id), user: toUser(user) });
  })
  .get('/me', requireAuth, async (c) => {
    const [user] = await db.select().from(users).where(eq(users.id, c.var.userId));
    if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
    return c.json<User>(toUser(user));
  })
  // Permanently deletes the account and all its data. Requires the current password.
  .delete('/me', requireAuth, async (c) => {
    const { password } = parseBody(deleteAccountSchema, await c.req.json().catch(() => ({})));
    return c.json(await deleteAccount(c.var.userId, password));
  });
