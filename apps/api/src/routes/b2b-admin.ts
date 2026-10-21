/**
 * /b2b-admin/* — the B2B owner dashboard API, separate from the student owner's /admin.
 *
 * Authorization is on the server, for every route: a valid session (requireAuth) whose account is an ORGANIZATION
 * account with users.b2b_role = 'owner' (requireB2BOwner, read from the database on each request). That role is only
 * ever granted by the provisioning command run on the server (scripts/b2b-owner.ts) — never by sign-up, never from an
 * email address, never by the student owner configuration (OWNER_EMAILS / OWNER_USER_IDS). Anyone else gets 404.
 * Every allowed request is written to admin_audit_log with a "b2b" action.
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { adminUpdateOrganizationSchema, type B2BAccountRow, type B2BOrganizationDetail, type B2BOrganizationRow, type B2BOverview } from '@study/shared';
import { requireAuth, requireB2BOwner, type AuthEnv } from '../auth/auth.js';
import { b2bAccounts, b2bOrganizationDetail, b2bOrganizations, b2bOverview } from '../admin/b2b.js';
import { updateOrganizationForOwner } from '../admin/organizations.js';
import { db } from '../db/client.js';
import { adminAuditLog } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';

const limiter = new RateLimiter(300, 5 * 60_000, 'Too many requests. Please wait a moment.');

const audited = createMiddleware<AuthEnv>(async (c, next) => {
  limiter.take(c.var.userId);
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } catch (err) {
    status = err instanceof HttpError ? err.status : 500;
    throw err;
  } finally {
    const orgId = c.req.param('id');
    await db
      .insert(adminAuditLog)
      .values({ actorUserId: c.var.userId, action: `b2b ${c.req.method} ${c.req.routePath}`, params: orgId ? { organizationId: orgId.slice(0, 64) } : {}, allowed: true, status })
      .catch((err) => console.error('[b2b-admin] audit log write failed:', err instanceof Error ? err.message : err));
  }
});

export const b2bAdminRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .use(requireB2BOwner)
  .use(audited)
  .get('/access', (c) => c.json({ b2bOwner: true }))
  .get('/overview', async (c) => c.json<B2BOverview>(await b2bOverview()))
  .get('/organizations', async (c) => c.json<B2BOrganizationRow[]>(await b2bOrganizations()))
  .get('/organizations/:id', async (c) => c.json<B2BOrganizationDetail>(await b2bOrganizationDetail(c.req.param('id'))))
  // Plan assignment (billing is manual), pilot end date, allowance overrides, suspension / reactivation.
  .patch('/organizations/:id', async (c) => {
    const input = parseBody(adminUpdateOrganizationSchema, await c.req.json().catch(() => ({})));
    const id = c.req.param('id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, 'Organization not found', 'not_found');
    await updateOrganizationForOwner(id, input);
    return c.json<B2BOrganizationDetail>(await b2bOrganizationDetail(id));
  })
  .get('/accounts', async (c) => c.json<B2BAccountRow[]>(await b2bAccounts()));
