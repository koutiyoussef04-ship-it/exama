import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { unsubscribeCategorySchema, updateEmailPreferencesSchema, type EmailPreferences, type UnsubscribeCategory } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { config } from '../config.js';
import { recordClick } from '../services/reactivation-campaign.js';
import { grantMarketingConsent, unsubscribeByCategory, withdrawMarketingConsent } from '../services/marketing-consent.js';
import { billingEligibility, remindersAvailable, unsubscribePageUrl } from '../services/study-reminders.js';

const unsubscribeLimiter = new RateLimiter(30, 15 * 60_000, 'Too many attempts. Please wait a little and try again.');
const clientKey = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';

async function preferences(userId: string): Promise<EmailPreferences> {
  const [u] = await db.select({ on: users.studyReminderEmails, verifiedAt: users.emailVerifiedAt, marketingAt: users.marketingConsentAt }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  return {
    studyReminders: u.on,
    available: remindersAvailable().ok,
    emailVerified: !!u.verifiedAt,
    // Free and never paid (any subscription, trial or Stripe checkout record excludes the account for good).
    sentToThisAccount: (await billingEligibility(userId)).ok,
    // A separate category: true only after an explicit yes (sign-up box or the Account switch), false after withdrawing.
    marketing: !!u.marketingAt,
    marketingAvailable: config.EMAIL_PROVIDER !== 'disabled',
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
 *   GET /email/click/:sendId       the button of a re-engagement campaign email (services/reactivation-campaign.ts):
 *                                  counts the click (scanner-looking requests separately) and redirects to the web app.
 */
export const emailRoutes = new Hono<AuthEnv>()
  .get('/preferences', requireAuth, async (c) => c.json<EmailPreferences>(await preferences(c.var.userId)))
  .patch('/preferences', requireAuth, async (c) => {
    const { studyReminders, marketing } = parseBody(updateEmailPreferencesSchema, await c.req.json().catch(() => ({})));
    // Each category changes only when the request names it: a study-reminder update can never grant or withdraw marketing consent.
    if (studyReminders !== undefined) await db.update(users).set({ studyReminderEmails: studyReminders }).where(eq(users.id, c.var.userId));
    if (marketing?.consent === true) await grantMarketingConsent(c.var.userId, { version: marketing.version, language: marketing.language }, 'account');
    else if (marketing?.consent === false) await withdrawMarketingConsent(c.var.userId, 'account');
    return c.json<EmailPreferences>(await preferences(c.var.userId));
  })
  .get('/unsubscribe', (c) => {
    if (!config.WEB_APP_URL) throw new HttpError(404, 'Not found', 'not_found');
    const category = unsubscribeCategorySchema.safeParse(c.req.query('category'));
    return c.redirect(unsubscribePageUrl(encodeURIComponent(c.req.query('token') ?? ''), category.success ? category.data : undefined), 302);
  })
  .get('/click/:sendId', async (c) => {
    if (!config.WEB_APP_URL) throw new HttpError(404, 'Not found', 'not_found');
    const to = await recordClick(c.req.param('sendId'), { userAgent: c.req.header('user-agent'), ip: clientKey(c), countIt: c.req.method !== 'HEAD' });
    c.header('Cache-Control', 'no-store');
    return c.redirect(to, 302);
  })
  .post('/unsubscribe', async (c) => {
    unsubscribeLimiter.take(clientKey(c));
    let token = c.req.query('token') ?? null;
    let rawCategory: unknown = c.req.query('category');
    if (!token) {
      const type = c.req.header('content-type') ?? '';
      const body = type.includes('application/json') ? ((await c.req.json().catch(() => ({}))) as { token?: unknown; category?: unknown }) : ((await c.req.parseBody().catch(() => ({}))) as { token?: unknown; category?: unknown });
      token = typeof body.token === 'string' ? body.token : null;
      rawCategory ??= body.category;
    }
    // No category = the link in a daily study-plan email (study reminders only). A category that is not one of ours is not guessed at.
    let category: UnsubscribeCategory = 'study_reminders';
    if (rawCategory !== undefined && rawCategory !== null && rawCategory !== '') {
      const parsed = unsubscribeCategorySchema.safeParse(rawCategory);
      if (!parsed.success) throw new HttpError(400, 'This unsubscribe link isn’t valid.', 'unsubscribe_link_invalid');
      category = parsed.data;
    }
    if (!(await unsubscribeByCategory(token ?? '', category))) throw new HttpError(400, 'This unsubscribe link isn’t valid.', 'unsubscribe_link_invalid');
    return c.json({ ok: true });
  });

export const resetUnsubscribeRateLimit = () => unsubscribeLimiter.reset();
