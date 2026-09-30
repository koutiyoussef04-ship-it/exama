/**
 * Stripe API boundary. The only file that imports the Stripe SDK.
 *
 * Everything else (mapping, Checkout, webhooks, account deletion — stripe.ts) talks to the small
 * `StripeApi` interface and to plain shapes (`StripeSubscriptionLike`, `StripeEventLike`), so it can be
 * unit-tested with a fake and is not tied to one Stripe API version. Differences between API versions
 * (for example, subscription period dates moved from the subscription to its items) are absorbed here.
 *
 * Secrets: the secret key and the webhook signing secret are passed in from server configuration and
 * never logged, returned or sent anywhere except to Stripe.
 */
import Stripe from 'stripe';
import { HttpError } from '../../lib/errors.js';

/** One subscription item (we sell exactly one Price per subscription). Dates are Unix seconds. */
export type StripeItemLike = { priceId: string; currentPeriodStart: number | null; currentPeriodEnd: number | null };

/** The subscription fields Exama uses, version-independent. Dates are Unix seconds. */
export type StripeSubscriptionLike = {
  id: string;
  /** Stripe's own status: trialing | active | past_due | unpaid | canceled | incomplete | incomplete_expired | paused. */
  status: string;
  customerId: string;
  livemode: boolean;
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  endedAt: number | null;
  trialEnd: number | null;
  items: StripeItemLike[];
  metadata: Record<string, string>;
};

/** A verified webhook event. `object` is Stripe's payload; only ids are read from it (state is re-fetched). */
export type StripeEventLike = { id: string; type: string; livemode: boolean; object: Record<string, unknown> };

export type CheckoutSessionInput = {
  customerId: string;
  userId: string;
  planId: string;
  priceId: string;
  /** null = no trial (the account already used it). */
  trialDays: number | null;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds; the session stops being payable after this. */
  expiresAt: number;
};

export interface StripeApi {
  /** True for live-mode keys (sk_live_/rk_live_); false in test mode. */
  readonly livemode: boolean;
  /** Verifies the `Stripe-Signature` header against the RAW body. Throws HttpError 400 `invalid_signature`. */
  constructEvent(rawBody: Buffer, signature: string): StripeEventLike;
  /** null when Stripe has no such subscription. */
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike | null>;
  /** Every subscription of a customer, any status. */
  listSubscriptions(customerId: string): Promise<StripeSubscriptionLike[]>;
  /** Returns the Customer id. The idempotency key makes concurrent calls for one user return one Customer. */
  createCustomer(input: { userId: string; email: string; name: string }, idempotencyKey: string): Promise<string>;
  createCheckoutSession(input: CheckoutSessionInput, idempotencyKey: string): Promise<{ id: string; url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Cancels a subscription immediately. Already-cancelled/missing is not an error. */
  cancelSubscription(id: string): Promise<void>;
  /** Deletes the Customer (Stripe also cancels its subscriptions). Already-missing is not an error. */
  deleteCustomer(id: string): Promise<void>;
}

const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null);

/** Stripe subscription (current API) → the plain shape. Period dates live on the items. */
export function toSubscriptionLike(s: Stripe.Subscription): StripeSubscriptionLike {
  const legacy = s as unknown as { current_period_start?: number; current_period_end?: number }; // pre-2025-03 API versions
  return {
    id: s.id,
    status: s.status,
    customerId: idOf(s.customer) ?? '',
    livemode: s.livemode,
    cancelAt: s.cancel_at ?? null,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
    canceledAt: s.canceled_at ?? null,
    endedAt: s.ended_at ?? null,
    trialEnd: s.trial_end ?? null,
    items: (s.items?.data ?? []).map((i) => ({
      priceId: i.price?.id ?? '',
      currentPeriodStart: i.current_period_start ?? legacy.current_period_start ?? null,
      currentPeriodEnd: i.current_period_end ?? legacy.current_period_end ?? null,
    })),
    metadata: { ...(s.metadata ?? {}) },
  };
}

