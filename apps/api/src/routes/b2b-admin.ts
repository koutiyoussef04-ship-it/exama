/**
 * /b2b-admin/* — the B2B owner dashboard API, separate from the student owner's /admin.
 *
 * Authorization is on the server, for every route: a valid session (requireAuth) whose account is an ORGANIZATION
 * account with users.b2b_role = 'owner' (ownerOnlyAudited below: services/accounts.ts isB2BOwner, read from the database on each request). That role is only
 * ever granted by the provisioning command run on the server (scripts/b2b-owner.ts) — never by sign-up, never from an
 * email address, never by the student owner configuration (OWNER_EMAILS / OWNER_USER_IDS). Anyone else gets 404.
 * Every request is written to admin_audit_log with a "b2b" action: allowed ones with their status (and, for changes, which
 * fields were set to what), refused ones with allowed = false — so attempts by other accounts are visible too.
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { adminUpdateOrganizationSchema, type B2BAccountRow, type B2BOrganizationDetail, type B2BOrganizationRow, type B2BOverview } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { b2bAccounts, b2bOrganizationDetail, b2bOrganizations, b2bOverview } from '../admin/b2b.js';
import { updateOrganizationForOwner } from '../admin/organizations.js';
import { db } from '../db/client.js';
import { adminAuditLog } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { isB2BOwner } from '../services/accounts.js';

const limiter = new RateLimiter(300, 5 * 60_000, 'Too many requests. Please wait a moment.');
type B2BEnv = AuthEnv & { Variables: { auditChange?: string } };

async function audit(entry: { actorUserId: string; action: string; params: Record<string, string>; allowed: boolean; status: number }) {
  await db
    .insert(adminAuditLog)
    .values(entry)
    .catch((err) => console.error('[b2b-admin] audit log write failed:', err instanceof Error ? err.message : err));
}
const auditParams = (orgId: string | undefined, change: string | undefined): Record<string, string> => ({
  ...(orgId ? { organizationId: orgId.slice(0, 64) } : {}),
  ...(change ? { change: change.slice(0, 300) } : {}),
});

/**
 * The B2B owner check (database, every request) and the audit trail. Refused attempts are audited and answered 404, like an
 * unknown route, so the dashboard's existence is not revealed; they count against the same per-account rate limit.
 */
const ownerOnlyAudited = createMiddleware<B2BEnv>(async (c, next) => {
  limiter.take(c.var.userId);
  if (!(await isB2BOwner(c.var.userId))) {
    // No route has matched yet: the requested path itself (ids only, no query string) is what was attempted.
    await audit({ actorUserId: c.var.userId, action: `b2b ${c.req.method} ${c.req.path.slice(0, 200)}`, params: {}, allowed: false, status: 404 });
    throw new HttpError(404, 'Not found', 'not_found');
  }
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = err instanceof HttpError ? err.status : 500;
    throw err;
  } finally {
    // After the handler ran, routePath/param name the matched route (e.g. /b2b-admin/organizations/:id).
    await audit({ actorUserId: c.var.userId, action: `b2b ${c.req.method} ${c.req.routePath}`, params: auditParams(c.req.param('id'), c.get('auditChange')), allowed: true, status });
  }
});

export const b2bAdminRoutes = new Hono<B2BEnv>()
  .use(requireAuth)
  .use(ownerOnlyAudited)
  .get('/access', (c) => c.json({ b2bOwner: true }))
  .get('/overview', async (c) => c.json<B2BOverview>(await b2bOverview()))
  .get('/organizations', async (c) => c.json<B2BOrganizationRow[]>(await b2bOrganizations()))
  .get('/organizations/:id', async (c) => c.json<B2BOrganizationDetail>(await b2bOrganizationDetail(c.req.param('id'))))
  // Plan assignment (billing is manual), pilot end date, allowance overrides, suspension / reactivation.
  .patch('/organizations/:id', async (c) => {
    const input = parseBody(adminUpdateOrganizationSchema, await c.req.json().catch(() => ({})));
    // What was changed (plan, billing period, pilot end, limits, status) goes into the audit row.
    c.set('auditChange', JSON.stringify(input));
    const id = c.req.param('id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, 'Organization not found', 'not_found');
    await updateOrganizationForOwner(id, input);
    return c.json<B2BOrganizationDetail>(await b2bOrganizationDetail(id));
  })
  .get('/accounts', async (c) => c.json<B2BAccountRow[]>(await b2bAccounts()));
