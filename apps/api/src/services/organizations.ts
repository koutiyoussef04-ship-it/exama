/**
 * Organizations: creation, membership and the overview. Authorization for everything inside an organization
 * is `auth/org-access.ts` (membership + role read on every request); this module only changes data.
 *
 * Rules: an organization always keeps at least one admin; members are added by the email of an EXISTING
 * ORGANIZATION account (no invitations yet); adding someone never changes their account type or billing.
 * Student accounts are a separate identity and never become members, even when they share the address.
 *
 * The B2B owner (users.b2b_role = 'owner') is not bound by the organization cap or by the admin/editor seat limit
 * when IT acts; everyone else is.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { ORGANIZATION_PILOT_DAYS, type Organization, type OrganizationLimits, type OrganizationMarket, type OrganizationMember, type OrganizationMembershipSummary, type OrganizationOverview, type OrganizationRole } from '@study/shared';
import { normalizeEmail } from '@study/shared';
import { countOrgCourses, getOrgUsage, orgPlanState, resolveOrgLimits } from '../billing/org-limits.js';
import type { OrgContext } from '../auth/org-access.js';
import { db } from '../db/client.js';
import { bankItems, organizationMembers, organizations, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { findAccount, isB2BOwner } from './accounts.js';

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type OrgRow = typeof organizations.$inferSelect;

const toOrganization = (o: OrgRow, role: OrganizationRole): Organization => ({
  id: o.id,
  name: o.name,
  market: o.market,
  status: o.status,
  role,
  limits: resolveOrgLimits(o),
  ...orgPlanState(o),
  createdAt: o.createdAt.toISOString(),
});

/**
 * Creates the organization on a 30-day pilot and makes `userId` its first admin (same transaction as a sign-up when
 * called from there).
 */
export async function createOrganization(tx: Tx | typeof db, userId: string, input: { name: string; market: OrganizationMarket }): Promise<OrgRow> {
  const now = new Date();
  const [org] = await tx
    .insert(organizations)
    .values({ name: input.name, market: input.market, createdBy: userId, plan: 'pilot', pilotStartedAt: now, pilotEndsAt: new Date(now.getTime() + ORGANIZATION_PILOT_DAYS * 86_400_000) })
    .returning();
  await tx.insert(organizationMembers).values({ organizationId: org.id, userId, role: 'admin', addedBy: userId });
  return org;
}

/**
 * How many organizations one account may create (the sign-up one included). Every organization starts with its
 * own monthly AI allowances and is billed by hand, so an unbounded `POST /orgs` would let one account multiply
 * its allowances for free. Pilots rarely need more than the sign-up organization; the owner raises the limit
 * with ORG_MAX_PER_ACCOUNT when a customer really runs several.
 */
export const MAX_ORGANIZATIONS_PER_ACCOUNT = Math.max(1, Number(process.env.ORG_MAX_PER_ACCOUNT) || 2);

/**
 * Creates a further organization for an existing account, under the per-account cap. Counted and inserted in
 * one transaction, under the creator's advisory lock, so two parallel requests cannot both pass the count.
 */
export async function createAdditionalOrganization(userId: string, input: { name: string; market: OrganizationMarket }): Promise<OrgRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-create:${userId}`}, 0))`);
    const [row] = await tx.select({ n: count() }).from(organizations).where(eq(organizations.createdBy, userId));
    if (Number(row?.n ?? 0) >= MAX_ORGANIZATIONS_PER_ACCOUNT && !(await isB2BOwner(userId, tx))) {
      throw new HttpError(403, 'This account has reached its organization limit. Contact Exama to add another organization.', 'organization_limit_reached', { max: MAX_ORGANIZATIONS_PER_ACCOUNT });
    }
    return createOrganization(tx, userId, input);
  });
}

/** Organizations the account belongs to (for GET /auth/me and the app's switcher). Always empty for a student account. */
export async function listMemberships(userId: string): Promise<OrganizationMembershipSummary[]> {
  return db
    .select({ id: organizations.id, name: organizations.name, market: organizations.market, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.userId, userId), eq(users.accountType, 'organization')))
    .orderBy(organizations.createdAt);
}

export async function getOrganization(org: OrgContext): Promise<Organization> {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, org.id));
  if (!row) throw new HttpError(404, 'Organization not found', 'not_found');
  return toOrganization(row, org.role);
}

export async function getOverview(org: OrgContext): Promise<OrganizationOverview> {
  const [base, courses, statuses, [members], usage] = await Promise.all([
    getOrganization(org),
    countOrgCourses(org.id),
    db.select({ status: bankItems.status, n: count() }).from(bankItems).where(eq(bankItems.organizationId, org.id)).groupBy(bankItems.status),
    db.select({ n: count() }).from(organizationMembers).where(eq(organizationMembers.organizationId, org.id)),
    getOrgUsage(org.id),
  ]);
  const n = (s: string) => Number(statuses.find((r) => r.status === s)?.n ?? 0);
  return { ...base, counts: { courses, drafts: n('draft'), approved: n('approved'), rejected: n('rejected'), members: Number(members?.n ?? 0) }, usage };
}

