/**
 * Stripe (web) provider — the pure part: Price ↔ plan, and Stripe subscription → SubscriptionUpdate.
 *
 * Stripe is the THIRD billing provider next to Apple and Google. It feeds the same normalized
 * SubscriptionUpdate into the same single writer (applySubscriptionUpdate) and the same entitlement
 * resolver — there is no second entitlement implementation. Checkout, the Customer Portal and the
 * webhook live in ../stripe-service.ts.
 *
 * ACCESS RULES (Stripe status → Exama access). Mirrors the store providers: access continues while the
 * payment is being retried (a bounded grace period, like Apple's billing grace / Google's grace period)
 * and ends when the store gives up.
 *
 *   trialing            full access for the selected plan until the trial ends          → trialing
 *   active              full access until the current period ends                        → active
 *   active + cancelling access continues until the period ends, then ends (no renewal)   → cancelled
 *   past_due            renewal payment failed, Stripe is retrying: access continues for
 *                       PAST_DUE_GRACE_DAYS after the failed renewal, then ends           → active (grace)
 *   unpaid              retries exhausted: access ended                                   → expired
 *   canceled            subscription ended (immediately or at period end): access ended  → expired
 *   incomplete          first payment not confirmed yet: nothing is granted, nothing changes → (ignored)
 *   incomplete_expired  first payment never completed: no access                          → expired
 *   paused / unknown    no access (fail closed)                                           → expired
 */
import { PLANS, type Plan, type PlanId } from '@study/shared';
import { HttpError } from '../../lib/errors.js';
import type { SubscriptionUpdate } from '../subscriptions.js';
import type { BillingProvider } from './types.js';
import { createStripeApi, type StripeApi, type StripeItemLike, type StripeSubscriptionLike } from './stripe-api.js';

/** After a failed renewal, access continues this long while Stripe retries the payment. */
export const PAST_DUE_GRACE_DAYS = 7;
const DAY = 86_400_000;
/** Stripe's minimum Checkout Session lifetime. A short life limits stale, still-payable sessions. */
export const CHECKOUT_TTL_SECONDS = 30 * 60;

/** Stripe Price id per Exama plan. Always from server configuration, never from a client. */
export type StripePrices = Record<PlanId, string>;

/** Everything the Stripe routes and the webhook need. null when Stripe is not configured. */
export type StripeBilling = {
  api: StripeApi;
  prices: StripePrices;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
};

/** The configuration fields Stripe needs (a subset of the validated server config). */
export type StripeConfig = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_BASIC_MONTHLY_PRICE_ID?: string;
  STRIPE_BASIC_YEARLY_PRICE_ID?: string;
  STRIPE_STUDENT_MONTHLY_PRICE_ID?: string;
  STRIPE_STUDENT_YEARLY_PRICE_ID?: string;
  STRIPE_PRO_MONTHLY_PRICE_ID?: string;
  STRIPE_PRO_YEARLY_PRICE_ID?: string;
  STRIPE_SUCCESS_URL?: string;
  STRIPE_CANCEL_URL?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
};

export function stripePricesFromConfig(c: StripeConfig): StripePrices {
  return {
    basic_monthly: c.STRIPE_BASIC_MONTHLY_PRICE_ID!,
    basic_yearly: c.STRIPE_BASIC_YEARLY_PRICE_ID!,
    student_monthly: c.STRIPE_STUDENT_MONTHLY_PRICE_ID!,
    student_yearly: c.STRIPE_STUDENT_YEARLY_PRICE_ID!,
    pro_monthly: c.STRIPE_PRO_MONTHLY_PRICE_ID!,
    pro_yearly: c.STRIPE_PRO_YEARLY_PRICE_ID!,
  };
}

/** Config is validated at startup (config.ts), so the required fields are present when STRIPE_ENABLED. */
export function createStripeBilling(c: StripeConfig): StripeBilling {
  const successUrl = c.STRIPE_SUCCESS_URL!;
  return {
    api: createStripeApi({ secretKey: c.STRIPE_SECRET_KEY!, webhookSecret: c.STRIPE_WEBHOOK_SECRET! }),
    prices: stripePricesFromConfig(c),
    successUrl,
    cancelUrl: c.STRIPE_CANCEL_URL!,
    portalReturnUrl: c.STRIPE_PORTAL_RETURN_URL ?? new URL('/account', successUrl).toString(),
  };
}

/** The plan sold under a Stripe Price id, or null for a Price that is not one of ours. */
export function planForPrice(prices: StripePrices, priceId: string): Plan | null {
  const planId = (Object.keys(prices) as PlanId[]).find((id) => prices[id] === priceId);
  return planId ? (PLANS.find((p) => p.id === planId) ?? null) : null;
}

