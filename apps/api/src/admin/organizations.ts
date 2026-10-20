/**
 * Owner tooling for organizations (B2B customers). No self-service billing exists yet: the owner sets each
 * organization's allowances and can suspend one (read-only for its members) from here.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { AdminOrganization, AdminUpdateOrganizationInput } from '@study/shared';
import { getOrgUsage, resolveOrgLimits } from '../billing/org-limits.js';
import { db } from '../db/client.js';
import { bankItems, documents, organizationMembers, organizations, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export async function listOrganizationsForOwner(): Promise<AdminOrganization[]> {
  const rows = await db
    .select({
      org: organizations,
      members: sql<number>`(select count(*) from ${organizationMembers} m where m.organization_id = ${organizations.id})`,
      courses: sql<number>`(select count(*) from ${documents} d where d.organization_id = ${organizations.id})`,
      approved: sql<number>`(select count(*) from ${bankItems} b where b.organization_id = ${organizations.id} and b.status = 'approved')`,
      drafts: sql<number>`(select count(*) from ${bankItems} b where b.organization_id = ${organizations.id} and b.status = 'draft')`,
      creatorEmail: users.email,
    })
    .from(organizations)
    .leftJoin(users, eq(users.id, organizations.createdBy))
    .orderBy(desc(organizations.createdAt));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.org.id,
      name: r.org.name,
      market: r.org.market,
      status: r.org.status,
      limits: resolveOrgLimits(r.org.limits),
      createdAt: r.org.createdAt.toISOString(),
      creatorEmail: r.creatorEmail ?? null,
      counts: { members: Number(r.members), courses: Number(r.courses), approved: Number(r.approved), drafts: Number(r.drafts) },
      usage: await getOrgUsage(r.org.id),
    })),
  );
}

export async function updateOrganizationForOwner(id: string, input: AdminUpdateOrganizationInput): Promise<AdminOrganization> {
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id));
  if (!existing) throw new HttpError(404, 'Organization not found', 'not_found');
  await db
    .update(organizations)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(input.limits ? { limits: sql`${organizations.limits} || ${JSON.stringify(input.limits)}::jsonb` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, id));
  const all = await listOrganizationsForOwner();
  return all.find((o) => o.id === id)!;
}
