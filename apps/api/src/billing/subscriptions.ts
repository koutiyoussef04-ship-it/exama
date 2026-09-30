/**
 * Provider-neutral subscription state. Every provider (mock, Apple, Google Play, Stripe) produces a
 * SubscriptionUpdate and calls applySubscriptionUpdate — the only writer of `subscriptions`.
 * Monetization analytics are emitted here, so they're identical whichever provider is used.
 */
import { and, eq } from 'drizzle-orm';
import { normalizePlanId, planById, TIER_RANK, TRIAL_DAYS, type BillingEnvironment, type PlanId } from '@study/shared';
import { track } from '../analytics/index.js';
import { db, type DB } from '../db/client.js';
import { subscriptions } from '../db/schema.js';

export type SubscriptionRow = typeof subscriptions.$inferSelect;
/** The shared connection pool or an open transaction. */
export type Exec = DB | Parameters<Parameters<DB['transaction']>[0]>[0];
export type ProviderId = 'mock' | 'apple' | 'google' | 'stripe';

/** Common properties of every subscription analytics event: the plan, its tier and period, and where it was sold. */
export function subscriptionEventProps(planId: PlanId, provider: ProviderId, environment: BillingEnvironment) {
  const plan = planById(planId);
  return { plan_id: planId, tier: plan.tier, period: plan.period, provider, environment };
}

/** How a new paid plan relates to the previous one (for subscription_started). */
export function planChange(previous: PlanId | null, next: PlanId): 'new' | 'upgrade' | 'downgrade' | 'period_change' {
  if (!previous || previous === next) return 'new';
  const [a, b] = [planById(previous), planById(next)];
  if (a.tier === b.tier) return 'period_change';
  return TIER_RANK[b.tier] > TIER_RANK[a.tier] ? 'upgrade' : 'downgrade';
}

export type SubscriptionUpdate = {
  provider: ProviderId;
  planId: PlanId;
  status: 'trialing' | 'active' | 'cancelled' | 'expired';
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  willRenew: boolean;
  trialUsed: boolean;
  providerRef?: string | null;
  /** test = mock provider; sandbox/production = Apple's environment for the transaction. */
  environment: BillingEnvironment;
};

/** Why the state changed — decides which analytics event (if any) is recorded. */
export type ChangeReason = 'trial' | 'purchase' | 'cancel' | 'restore' | 'silent';

export async function getSubscription(userId: string, exec: Exec = db): Promise<SubscriptionRow | null> {
  const [row] = await exec.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  return row ?? null;
}

export async function applySubscriptionUpdate(userId: string, update: SubscriptionUpdate, reason: ChangeReason, exec: Exec = db): Promise<SubscriptionRow> {
  const previous = await getSubscription(userId, exec);
  const values = { ...update, providerRef: update.providerRef ?? previous?.providerRef ?? null, updatedAt: new Date() };
  const [row] = await exec
    .insert(subscriptions)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values })
    .returning();

  const base = subscriptionEventProps(update.planId, update.provider, update.environment);
  switch (reason) {
    case 'trial':
      void track('trial_started', userId, base);
      break;
    case 'purchase': {
      const previousPlan = previous ? normalizePlanId(previous.planId) : null;
      const wasPaid = !!previous && !!previousPlan && (previous.status === 'active' || previous.status === 'cancelled') && previousPlan !== update.planId;
      void track('subscription_started', userId, {
        ...base,
        from_trial: previous?.status === 'trialing',
        change: wasPaid ? planChange(previousPlan, update.planId) : 'new',
        ...(wasPaid ? { previous_plan_id: previousPlan! } : {}),
      });
      break;
    }
    case 'cancel':
      void track('subscription_cancelled', userId, base);
      break;
    case 'restore':
      void track('subscription_restored', userId, base);
      break;
    case 'silent':
      break;
  }
  return row;
}

/**
 * True when the row's access period is the free trial — trialing, or a trial that was cancelled
 * (or has expired) without converting. A paid period always ends at a different time than the trial.
 */
export function isTrialPeriod(row: SubscriptionRow): boolean {
  return row.status === 'trialing' || (!!row.trialEndsAt && !!row.currentPeriodEndsAt && +row.trialEndsAt === +row.currentPeriodEndsAt);
}

/** When the trial started (trial usage is counted from here). */
export function trialStartedAt(row: SubscriptionRow): Date {
  return row.trialEndsAt ? new Date(+row.trialEndsAt - TRIAL_DAYS * 86_400_000) : row.createdAt;
}

/** When access ends for a subscription row (trial end while trialing, else period end). */
export function accessEndsAt(row: SubscriptionRow): Date | null {
  if (row.status === 'trialing') return row.trialEndsAt;
  return row.currentPeriodEndsAt ?? row.trialEndsAt;
}

/**
 * Marks a lapsed trial/subscription as expired (idempotent under concurrency) and records
 * subscription_expired once. Providers that push expiry (Apple notifications) can call this too.
 */
export async function expireIfLapsed(row: SubscriptionRow, now = new Date(), exec: Exec = db): Promise<SubscriptionRow> {
  if (row.status === 'expired') return row;
  const end = accessEndsAt(row);
  if (!end || end > now) return row;

  const wasTrial = isTrialPeriod(row);
  // Conditional on the status we read, so concurrent requests record the event only once.
  const [updated] = await exec
    .update(subscriptions)
    .set({ status: 'expired', willRenew: false, updatedAt: now })
    .where(and(eq(subscriptions.id, row.id), eq(subscriptions.status, row.status)))
    .returning();
  if (updated) {
    const planId = normalizePlanId(row.planId);
    if (planId) void track('subscription_expired', row.userId, { ...subscriptionEventProps(planId, row.provider, row.environment), was_trial: wasTrial });
    return updated;
  }
  return (await getSubscription(row.userId, exec)) ?? row;
}
