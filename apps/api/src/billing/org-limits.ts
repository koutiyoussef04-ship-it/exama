/**
 * Organization plans and allowances. Organizations are not on the student plans: each has a B2B plan
 * (`organizations.plan`: none | pilot | esencial | profesional | centro, catalog in @study/shared) whose allowances
 * apply, with owner overrides (`organizations.limits`, partial) on top — that is how Centro's custom limits and a
 * pilot's agreed allowances are set.
 *
 *   none         no active plan (every new organization): no new courses and no AI drafts (402 org_plan_required);
 *                everything already there stays readable, reviewable and exportable.
 *   pilot        granted by the B2B owner only (never automatic), from `pilot_started_at` to `pilot_ends_at`; its
 *                allowances are TOTALS for the whole pilot. Once it has ended, no new courses and no new AI drafts
 *                (402 org_pilot_expired); everything already there stays readable, reviewable and exportable.
 *   paid plans   allowances per calendar month (UTC).
 *   members      `maxMembers` counts admins and editors; reviewers are unlimited (they cannot upload or generate).
 *
 * Usage is metered in `usage_ledger` with `organization_id` set, so it never touches a staff member's personal plan,
 * and is reserved under a per-organization advisory lock before any AI call (same rule as student usage).
 *
 * Billing for organizations is manual (the owner assigns a plan after the customer has agreed and been invoiced);
 * nothing here charges anyone.
 *
 * The B2B owner (an organization account with users.b2b_role = 'owner', read from the database on every check) is not
 * bound by plan allowances or by the pilot's end when IT uploads or generates: its usage is still recorded in the ledger
 * (so the dashboard shows real totals) but never refused. The per-request size cap (maxItemsPerRequest) and the
 * anti-abuse rate limits still apply, since they protect the AI calls rather than meter a plan.
 */
import { and, eq, gte, sql, sum } from 'drizzle-orm';
import { ORGANIZATION_PLAN_CATALOG, type OrganizationLimits, type OrganizationPlanState, type OrganizationUsage } from '@study/shared';
import { db } from '../db/client.js';
import { aiUsage, documents, organizations, usageLedger } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { isB2BOwner } from '../services/accounts.js';

/** What the plan rules need from an organization row. */
export type OrgPlanRow = Pick<typeof organizations.$inferSelect, 'plan' | 'billingPeriod' | 'limits' | 'pilotStartedAt' | 'pilotEndsAt'>;

export const resolveOrgLimits = (o: Pick<OrgPlanRow, 'plan' | 'limits'>): OrganizationLimits => ({ ...ORGANIZATION_PLAN_CATALOG[o.plan].limits, ...(o.limits ?? {}) });

export const isPilotExpired = (o: Pick<OrgPlanRow, 'plan' | 'pilotEndsAt'>, now = new Date()) => o.plan === 'pilot' && !!o.pilotEndsAt && o.pilotEndsAt.getTime() <= now.getTime();

export const orgPlanState = (o: OrgPlanRow, now = new Date()): OrganizationPlanState => ({
  plan: o.plan,
  billingPeriod: o.plan === 'pilot' || o.plan === 'none' ? null : o.billingPeriod,
  pilotStartedAt: o.plan === 'pilot' ? o.pilotStartedAt.toISOString() : null,
  pilotEndsAt: o.plan === 'pilot' ? (o.pilotEndsAt?.toISOString() ?? null) : null,
  pilotExpired: isPilotExpired(o, now),
});

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Start of the window the allowances apply to: the whole pilot, or the current calendar month. */
const usageWindow = (o: Pick<OrgPlanRow, 'plan' | 'pilotStartedAt'>, now = new Date()) =>
  o.plan === 'pilot' ? { since: o.pilotStartedAt, period: 'pilot' as const } : { since: monthStart(now), period: 'month' as const };

type Exec = Pick<typeof db, 'select' | 'insert' | 'execute' | 'delete' | 'update'>;

export const loadOrgPlan = async (orgId: string, exec: Exec = db): Promise<OrgPlanRow> => {
  const [row] = await exec
    .select({ plan: organizations.plan, billingPeriod: organizations.billingPeriod, limits: organizations.limits, pilotStartedAt: organizations.pilotStartedAt, pilotEndsAt: organizations.pilotEndsAt })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!row) throw new HttpError(404, 'Organization not found', 'not_found');
  return row;
};

