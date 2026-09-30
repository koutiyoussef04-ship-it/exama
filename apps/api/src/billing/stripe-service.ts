/**
 * Stripe web billing — the stateful part: the Stripe Customer of each Exama user, Checkout, the
 * Customer Portal, the webhook, and cleanup when an account is deleted.
 *
 * Principles (see also providers/stripe.ts for the access rules):
 *  - The webhook is the only thing that grants access. Returning from Checkout proves nothing: the
 *    app polls GET /billing/status, which is computed from the subscription row the webhook writes.
 *  - The server decides everything that matters: which Price, whether the trial applies, who the
 *    Customer is. The browser sends a plan and an interval, nothing else.
 *  - Webhook events are verified (signature over the raw body), de-duplicated (stripe_events), and
 *    handled by RE-FETCHING the subscription from Stripe, so late, repeated or out-of-order events
 *    all converge on Stripe's current state.
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { BILLING_PERIODS, PAID_TIERS, TRIAL_DAYS, type BillingPeriod, type BillingRedirect, type PaidTier, type PlanId } from '@study/shared';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { stripeCustomers, stripeEvents, subscriptions, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { isOwner } from './entitlements.js';
import { CHECKOUT_TTL_SECONDS, mapStripeSubscription, SUBSCRIPTION_BLOCKS_CHECKOUT, SUBSCRIPTION_IS_RUNNING, type StripeBilling } from './providers/stripe.js';
import type { StripeSubscriptionLike } from './providers/stripe-api.js';
import { assertNotSubscribedElsewhere } from './purchases.js';
import { accessEndsAt, applySubscriptionUpdate, getSubscription, subscriptionEventProps, type ChangeReason, type Exec, type SubscriptionRow, type SubscriptionUpdate } from './subscriptions.js';

// ---------------------------------------------------------------- limits

/** Burst protection (per user, per process) on the calls that create Stripe objects. */
export const checkoutLimiter = new RateLimiter(10, 10 * 60_000, 'Too many checkout attempts. Please wait a few minutes and try again.');
export const portalLimiter = new RateLimiter(20, 10 * 60_000, 'Too many requests. Please wait a few minutes and try again.');
/** Stripe events are small; anything bigger is not from Stripe. */
export const MAX_WEBHOOK_BYTES = 1_000_000;
/** An event claimed longer ago than this and never finished is retried (the handler crashed). */
const CLAIM_TTL_MS = 2 * 60_000;

const isLive = (row: SubscriptionRow, now = new Date()) => row.status !== 'expired' && (accessEndsAt(row)?.getTime() ?? 0) > now.getTime();
const lock = (key: string) => sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- customers

export async function stripeCustomerIdFor(userId: string, exec: Exec = db): Promise<string | null> {
  const [row] = await exec.select({ id: stripeCustomers.stripeCustomerId }).from(stripeCustomers).where(eq(stripeCustomers.userId, userId));
  return row?.id ?? null;
}

/**
 * The user's Stripe Customer, created once. Safe under concurrent requests: creation is serialized per
 * user (advisory lock), Stripe's idempotency key returns the same Customer for repeated creates, and the
 * table's primary key / unique constraint make a second Customer for one user impossible.
 */
export async function getOrCreateStripeCustomer(ctx: StripeBilling, userId: string): Promise<string> {
  const existing = await stripeCustomerIdFor(userId);
  if (existing) return existing;
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  return db.transaction(async (tx) => {
    await tx.execute(lock(`stripe-customer-create:${userId}`));
    const again = await stripeCustomerIdFor(userId, tx);
    if (again) return again;
    const customerId = await ctx.api.createCustomer({ userId, email: user.email, name: user.name }, `exama-customer-${userId}`);
    await tx.insert(stripeCustomers).values({ userId, stripeCustomerId: customerId }).onConflictDoNothing();
    return (await stripeCustomerIdFor(userId, tx)) ?? customerId;
  });
}

// ---------------------------------------------------------------- checkout

/** Validates the request against the plan/interval allowlist. Anything else in the body is ignored. */
export function parseCheckoutInput(body: unknown): { plan: PaidTier; interval: BillingPeriod; planId: PlanId } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.plan !== 'string' || !(PAID_TIERS as readonly string[]).includes(b.plan)) throw new HttpError(400, 'Unknown plan.', 'invalid_plan');
  if (typeof b.interval !== 'string' || !(BILLING_PERIODS as readonly string[]).includes(b.interval)) throw new HttpError(400, 'Unknown billing interval.', 'invalid_interval');
  const plan = b.plan as PaidTier;
  const interval = b.interval as BillingPeriod;
  return { plan, interval, planId: `${plan}_${interval}` as PlanId };
}

