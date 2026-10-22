/**
 * B2B owner dashboard (routes/b2b-admin.ts): every organization, its plan and pilot, usage, content totals, activity and
 * operational errors, plus the organization accounts. Read-only except the plan / pilot / limits / suspension of an
 * organization (updateOrganizationForOwner, shared with the student owner's existing screen).
 *
 * It shows organization metadata and totals, never course material or question text: the B2B owner administers
 * customers, it is not a member of their workspaces. Student accounts are not listed here.
 */
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { ORGANIZATION_PLANS, type B2BAccountRow, type B2BOrganizationDetail, type B2BOrganizationRow, type B2BOverview, type OrganizationPlan } from '@study/shared';
import { isPilotExpired } from '../billing/org-limits.js';
import { db } from '../db/client.js';
import { aiUsage, bankItems, documents, organizationMembers, organizations, usageLedger, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { listOrganizationsForOwner } from './organizations.js';

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function b2bOverview(now = new Date()): Promise<B2BOverview> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [orgs, [accounts], [noOrg], ledger, [cost], [docs], items, [aiErrors]] = await Promise.all([
    db.select({ plan: organizations.plan, status: organizations.status, pilotEndsAt: organizations.pilotEndsAt }).from(organizations),
    db
      .select({
        total: count(),
        verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)`,
        recent: sql<number>`count(*) filter (where ${users.createdAt} >= ${since30.toISOString()}::timestamptz)`,
      })
      .from(users)
      .where(eq(users.accountType, 'organization')),
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.accountType, 'organization'), sql`not exists (select 1 from ${organizationMembers} m where m.user_id = ${users.id})`)),
    db
      .select({ kind: usageLedger.kind, total: sql<number>`coalesce(sum(${usageLedger.amount}), 0)` })
      .from(usageLedger)
      .where(and(sql`${usageLedger.organizationId} is not null`, gte(usageLedger.createdAt, monthStart(now))))
      .groupBy(usageLedger.kind),
    db
      .select({ total: sql<number | null>`sum(${aiUsage.estimatedCostMicroUsd})`, unknown: sql<number>`count(*) filter (where ${aiUsage.estimatedCostMicroUsd} is null)` })
      .from(aiUsage)
      .where(and(sql`${aiUsage.organizationId} is not null`, gte(aiUsage.createdAt, monthStart(now)))),
    db
      .select({
        total: count(),
        failed: sql<number>`count(*) filter (where ${documents.status} = 'failed')`,
        failedRecent: sql<number>`count(*) filter (where ${documents.status} = 'failed' and ${documents.createdAt} >= ${since30.toISOString()}::timestamptz)`,
      })
      .from(documents)
      .where(sql`${documents.organizationId} is not null`),
    db.select({ status: bankItems.status, n: count() }).from(bankItems).groupBy(bankItems.status),
    db
      .select({ n: count() })
      .from(aiUsage)
      .where(and(sql`${aiUsage.organizationId} is not null`, eq(aiUsage.success, false), gte(aiUsage.createdAt, since30))),
  ]);
  const byPlan = Object.fromEntries(ORGANIZATION_PLANS.map((p) => [p, 0])) as Record<OrganizationPlan, number>;
  let pilotsActive = 0;
  let pilotsExpired = 0;
  let pilotsEndingSoon = 0;
  for (const o of orgs) {
    byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1;
    if (o.plan !== 'pilot') continue;
    if (isPilotExpired(o, now)) pilotsExpired++;
    else {
      pilotsActive++;
      if (o.pilotEndsAt && o.pilotEndsAt.getTime() - now.getTime() <= 7 * DAY) pilotsEndingSoon++;
    }
  }
  const used = (k: string) => Number(ledger.find((r) => r.kind === k)?.total ?? 0);
  const item = (s: string) => Number(items.find((r) => r.status === s)?.n ?? 0);
  return {
    organizations: {
      total: orgs.length,
      active: orgs.filter((o) => o.status === 'active').length,
      suspended: orgs.filter((o) => o.status === 'suspended').length,
      byPlan,
      pilotsActive,
      pilotsExpired,
      pilotsEndingSoon,
      withoutPlan: byPlan.none,
    },
    accounts: {
      organizationAccounts: Number(accounts?.total ?? 0),
      verified: Number(accounts?.verified ?? 0),
      withoutOrganization: Number(noOrg?.n ?? 0),
      signupsLast30Days: Number(accounts?.recent ?? 0),
    },
    usageThisMonth: {
      courses: used('course_upload'),
      drafts: used('bank_items'),
      aiCostMicroUsd: Number(cost?.unknown ?? 0) > 0 && cost?.total == null ? null : Number(cost?.total ?? 0),
    },
    content: { courses: Number(docs?.total ?? 0), failedCourses: Number(docs?.failed ?? 0), drafts: item('draft'), approved: item('approved'), rejected: item('rejected') },
    operations: { aiErrorsLast30Days: Number(aiErrors?.n ?? 0), failedCoursesLast30Days: Number(docs?.failedRecent ?? 0) },
    generatedAt: now.toISOString(),
  };
}

export async function b2bOrganizations(now = new Date()): Promise<B2BOrganizationRow[]> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [base, last, failed, errors] = await Promise.all([
    listOrganizationsForOwner(),
    db
      .select({ id: usageLedger.organizationId, at: sql<string>`max(${usageLedger.createdAt})` })
      .from(usageLedger)
      .where(sql`${usageLedger.organizationId} is not null`)
      .groupBy(usageLedger.organizationId),
    db
      .select({ id: documents.organizationId, n: count() })
      .from(documents)
      .where(and(sql`${documents.organizationId} is not null`, eq(documents.status, 'failed')))
      .groupBy(documents.organizationId),
    db
      .select({ id: aiUsage.organizationId, n: count() })
      .from(aiUsage)
      .where(and(sql`${aiUsage.organizationId} is not null`, eq(aiUsage.success, false), gte(aiUsage.createdAt, since30)))
      .groupBy(aiUsage.organizationId),
  ]);
  return base.map((o) => {
    const at = last.find((r) => r.id === o.id)?.at;
    return {
      ...o,
      lastActivityAt: at ? new Date(at).toISOString() : null,
      failedCourses: Number(failed.find((r) => r.id === o.id)?.n ?? 0),
      aiErrorsLast30Days: Number(errors.find((r) => r.id === o.id)?.n ?? 0),
    };
  });
}

export async function b2bOrganizationDetail(id: string, now = new Date()): Promise<B2BOrganizationDetail> {
  if (!UUID.test(id)) throw new HttpError(404, 'Organization not found', 'not_found');
  const row = (await b2bOrganizations(now)).find((o) => o.id === id);
  if (!row) throw new HttpError(404, 'Organization not found', 'not_found');
  const [members, courses, activity, aiErrors] = await Promise.all([
    db
      .select({ userId: users.id, email: users.email, name: users.name, role: organizationMembers.role, joinedAt: organizationMembers.createdAt, verifiedAt: users.emailVerifiedAt, accountType: users.accountType })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, id))
      .orderBy(organizationMembers.createdAt),
    db
      .select({ id: documents.id, title: documents.title, status: documents.status, errorCode: documents.errorCode, pageCount: documents.pageCount, createdAt: documents.createdAt })
      .from(documents)
      .where(eq(documents.organizationId, id))
      .orderBy(desc(documents.createdAt))
      .limit(100),
    db
      .select({ at: usageLedger.createdAt, kind: usageLedger.kind, amount: usageLedger.amount, userEmail: users.email })
      .from(usageLedger)
      .leftJoin(users, eq(users.id, usageLedger.userId))
      .where(eq(usageLedger.organizationId, id))
      .orderBy(desc(usageLedger.createdAt))
      .limit(30),
    db
      .select({ at: aiUsage.createdAt, feature: aiUsage.feature, errorCode: aiUsage.errorCode })
      .from(aiUsage)
      .where(and(eq(aiUsage.organizationId, id), eq(aiUsage.success, false)))
      .orderBy(desc(aiUsage.createdAt))
      .limit(20),
  ]);
  return {
    ...row,
    // Only organization accounts are members (a row left over from before the account split is not shown).
    members: members
      .filter((m) => m.accountType === 'organization')
      .map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role, joinedAt: m.joinedAt.toISOString(), emailVerified: !!m.verifiedAt })),
    courses: courses.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    activity: activity.map((a) => ({ at: a.at.toISOString(), kind: a.kind, amount: a.amount, userEmail: a.userEmail ?? null })),
    aiErrors: aiErrors.map((e) => ({ at: e.at.toISOString(), feature: e.feature, errorCode: e.errorCode ?? null })),
  };
}

/** Organization accounts (newest first, at most 500) with their memberships. Student accounts are never listed. */
export async function b2bAccounts(): Promise<B2BAccountRow[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, verifiedAt: users.emailVerifiedAt, b2bRole: users.b2bRole })
    .from(users)
    .where(eq(users.accountType, 'organization'))
    .orderBy(desc(users.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.id);
  const memberships = ids.length
    ? await db
        .select({ userId: organizationMembers.userId, id: organizations.id, name: organizations.name, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(inArray(organizationMembers.userId, ids))
    : [];
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    emailVerified: !!r.verifiedAt,
    b2bRole: r.b2bRole ?? null,
    organizations: memberships.filter((m) => m.userId === r.id).map((m) => ({ id: m.id, name: m.name, role: m.role })),
  }));
}
