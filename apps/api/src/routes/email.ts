import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { updateEmailPreferencesSchema, type EmailPreferences } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { getEntitlement } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { config } from '../config.js';
import { hasActiveSubscription, remindersAvailable, unsubscribePageUrl, unsubscribeWithToken } from '../services/study-reminders.js';

const unsubscribeLimiter = new RateLimiter(30, 15 * 60_000, 'Too many attempts. Please wait a little and try again.');
const clientKey = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';

async function preferences(userId: string): Promise<EmailPreferences> {
  const [u] = await db.select({ on: users.studyReminderEmails, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  return {
    studyReminders: u.on,
    available: remindersAvailable().ok,
    emailVerified: !!u.verifiedAt,
    sentToThisAccount: !hasActiveSubscription(await getEntitlement(userId)),
  };
}

/**
 * Email preferences and the unsubscribe link of the daily study-plan emails (services/study-reminders.ts).
 *   GET/PATCH /email/preferences   signed in: read / switch the daily reminder email
 *   POST /email/unsubscribe        no session: the signed token from the email turns it off. Works as RFC 8058
 *                                  one-click (`?token=…`, body "List-Unsubscribe=One-Click") and for the web
 *                                  page (JSON `{token}`). Always idempotent.
 *   GET /email/unsubscribe         a mail client or person that opens the one-click URL instead of POSTing it is
 *                                  sent to the web page, which asks for confirmation. A GET never unsubscribes
 *                                  (link scanners open links too).
 */
export const emailRoutes = new Hono<AuthEnv>()
  .get('/preferences', requireAuth, async (c) => c.json<EmailPreferences>(await preferences(c.var.userId)))
  .patch('/preferences', requireAuth, async (c) => {
    const { studyReminders } = parseBody(updateEmailPreferencesSchema, await c.req.json().catch(() => ({})));
    await db.update(users).set({ studyReminderEmails: studyReminders }).where(eq(users.id, c.var.userId));
    return c.json<EmailPreferences>(await preferences(c.var.userId));
  })
  .get('/unsubscribe', (c) => {
    if (!config.WEB_APP_URL) throw new HttpError(404, 'Not found', 'not_found');
    return c.redirect(unsubscribePageUrl(encodeURIComponent(c.req.query('token') ?? '')), 302);
  })
  .post('/unsubscribe', async (c) => {
    unsubscribeLimiter.take(clientKey(c));
    let token = c.req.query('token') ?? null;
    if (!token) {
      const type = c.req.header('content-type') ?? '';
      const body = type.includes('application/json') ? ((await c.req.json().catch(() => ({}))) as { token?: unknown }) : ((await c.req.parseBody().catch(() => ({}))) as { token?: unknown });
      token = typeof body.token === 'string' ? body.token : null;
    }
    if (!(await unsubscribeWithToken(token ?? ''))) throw new HttpError(400, 'This unsubscribe link isn’t valid.', 'unsubscribe_link_invalid');
    return c.json({ ok: true });
  });

export const resetUnsubscribeRateLimit = () => unsubscribeLimiter.reset();