const alreadySubscribed = () => new HttpError(409, 'You already have an Exama subscription. Manage it from your account.', 'already_subscribed', { provider: 'stripe' });

/**
 * POST /billing/stripe/checkout. Returns the Stripe-hosted Checkout page to redirect to.
 * The price comes from server configuration; the trial is granted only to an account that never had one.
 */
export async function createStripeCheckout(ctx: StripeBilling, userId: string, body: unknown): Promise<BillingRedirect> {
  const { planId } = parseCheckoutInput(body);
  if (await isOwner(userId)) throw new HttpError(409, 'This account already has full access.', 'full_access');
  checkoutLimiter.take(userId);

  // One subscription per account, whichever source sold it. Apple/Google subscriptions are never touched.
  const current = await getSubscription(userId);
  assertNotSubscribedElsewhere(current, 'stripe');
  if (current?.provider === 'stripe' && isLive(current)) throw alreadySubscribed();

  const customerId = await getOrCreateStripeCustomer(ctx, userId);
  // Our database can lag behind Stripe (the webhook may not have arrived yet): ask Stripe as well.
  const existing = await ctx.api.listSubscriptions(customerId);
  if (existing.some((s) => SUBSCRIPTION_BLOCKS_CHECKOUT.has(s.status))) throw alreadySubscribed();

  // One free trial per account, across all sources (same rule as the store providers).
  const trialEligible = !current?.trialUsed && !existing.some((s) => s.trialEnd !== null);
  const session = await ctx.api.createCheckoutSession(
    {
      customerId,
      userId,
      planId,
      priceId: ctx.prices[planId],
      trialDays: trialEligible ? TRIAL_DAYS : null,
      successUrl: ctx.successUrl,
      cancelUrl: ctx.cancelUrl,
      expiresAt: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
    },
    // Repeated clicks within a minute get the same Checkout Session instead of a new one.
    `checkout-${userId}-${planId}-${trialEligible ? 't' : 'p'}-${Math.floor(Date.now() / 60_000)}`,
  );
  return { url: session.url };
}

// ---------------------------------------------------------------- customer portal

/**
 * POST /billing/stripe/portal. The Customer is always the signed-in user's own (looked up by user id);
 * nothing the client sends can point it at another customer.
 */
export async function createStripePortal(ctx: StripeBilling, userId: string): Promise<BillingRedirect> {
  portalLimiter.take(userId);
  const customerId = await stripeCustomerIdFor(userId);
  if (!customerId) throw new HttpError(404, 'There is no web billing account for this user.', 'no_billing_account');
  const session = await ctx.api.createPortalSession({ customerId, returnUrl: ctx.portalReturnUrl });
  return { url: session.url };
}

// ---------------------------------------------------------------- webhook

const SUBSCRIPTION_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed']);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed']);
/** The events to subscribe the webhook endpoint to (documented in docs/stripe/stripe-web-billing.md). */
export const STRIPE_WEBHOOK_EVENTS = ['checkout.session.completed', ...SUBSCRIPTION_EVENTS, ...INVOICE_EVENTS] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? (v && typeof v === 'object' ? str((v as { id?: unknown }).id) : null);

/** The subscription an invoice belongs to: `parent.subscription_details.subscription` (current API), else `subscription` (older). */
export function invoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
  return idOf(parent?.subscription_details?.subscription) ?? idOf(invoice.subscription);
}

export type WebhookResult = { received: true; handled: boolean; duplicate?: boolean; note?: string };

/**
 * POST /billing/stripe/webhook. `rawBody` must be the exact bytes Stripe sent (the signature covers them).
 * Throws 400 `invalid_signature` for anything not signed by Stripe with our webhook secret.
 */