/** Statuses in which the customer already has a subscription that must be managed, not duplicated. */
export const SUBSCRIPTION_BLOCKS_CHECKOUT: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid']);
/** Statuses in which a Stripe subscription is still running (and could still bill the customer). */
export const SUBSCRIPTION_IS_RUNNING: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due']);

const ms = (seconds: number | null | undefined) => (typeof seconds === 'number' ? new Date(seconds * 1000) : null);
const earlier = (a: Date, b: Date | null) => (b && b < a ? b : a);

/**
 * Stripe subscription → normalized state. Pure: `now` and the grace period are parameters.
 * Returns null when there is nothing to record (a Price that is not ours, or a first payment still pending).
 */
export function mapStripeSubscription(sub: StripeSubscriptionLike, prices: StripePrices, now = new Date(), graceDays = PAST_DUE_GRACE_DAYS): SubscriptionUpdate | null {
  let item: StripeItemLike | undefined;
  let plan: Plan | null = null;
  for (const i of sub.items) {
    plan = planForPrice(prices, i.priceId);
    if (plan) {
      item = i;
      break;
    }
  }
  if (!item || !plan) return null;

  const base = {
    provider: 'stripe' as const,
    // Test-mode subscriptions are "sandbox": they never count as revenue in reports.
    environment: sub.livemode ? ('production' as const) : ('sandbox' as const),
    planId: plan.id,
    trialUsed: true, // any subscription uses up the free trial (one per account, as on the stores)
    providerRef: sub.id,
  };
  const periodStart = ms(item.currentPeriodStart);
  const periodEnd = ms(item.currentPeriodEnd);
  const trialEnd = ms(sub.trialEnd);
  const cancelAt = ms(sub.cancelAt);
  // Will not renew: cancel-at-period-end, or a scheduled cancellation that falls inside this period.
  // (A cancellation scheduled for a later period still renews until then.)
  const cancelling = sub.cancelAtPeriodEnd || (cancelAt !== null && periodEnd !== null && cancelAt <= periodEnd);
  /** A scheduled cancellation before the period end ends access there. */
  const limit = (end: Date) => (cancelAt && cancelAt < end ? cancelAt : end);

  /** No access: the period/trial/grace ended at `end` (never in the future). */
  const ended = (end: Date): SubscriptionUpdate => {
    const at = earlier(now, end);
    // Ended during (or right at the end of) the free trial → the app shows "your trial has ended".
    const duringTrial = trialEnd !== null && at.getTime() <= trialEnd.getTime() + 60_000;
    return { ...base, status: 'expired', trialEndsAt: duringTrial ? at : null, currentPeriodEndsAt: at, willRenew: false };
  };

  switch (sub.status) {
    case 'trialing': {
      const end = periodEnd && trialEnd ? earlier(trialEnd, periodEnd) : (trialEnd ?? periodEnd);
      if (!end) return ended(now);
      const access = limit(end);
      if (access <= now) return ended(access);
      // trialEndsAt === currentPeriodEndsAt marks a trial period (trial limits apply, see entitlements).
      return { ...base, status: cancelling ? 'cancelled' : 'trialing', trialEndsAt: access, currentPeriodEndsAt: access, willRenew: !cancelling };
    }
    case 'active': {
      if (!periodEnd) return ended(now);
      const access = limit(periodEnd);
      if (access <= now) return ended(access);
      return { ...base, status: cancelling ? 'cancelled' : 'active', trialEndsAt: null, currentPeriodEndsAt: access, willRenew: !cancelling };
    }
    case 'past_due': {
      // The renewal invoice was created when the new period started; Stripe is now retrying the payment.
      const graceEnd = earlier(new Date((periodStart ?? now).getTime() + graceDays * DAY), periodEnd);
      if (graceEnd <= now) return ended(graceEnd);
      return { ...base, status: 'active', trialEndsAt: null, currentPeriodEndsAt: graceEnd, willRenew: true };
    }
    case 'incomplete':
      return null; // first payment not confirmed: grant nothing; Stripe will send the next state
    case 'canceled':
    case 'incomplete_expired':
      return ended(ms(sub.endedAt) ?? ms(sub.canceledAt) ?? now);
    default:
      // unpaid, paused, or a status this code does not know: no access (fail closed).
      return ended(now);
  }
}

/**
 * The provider object registered next to Apple and Google (catalog, cross-store rules). Web
 * subscriptions never arrive as a purchase proof: they start from a Checkout Session and are
 * confirmed by Stripe's webhook, so `purchase` explains that instead of granting anything.
 */
export function createStripeProvider(): BillingProvider {
  return {
    id: 'stripe',
    // Not the mock provider: no development tools. (Stripe test mode is obvious on Stripe's own pages.)
    testMode: false,
    async purchase() {
      throw new HttpError(400, 'Web subscriptions start from Stripe Checkout.', 'use_checkout');
    },
    async restore() {
      return null; // nothing to restore: Stripe's webhook keeps the subscription in sync
    },
  };
}