export async function updateOrganization(org: OrgContext, input: { name?: string }): Promise<Organization> {
  if (input.name !== undefined) await db.update(organizations).set({ name: input.name, updatedAt: new Date() }).where(eq(organizations.id, org.id));
  return getOrganization(org);
}

/** Owner/admin tooling: change an organization's allowances (partial, merged over the defaults). */
export async function setOrganizationLimits(orgId: string, limits: Partial<OrganizationLimits>): Promise<void> {
  await db
    .update(organizations)
    .set({ limits: sql`${organizations.limits} || ${JSON.stringify(limits)}::jsonb`, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

export async function listMembers(orgId: string): Promise<OrganizationMember[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email, name: users.name, role: organizationMembers.role, joinedAt: organizationMembers.createdAt })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(users.accountType, 'organization')))
    .orderBy(desc(sql`case ${organizationMembers.role} when 'admin' then 3 when 'editor' then 2 else 1 end`), organizationMembers.createdAt);
  return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
}

/**
 * Adds an existing ORGANIZATION account by email (a student account with that address is never matched: it is a
 * different identity, and only its owner could decide to join). 404 `user_not_found` when there is no such account (an admin adding
 * colleagues needs to know; the organization workspace is not a public surface). Someone who is already a
 * member is not re-added: 409 `already_member` — their role changes only through `updateMemberRole`, which
 * is where the last-admin rule lives (an upsert here would have let the only admin demote themselves).
 */
export async function addMember(org: OrgContext, actorUserId: string, input: { email: string; role: OrganizationRole }): Promise<OrganizationMember[]> {
  const user = await findAccount(normalizeEmail(input.email), 'organization');
  if (!user) throw new HttpError(404, 'No Exama organization account with this email. Ask them to create one first (Exama for organizations → Create account).', 'user_not_found');
  const ownerActing = await isB2BOwner(actorUserId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-members:${org.id}`}, 0))`);
    const [member] = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, user.id)));
    if (!member && !ownerActing) await assertSeatAvailable(tx, org.id, input.role);
    const inserted = await tx
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user.id, role: input.role, addedBy: actorUserId })
      .onConflictDoNothing({ target: [organizationMembers.organizationId, organizationMembers.userId] })
      .returning({ userId: organizationMembers.userId });
    if (inserted.length === 0) throw new HttpError(409, 'This person is already a member. Change their role from the members list.', 'already_member');
  });
  return listMembers(org.id);
}

export async function updateMemberRole(org: OrgContext, memberUserId: string, role: OrganizationRole, actorUserId?: string): Promise<OrganizationMember[]> {
  const ownerActing = actorUserId ? await isB2BOwner(actorUserId) : false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-members:${org.id}`}, 0))`);
    if (role !== 'admin') await assertNotLastAdmin(tx, org.id, memberUserId);
    if (!ownerActing) await assertSeatAvailable(tx, org.id, role, memberUserId);
    const updated = await tx
      .update(organizationMembers)
      .set({ role })
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, memberUserId)))
      .returning({ userId: organizationMembers.userId });
    if (updated.length === 0) throw new HttpError(404, 'Member not found', 'not_found');
  });
  return listMembers(org.id);
}

export async function removeMember(org: OrgContext, memberUserId: string): Promise<OrganizationMember[]> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-members:${org.id}`}, 0))`);
    await assertNotLastAdmin(tx, org.id, memberUserId);
    const removed = await tx
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, memberUserId)))
      .returning({ userId: organizationMembers.userId });
    if (removed.length === 0) throw new HttpError(404, 'Member not found', 'not_found');
  });
  return listMembers(org.id);
}

/**
 * The plan's `maxMembers` counts admins and editors (the people who upload courses and generate questions); reviewers
 * are unlimited. 402 org_member_limit_reached when a new admin/editor would exceed it. Call under the members lock.
 * `memberUserId`: a member whose role is changing (their current admin/editor seat is not counted twice).
 */
async function assertSeatAvailable(tx: Tx, orgId: string, role: OrganizationRole, memberUserId?: string) {
  if (role === 'reviewer') return;
  const [org] = await tx.select({ plan: organizations.plan, limits: organizations.limits }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new HttpError(404, 'Organization not found', 'not_found');
  const { maxMembers } = resolveOrgLimits(org);
  const seats = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), inArray(organizationMembers.role, ['admin', 'editor']), eq(users.accountType, 'organization')));
  if (memberUserId && seats.some((s) => s.userId === memberUserId)) return;
  if (seats.length >= maxMembers) {
    throw new HttpError(402, `This organization's plan includes ${maxMembers} admins and editors. Add them as reviewers, or contact Exama to change the plan.`, 'org_member_limit_reached', { max: maxMembers, used: seats.length });
  }
}

async function assertNotLastAdmin(tx: Tx, orgId: string, memberUserId: string) {
  // Only organization accounts count: a row pointing at a student account (from before the account split) grants nothing.
  const admins = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'admin'), eq(users.accountType, 'organization')));
  if (admins.length === 1 && admins[0].userId === memberUserId) throw new HttpError(409, 'An organization needs at least one admin', 'last_admin');
}
