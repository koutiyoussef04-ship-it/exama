/**
 * Organization allowances. Organizations are not on the student plans: each has its own limits
 * (`organizations.limits`, partial, set by the owner), applied over these pilot defaults. Usage is metered in
 * `usage_ledger` with `organization_id` set, so it never touches a staff member's personal plan, and is
 * reserved under a per-organization advisory lock before any AI call (same rule as student usage).
 *
 * Billing for organizations is manual for now (invoice per pilot); nothing here charges anyone.
 */
import { and, eq, gte, sql, sum } from 'drizzle-orm';
import type { OrganizationLimits, OrganizationUsage } from '@study/shared';
import { db } from '../db/client.js';
import { aiUsage, documents, usageLedger } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

export const DEFAULT_ORGANIZATION_LIMITS: OrganizationLimits = { coursesPerMonth: 20, itemsPerMonth: 500, maxItemsPerRequest: 20 };

export const resolveOrgLimits = (partial: Partial<OrganizationLimits> | null | undefined): OrganizationLimits => ({ ...DEFAULT_ORGANIZATION_LIMITS, ...(partial ?? {}) });

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

type Exec = Pick<typeof db, 'select' | 'insert' | 'execute' | 'delete' | 'update'>;

export async function getOrgUsage(orgId: string, exec: Exec = db, now = new Date()): Promise<OrganizationUsage> {
  const since = monthStart(now);
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
    coursesThisMonth: used('course_upload'),
    itemsThisMonth: used('bank_items'),
    aiCostMicroUsdThisMonth: Number(cost?.unknown ?? 0) > 0 && cost?.total == null ? null : Number(cost?.total ?? 0),
  };
}

/** Serializes usage checks per organization (two staff members generating at the same time). */
const lockOrgUsage = (tx: Exec, orgId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`org-usage:${orgId}`}, 0))`);

export type OrgReservation = { id: string; amount: number };

/** Plan check + reservation for one course upload, inside the caller's transaction. */
export async function reserveOrgCourseUpload(tx: Exec, orgId: string, actorUserId: string, limits: OrganizationLimits): Promise<void> {
  await lockOrgUsage(tx, orgId);
  const usage = await getOrgUsage(orgId, tx);
  if (usage.coursesThisMonth >= limits.coursesPerMonth) {
    throw new HttpError(402, 'This organization has reached its monthly course limit', 'org_limit_reached', { limit: 'courses', used: usage.coursesThisMonth, max: limits.coursesPerMonth });
  }
  await tx.insert(usageLedger).values({ organizationId: orgId, userId: actorUserId, kind: 'course_upload', amount: 1 });
}

/** Reserves `count` generated questions (trimmed to what is left this month); released or settled after the AI call. */
export async function reserveOrgItems(orgId: string, actorUserId: string, count: number, limits: OrganizationLimits): Promise<OrgReservation> {
  if (count > limits.maxItemsPerRequest) throw new HttpError(400, `At most ${limits.maxItemsPerRequest} questions per request`, 'invalid_request');
  return db.transaction(async (tx) => {
    await lockOrgUsage(tx, orgId);
    const usage = await getOrgUsage(orgId, tx);
    const left = limits.itemsPerMonth - usage.itemsThisMonth;
    if (left <= 0) throw new HttpError(402, 'This organization has reached its monthly question limit', 'org_limit_reached', { limit: 'items', used: usage.itemsThisMonth, max: limits.itemsPerMonth });
    const amount = Math.min(count, left);
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