/** Usage in the current allowance window (`period`: 'pilot' = since the pilot started, 'month' = this calendar month). */
export async function getOrgUsage(orgId: string, exec: Exec = db, now = new Date(), plan?: OrgPlanRow): Promise<OrganizationUsage> {
  const { since, period } = usageWindow(plan ?? (await loadOrgPlan(orgId, exec)), now);
  const [ledger, [cost]] = await Promise.all([
    exec
      .select({ kind: usageLedger.kind, total: sum(usageLedger.amount) })
      .from(usageLedger)
      .where(and(eq(usageLedger.organizationId, orgId), gte(usageLedger.createdAt, since)))
      .groupBy(usageLedger.kind),
    exec
      .select({ total: sum(aiUsage.estimatedCostMicroUsd), unknown: sql<number>`count(*) filter (where ${aiUsage.estimatedCostMicroUsd} is null)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.organizationId, orgId), gte(aiUsage.createdAt, since))),
  ]);
  const used = (k: string) => Number(ledger.find((r) => r.kind === k)?.total ?? 0);
  return {
    period,
    coursesThisMonth: used('course_upload'),
    itemsThisMonth: used('bank_items'),
    aiCostMicroUsdThisMonth: Number(cost?.unknown ?? 0) > 0 && cost?.total == null ? null : Number(cost?.total ?? 0),
  };
}

/** Pre-check before storing a file or reprocessing: an active plan or running pilot, unless the actor is the B2B owner. */
export async function assertActorCanCreate(orgId: string, actorUserId: string) {
  if (await isB2BOwner(actorUserId)) return;
  assertCanCreate(await loadOrgPlan(orgId));
}

/**
 * 402 org_plan_required (no active plan) / org_pilot_expired (the pilot has ended): no new courses, AI drafts or
 * reprocessing. Reading, reviewing and exporting what is already there never goes through here.
 */
export function assertCanCreate(o: Pick<OrgPlanRow, 'plan' | 'pilotEndsAt'>, now = new Date()) {
  if (o.plan === 'none') {
    throw new HttpError(402, 'This organization has no active plan yet. Your courses, questions and exports are still available; contact Exama to choose a plan.', 'org_plan_required');
  }
  if (isPilotExpired(o, now)) {
    throw new HttpError(402, 'The pilot of this organization has ended. Your courses, questions and exports are still available; contact Exama to choose a plan.', 'org_pilot_expired', {
      pilotEndsAt: o.pilotEndsAt!.toISOString(),
    });
  }
}

const limitMessage = (period: 'pilot' | 'month', what: 'course' | 'question') =>
  period === 'pilot' ? `This organization has used all the ${what}s included in its pilot` : `This organization has reached its monthly ${what} limit`;

/** Serializes usage checks per organization (two staff members generating at the same time). */
const lockOrgUsage = (tx: Exec, orgId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-usage:${orgId}`}, 0))`);

export type OrgReservation = { id: string; amount: number };

/** Plan check + reservation for one course upload, inside the caller's transaction. */
export async function reserveOrgCourseUpload(tx: Exec, orgId: string, actorUserId: string): Promise<void> {
  await lockOrgUsage(tx, orgId);
  const plan = await loadOrgPlan(orgId, tx);
  if (!(await isB2BOwner(actorUserId, tx))) {
    assertCanCreate(plan);
    const limits = resolveOrgLimits(plan);
    const usage = await getOrgUsage(orgId, tx, new Date(), plan);
    if (usage.coursesThisMonth >= limits.coursesPerMonth) {
      throw new HttpError(402, limitMessage(usage.period, 'course'), 'org_limit_reached', { limit: 'courses', period: usage.period, used: usage.coursesThisMonth, max: limits.coursesPerMonth });
    }
  }
  await tx.insert(usageLedger).values({ organizationId: orgId, userId: actorUserId, kind: 'course_upload', amount: 1 });
}

/** Reserves `count` generated questions (trimmed to what is left in the window); released or settled after the AI call. */
export async function reserveOrgItems(orgId: string, actorUserId: string, count: number): Promise<OrgReservation> {
  return db.transaction(async (tx) => {
    await lockOrgUsage(tx, orgId);
    const plan = await loadOrgPlan(orgId, tx);
    const owner = await isB2BOwner(actorUserId, tx);
    if (!owner) assertCanCreate(plan);
    const limits = resolveOrgLimits(plan);
    if (count > limits.maxItemsPerRequest) throw new HttpError(400, `At most ${limits.maxItemsPerRequest} questions per request`, 'invalid_request');
    let amount = count;
    if (!owner) {
      const usage = await getOrgUsage(orgId, tx, new Date(), plan);
      const left = limits.itemsPerMonth - usage.itemsThisMonth;
      if (left <= 0) throw new HttpError(402, limitMessage(usage.period, 'question'), 'org_limit_reached', { limit: 'items', period: usage.period, used: usage.itemsThisMonth, max: limits.itemsPerMonth });
      amount = Math.min(count, left);
    }
    const [row] = await tx.insert(usageLedger).values({ organizationId: orgId, userId: actorUserId, kind: 'bank_items', amount }).returning({ id: usageLedger.id });
    return { id: row.id, amount };
  });
}

export const releaseOrgReservation = (r: OrgReservation) => db.delete(usageLedger).where(eq(usageLedger.id, r.id));
export const settleOrgReservation = (r: OrgReservation, delivered: number) =>
  delivered > 0 ? db.update(usageLedger).set({ amount: Math.min(delivered, r.amount) }).where(eq(usageLedger.id, r.id)) : releaseOrgReservation(r);

/** Courses of an organization (for the overview). */
export const countOrgCourses = async (orgId: string) => {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(documents).where(eq(documents.organizationId, orgId));
  return Number(row?.n ?? 0);
};
