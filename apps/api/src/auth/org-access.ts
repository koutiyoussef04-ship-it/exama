/**
 * Organization authorization. Every organization route names its organization in the path
 * (/orgs/:orgId/…); the membership and role are read from the database on EVERY request (never from the
 * token, never from the client), so removing a member takes effect on their next call. Non-members get
 * 404 — the same answer as for an organization that doesn't exist — so ids can't be probed.
 *
 * Inside an organization: reviewer ⊂ editor ⊂ admin (see ORGANIZATION_ROLES in @study/shared).
 */
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { roleAtLeast, type OrganizationMarket, type OrganizationRole } from '@study/shared';
import { db } from '../db/client.js';
import { organizationMembers, organizations } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { AuthEnv } from './auth.js';

export type OrgContext = { id: string; name: string; market: OrganizationMarket; status: 'active' | 'suspended'; role: OrganizationRole };
export type OrgEnv = { Variables: AuthEnv['Variables'] & { org: OrgContext } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's membership of an organization, or null (unknown org, not a member, bad id). */
export async function getMembership(userId: string, orgId: string): Promise<OrgContext | null> {
  if (!UUID.test(orgId)) return null;
  const [row] = await db
    .select({ id: organizations.id, name: organizations.name, market: organizations.market, status: organizations.status, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)));
  return row ?? null;
}

/**
 * Requires `requireAuth` before it. Loads the membership for `:orgId` and refuses with 404 (not a member)
 * or 403 (member, but a lower role than `min`). A suspended organization is read-only (403 for editors/admins
 * on non-GET requests).
 */
export const requireOrgRole = (min: OrganizationRole) =>
  createMiddleware<OrgEnv>(async (c, next) => {
    const org = await getMembership(c.var.userId, c.req.param('orgId') ?? '');
    if (!org) throw new HttpError(404, 'Organization not found', 'not_found');
    if (!roleAtLeast(org.role, min)) throw new HttpError(403, 'Your role in this organization does not allow this', 'org_role_required', { required: min });
    if (org.status === 'suspended' && c.req.method !== 'GET') throw new HttpError(403, 'This organization is suspended', 'org_suspended');
    c.set('org', org);
    await next();
  });
