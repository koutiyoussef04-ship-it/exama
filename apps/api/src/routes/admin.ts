/**
 * GET /admin/* — the owner-only dashboard API. Read-only.
 *
 * Authorization is on the server, for every route: a valid session (requireAuth) AND an owner account
 * from server configuration (OWNER_USER_IDS / OWNER_EMAILS, the same check as owner access). Anyone else
 * gets 403 — including for /admin/access, which the app uses to decide whether to show the screen.
 * Every request (allowed or refused) is written to admin_audit_log.
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { isOwner } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { adminAuditLog } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { aiReport, analyticsReport, billingReport, customerDetail, customers, health, overview, parseCustomersQuery, resolveRange } from '../admin/service.js';

type AdminEnv = AuthEnv & { Variables: { auditTarget?: string } };

/**
 * Only these query keys are kept in the audit log, each cut to 100 characters (never tokens or bodies).
 * The search text can be a customer's email, so only its length is kept.
 */
const AUDITED_KEYS = ['range', 'from', 'to', 'interval', 'q', 'category', 'status', 'signupFrom', 'signupTo', 'activity', 'plan', 'sort', 'page', 'limit'];
const auditParams = (query: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(query)
      .filter(([k]) => AUDITED_KEYS.includes(k))
      .map(([k, v]) => [k, k === 'q' ? `[${String(v).length} chars]` : String(v).slice(0, 100)]),
  );

async function audit(entry: { actorUserId: string; action: string; targetUserId?: string; params: Record<string, string>; allowed: boolean; status: number }) {
  try {
    await db.insert(adminAuditLog).values(entry);
  } catch (err) {
    console.error('[admin] audit log write failed:', err instanceof Error ? err.message : err);
  }
}

const adminLimiter = new RateLimiter(300, 5 * 60_000, 'Too many requests. Please wait a moment.');

/** Owner check on the server for every admin route; refused attempts are audited. */
const requireOwner = createMiddleware<AdminEnv>(async (c, next) => {
  const action = `${c.req.method} ${c.req.routePath}`;
  const params = auditParams(c.req.query());
  if (!(await isOwner(c.var.userId))) {
    await audit({ actorUserId: c.var.userId, action, params, allowed: false, status: 403 });
    throw new HttpError(403, 'Not allowed', 'forbidden');
  }
  adminLimiter.take(c.var.userId);
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = err instanceof HttpError ? err.status : 500;
    throw err;
  } finally {
    await audit({ actorUserId: c.var.userId, action: `${c.req.method} ${c.req.routePath}`, targetUserId: c.get('auditTarget'), params, allowed: true, status });
  }
});

export const adminRoutes = new Hono<AdminEnv>()
  .use(requireAuth)
  .use(requireOwner)
  // The app asks this to decide whether to show the Admin screen (403 for everyone else).
  .get('/access', (c) => c.json({ owner: true }))
  .get('/overview', async (c) => c.json(await overview(resolveRange(c.req.query()))))
  .get('/customers', async (c) => c.json(await customers(parseCustomersQuery(c.req.query()))))
  .get('/customers/:id', async (c) => {
    const id = c.req.param('id');
    if (/^[0-9a-f-]{36}$/i.test(id)) c.set('auditTarget', id.toLowerCase());
    return c.json(await customerDetail(id));
  })
  .get('/ai', async (c) => c.json(await aiReport(resolveRange(c.req.query()))))
  .get('/billing', async (c) => c.json(await billingReport(resolveRange(c.req.query()))))
  .get('/analytics', async (c) => c.json(await analyticsReport(resolveRange(c.req.query()))))
  .get('/health', async (c) => c.json(await health()));
