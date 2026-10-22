/**
 * Owner tooling for organizations (B2B customers). No self-service billing exists yet: the owner sets each
 * organization's allowances and can suspend one (read-only for its members) from here.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { ORGANIZATION_PILOT_DAYS, ORGANIZATION_PILOT_MAX_DAYS, type AdminOrganization, type AdminUpdateOrganizationInput } from '@study/shared';
import { getOrgUsage, orgPlanState, resolveOrgLimits } from '../billing/org-limits.js';
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
      limits: resolveOrgLimits(r.org),
      ...orgPlanState(r.org),
      createdAt: r.org.createdAt.toISOString(),
      creatorEmail: r.creatorEmail ?? null,
      counts: { members: Number(r.members), courses: Number(r.courses), approved: Number(r.approved), drafts: Number(r.drafts) },
      usage: await getOrgUsage(r.org.id, db, new Date(), r.org),
    })),
  );
}

/**
 * The owner's changes to one organization (B2B owner dashboard and the owner admin tools; both audited by their routes).
 *
 *   plan 'pilot' (granting)   starts NOW and ends at `pilotEndsAt` (future, at most ORGANIZATION_PILOT_MAX_DAYS away) or
 *                             after ORGANIZATION_PILOT_DAYS; allowances = the pilot defaults, or `limits` if given.
 *   pilotEndsAt on a pilot    extends it, or ends it now (any date not after now ends it: the pilot is revoked, its dates kept).
 *   plan 'none'               removes the plan: no new courses or drafts. No billing period, no allowance overrides.
 *   paid plans                monthly or yearly; no end date here (manual billing). The last pilot's dates stay as a record.
 *
 * Nothing here charges anyone or creates anything in Stripe.
 */
export async function updateOrganizationForOwner(id: string, input: AdminUpdateOrganizationInput): Promise<AdminOrganization> {
  const [existing] = await db
    .select({ id: organizations.id, plan: organizations.plan, pilotStartedAt: organizations.pilotStartedAt, pilotEndsAt: organizations.pilotEndsAt })
    .from(organizations)
    .where(eq(organizations.id, id));
  if (!existing) throw new HttpError(404, 'Organization not found', 'not_found');
  const plan = input.plan ?? existing.plan;
  const changingPlan = input.plan !== undefined && input.plan !== existing.plan;
  const now = new Date();
  if ((plan === 'pilot' || plan === 'none') && input.billingPeriod) throw new HttpError(400, `${plan === 'pilot' ? 'A pilot' : 'An organization without a plan'} has no billing period`, 'invalid_request');
  if (plan !== 'pilot' && input.pilotEndsAt) throw new HttpError(400, 'Only a pilot has an end date', 'invalid_request');
  if (plan === 'none' && input.limits) throw new HttpError(400, 'An organization without a plan has no allowances to change', 'invalid_request');
  if (plan === 'pilot' && input.pilotEndsAt) {
    const end = new Date(input.pilotEndsAt).getTime();
    const startsAt = changingPlan ? now.getTime() : existing.pilotStartedAt.getTime();
    if (changingPlan && end <= now.getTime()) throw new HttpError(400, 'A new pilot must end in the future', 'invalid_request');
    if (end - startsAt > ORGANIZATION_PILOT_MAX_DAYS * 86_400_000) throw new HttpError(400, `A pilot can last at most ${ORGANIZATION_PILOT_MAX_DAYS} days`, 'invalid_request');
  }
  await db
    .update(organizations)
    .set({
      ...(input.status ? { status: input.status } : {}),
      // A plan change starts from that plan's allowances: earlier overrides are dropped unless new ones come with it.
      ...(changingPlan
        ? { plan, limits: input.limits ?? {} }
        : input.limits
          ? { limits: sql`${organizations.limits} || ${JSON.stringify(input.limits)}::jsonb` }
          : {}),
      ...(plan === 'pilot' || plan === 'none' ? { billingPeriod: null } : input.billingPeriod !== undefined ? { billingPeriod: input.billingPeriod } : {}),
      // Granting a pilot: it starts now, for ORGANIZATION_PILOT_DAYS unless an end date is given. On a running pilot, a
      // date extends or ends it. Leaving a pilot keeps its dates as a record (they only apply while plan = 'pilot').
      ...(plan === 'pilot' && changingPlan
        ? { pilotStartedAt: now, pilotEndsAt: input.pilotEndsAt ? new Date(input.pilotEndsAt) : new Date(now.getTime() + ORGANIZATION_PILOT_DAYS * 86_400_000) }
        : plan === 'pilot' && input.pilotEndsAt
          ? { pilotEndsAt: new Date(Math.max(new Date(input.pilotEndsAt).getTime(), existing.pilotStartedAt.getTime())) }
          : {}),
      updatedAt: now,
    })
    .where(eq(organizations.id, id));
  const all = await listOrganizationsForOwner();
  return all.find((o) => o.id === id)!;
}