const isMissing = (err: unknown) => err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing';

/** Stripe failed or was unreachable: the request can be retried, nothing was changed on our side. */
function unavailable(err: unknown): never {
  if (err instanceof HttpError) throw err;
  // Log the Stripe error code/type only — never the request, which can contain customer details.
  const e = err as { type?: string; code?: string; statusCode?: number };
  console.error(`[stripe] API call failed (${e.type ?? 'error'}${e.code ? `/${e.code}` : ''}${e.statusCode ? ` ${e.statusCode}` : ''})`);
  throw new HttpError(502, 'Billing is temporarily unavailable. Please try again in a moment.', 'billing_unavailable');
}

export function createStripeApi(opts: { secretKey: string; webhookSecret: string }): StripeApi {
  const stripe = new Stripe(opts.secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Exama API' } });

  return {
    livemode: /^(sk|rk)_live_/.test(opts.secretKey),

    constructEvent(rawBody, signature) {
      let event: Stripe.Event;
      try {
        // Verifies the HMAC over the exact bytes received, and rejects events older than 5 minutes (replay).
        event = stripe.webhooks.constructEvent(rawBody, signature, opts.webhookSecret);
      } catch {
        throw new HttpError(400, 'Invalid Stripe signature.', 'invalid_signature');
      }
      return { id: event.id, type: event.type, livemode: event.livemode, object: event.data.object as unknown as Record<string, unknown> };
    },

    async retrieveSubscription(id) {
      try {
        return toSubscriptionLike(await stripe.subscriptions.retrieve(id));
      } catch (err) {
        if (isMissing(err)) return null;
        return unavailable(err);
      }
    },

    async listSubscriptions(customerId) {
      try {
        const out: StripeSubscriptionLike[] = [];
        // A customer has a handful of subscriptions at most; cap the walk anyway.
        for await (const s of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
          out.push(toSubscriptionLike(s));
          if (out.length >= 200) break;
        }
        return out;
      } catch (err) {
        return unavailable(err);
      }
    },

    async createCustomer(input, idempotencyKey) {
      try {
        const c = await stripe.customers.create({ email: input.email, name: input.name, metadata: { exama_user_id: input.userId } }, { idempotencyKey });
        return c.id;
      } catch (err) {
        return unavailable(err);
      }
    },

    async createCheckoutSession(input, idempotencyKey) {
      try {
        const metadata = { exama_user_id: input.userId, exama_plan_id: input.planId };
        const session = await stripe.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: input.customerId,
            client_reference_id: input.userId,
            line_items: [{ price: input.priceId, quantity: 1 }],
            // Always collect a payment method, also for the free trial, so the subscription converts to
            // paid billing by itself when the trial ends (no second checkout).
            payment_method_collection: 'always',
            subscription_data: {
              metadata,
              ...(input.trialDays
                ? {
                    trial_period_days: input.trialDays,
                    // If the trial ever ended without a payment method, end the subscription instead of billing or pausing.
                    trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
                  }
                : {}),
            },
            metadata,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            expires_at: input.expiresAt,
          },
          { idempotencyKey },
        );
        if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout page.', 'billing_unavailable');
        return { id: session.id, url: session.url };
      } catch (err) {
        return unavailable(err);
      }
    },

    async createPortalSession(input) {
      try {
        const s = await stripe.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
        return { url: s.url };
      } catch (err) {
        return unavailable(err);
      }
    },

    async cancelSubscription(id) {
      try {
        await stripe.subscriptions.cancel(id);
      } catch (err) {
        if (isMissing(err)) return;
        return unavailable(err);
      }
    },

    async deleteCustomer(id) {
      try {
        await stripe.customers.del(id);
      } catch (err) {
        if (isMissing(err)) return;
        return unavailable(err);
      }
    },
  };
}