export async function handleStripeWebhook(ctx: StripeBilling, rawBody: Buffer, signature: string | undefined): Promise<WebhookResult> {
  if (!signature) throw new HttpError(400, 'Missing Stripe signature.', 'invalid_signature');
  const event = ctx.api.constructEvent(rawBody, signature);

  // Only the events this integration uses are recorded; Stripe is told "received" for the rest.
  if (!SUBSCRIPTION_EVENTS.has(event.type) && !INVOICE_EVENTS.has(event.type) && event.type !== 'checkout.session.completed') {
    return { received: true, handled: false };
  }

  const claim = await claimEvent(event.id, event.type);
  if (claim === 'duplicate') return { received: true, handled: false, duplicate: true };
  // Another delivery of this event is being processed right now: ask Stripe to retry later.
  if (claim === 'busy') throw new HttpError(409, 'This event is already being processed.', 'event_in_progress');

  try {
    const obj = event.object;
    let result: { handled: boolean; note?: string };
    if (event.type === 'checkout.session.completed') {
      const subscriptionId = obj.mode === 'subscription' ? idOf(obj.subscription) : null;
      const metadataUser = (obj.metadata as { exama_user_id?: unknown } | null | undefined)?.exama_user_id;
      result = subscriptionId
        ? await syncSubscription(ctx, subscriptionId, { customerId: idOf(obj.customer), userHint: str(obj.client_reference_id) ?? str(metadataUser) })
        : { handled: false, note: 'not_a_subscription_checkout' };
    } else if (INVOICE_EVENTS.has(event.type)) {
      const subscriptionId = invoiceSubscriptionId(obj);
      result = subscriptionId ? await syncSubscription(ctx, subscriptionId, { customerId: idOf(obj.customer) }) : { handled: false, note: 'invoice_without_subscription' };
    } else {
      const subscriptionId = str(obj.id);
      result = subscriptionId ? await syncSubscription(ctx, subscriptionId, { customerId: idOf(obj.customer) }) : { handled: false, note: 'malformed_event' };
    }
    await db.update(stripeEvents).set({ processedAt: new Date() }).where(eq(stripeEvents.id, event.id));
    return { received: true, ...result };
  } catch (err) {
    // Let Stripe's retry (or the next delivery) claim the event again right away.
    await db.update(stripeEvents).set({ claimedAt: new Date(0) }).where(and(eq(stripeEvents.id, event.id), isNull(stripeEvents.processedAt)));
    throw err;
  }
}

/** First delivery → 'claimed'. Already processed → 'duplicate'. Being processed, or a crashed attempt (stale claim) → 'busy' / 'claimed'. */
async function claimEvent(eventId: string, type: string): Promise<'claimed' | 'duplicate' | 'busy'> {
  const [inserted] = await db.insert(stripeEvents).values({ id: eventId, type }).onConflictDoNothing().returning({ id: stripeEvents.id });
  if (inserted) return 'claimed';
  const [reclaimed] = await db
    .update(stripeEvents)
    .set({ claimedAt: new Date() })
    .where(and(eq(stripeEvents.id, eventId), isNull(stripeEvents.processedAt), lt(stripeEvents.claimedAt, new Date(Date.now() - CLAIM_TTL_MS))))
    .returning({ id: stripeEvents.id });
  if (reclaimed) return 'claimed';
  const [row] = await db.select({ processedAt: stripeEvents.processedAt }).from(stripeEvents).where(eq(stripeEvents.id, eventId));
  return row?.processedAt ? 'duplicate' : 'busy';
}

/** Which Exama account a Stripe subscription belongs to: its Customer's mapping first, then what we put in its metadata. */
async function resolveUser(exec: Exec, sub: StripeSubscriptionLike, hint?: string | null): Promise<string | null> {
  const claimed = (sub.metadata.exama_user_id ?? hint ?? '').toLowerCase();
  const [byCustomer] = await exec.select({ userId: stripeCustomers.userId }).from(stripeCustomers).where(eq(stripeCustomers.stripeCustomerId, sub.customerId));
  if (byCustomer) {
    if (claimed && claimed !== byCustomer.userId.toLowerCase()) console.warn(`[stripe] subscription ${sub.id}: metadata names another account than its Customer — using the Customer's`);
    return byCustomer.userId;
  }
  if (UUID.test(claimed) && sub.customerId) {
    const [user] = await exec.select({ id: users.id }).from(users).where(eq(users.id, claimed));
    if (user) {
      const [mapped] = await exec.select({ id: stripeCustomers.stripeCustomerId }).from(stripeCustomers).where(eq(stripeCustomers.userId, user.id));
      if (mapped) {
        console.warn(`[stripe] subscription ${sub.id} comes from a Customer that is not the account's own — ignored`);
        return null;
      }
      await exec.insert(stripeCustomers).values({ userId: user.id, stripeCustomerId: sub.customerId }).onConflictDoNothing();
      return user.id;
    }
  }
  const [bySub] = await exec.select({ userId: subscriptions.userId }).from(subscriptions).where(and(eq(subscriptions.provider, 'stripe'), eq(subscriptions.providerRef, sub.id)));
  return bySub?.userId ?? null;
}

/**
 * A late or foreign event must never overwrite a live subscription. Returns 'apply' when the update
 * may be stored. When the account already has another live subscription (Apple, Google, or another
 * Stripe one from repeated checkout), the NEW Stripe subscription is cancelled so the customer is
 * not billed twice — Apple/Google subscriptions are never cancelled here.
 */
async function checkConflict(ctx: StripeBilling, sub: StripeSubscriptionLike, update: SubscriptionUpdate, previous: SubscriptionRow | null): Promise<'apply' | 'ignored' | 'duplicate_cancelled'> {
  if (!previous || previous.provider === 'mock' || !isLive(previous)) return 'apply';
  if (previous.provider === 'stripe' && previous.providerRef === sub.id) return 'apply';
  if (update.status === 'expired') return 'ignored'; // another subscription ending must not remove a live one
  if (previous.provider === 'stripe') {
    const stored = previous.providerRef ? await ctx.api.retrieveSubscription(previous.providerRef) : null;
    if (!stored || !SUBSCRIPTION_IS_RUNNING.has(stored.status)) return 'apply'; // the stored one already ended in Stripe: this replaces it
  }
  console.error(`[stripe] duplicate subscription ${sub.id}: the account already has a live ${previous.provider} subscription. Cancelling ${sub.id}; refund any charge in the Stripe Dashboard.`);
  await ctx.api.cancelSubscription(sub.id).catch((err) => console.error('[stripe] could not cancel the duplicate subscription', err instanceof Error ? err.message : err));
  return 'duplicate_cancelled';
}

/** Which analytics event a state change represents. */
export function reasonFor(previous: SubscriptionRow | null, update: SubscriptionUpdate): ChangeReason {
  if (update.status === 'expired') return 'silent';
  const sameLive = !!previous && previous.provider === 'stripe' && previous.providerRef === update.providerRef && previous.status !== 'expired';
  if (!sameLive) return update.status === 'trialing' ? 'trial' : update.status === 'active' ? 'purchase' : 'silent';
  if (previous.willRenew && !update.willRenew) return 'cancel';
  if (!previous.willRenew && update.willRenew) return 'restore';
  if (previous.status === 'trialing' && update.status === 'active') return 'purchase'; // the trial converted to paid
  if (previous.planId !== update.planId) return 'purchase'; // plan change in the Customer Portal
  return 'silent';
}

/**
 * Re-reads the subscription from Stripe and stores its current state. Serialized per Customer, and run
 * on one transaction, so concurrent deliveries cannot apply an older state over a newer one.
 */
async function syncSubscription(ctx: StripeBilling, subscriptionId: string, opts: { customerId?: string | null; userHint?: string | null }): Promise<{ handled: boolean; note?: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(lock(`stripe-sync:${opts.customerId ?? subscriptionId}`));
    const sub = await ctx.api.retrieveSubscription(subscriptionId);
    if (!sub) return { handled: false, note: 'subscription_not_found' };

    const userId = await resolveUser(tx, sub, opts.userHint);
    if (!userId) {
      console.warn(`[stripe] subscription ${sub.id} belongs to no known Exama account`);
      return { handled: false, note: 'unknown_account' };
    }
    const update = mapStripeSubscription(sub, ctx.prices);
    if (!update) return { handled: false, note: 'nothing_to_record' }; // not one of our Prices, or the first payment is still pending

    const previous = await getSubscription(userId, tx);
    const verdict = await checkConflict(ctx, sub, update, previous);
    if (verdict !== 'apply') return { handled: false, note: verdict };

    await applySubscriptionUpdate(userId, update, reasonFor(previous, update), tx);
    if (update.status === 'expired' && previous && previous.status !== 'expired' && previous.provider === 'stripe' && previous.providerRef === sub.id) {
      void track('subscription_expired', userId, { ...subscriptionEventProps(update.planId, 'stripe', update.environment), was_trial: previous.status === 'trialing' });
    }
    return { handled: true };
  });
}

// ---------------------------------------------------------------- account deletion

/**
 * Deleting an Exama account must not leave a Stripe subscription billing a person who no longer has an
 * account. (Apple/Google subscriptions cannot be cancelled by us; Stripe's can, so we do.) Called BEFORE
 * anything is deleted: if Stripe cannot be reached the deletion is refused and nothing changes.
 */
export async function cancelStripeBillingForAccountDeletion(ctx: StripeBilling | null, userId: string): Promise<void> {
  const customerId = await stripeCustomerIdFor(userId);
  if (!customerId) return;
  if (!ctx) {
    // Stripe is switched off on this server but the account has web billing: only refuse if it could still bill.
    const current = await getSubscription(userId);
    if (current?.provider === 'stripe' && isLive(current)) {
      throw new HttpError(503, 'Billing is temporarily unavailable, so the account cannot be deleted yet. Please try again shortly.', 'billing_unavailable');
    }
    return;
  }
  try {
    await ctx.api.deleteCustomer(customerId); // also cancels the customer's subscriptions immediately
  } catch (err) {
    console.error(`[stripe] could not delete Customer ${customerId} for an account deletion`);
    if (err instanceof HttpError) throw new HttpError(502, 'We could not cancel your subscription, so your account was not deleted. Please try again.', 'billing_cancel_failed');
    throw err;
  }
}
