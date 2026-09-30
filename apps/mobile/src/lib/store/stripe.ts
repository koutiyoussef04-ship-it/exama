/**
 * Web subscriptions through Stripe Checkout. WEB ONLY — the iOS/Android apps subscribe through the
 * App Store / Google Play and never reach this file (getStoreClient returns null for Stripe there).
 *
 * The browser asks the server for a Checkout page (naming only a plan and an interval), then leaves
 * for it. Nothing is granted here: access appears when Stripe's webhook reaches the server, which the
 * return page (app/checkout.tsx) waits for by re-reading GET /billing/status.
 */
import type { Entitlement } from '@study/shared';
import { api, ApiError } from '../api';
import { isStripeUrl } from './offers';
import type { StoreClient } from './types';

/** Sends the browser to a Stripe-hosted page (Checkout or the Customer Portal). */
export function goToStripe(url: string): void {
  // Defence in depth: only ever navigate to stripe.com, whatever an API answer says.
  if (!isStripeUrl(url)) throw new ApiError(502, 'Unexpected billing address', 'billing_unavailable');
  window.location.assign(url);
}

export const stripeStore: StoreClient = {
  provider: 'stripe',
  async purchase(plan) {
    const { url } = await api.stripeCheckout(plan.tier, plan.period);
    goToStripe(url);
    // The page is unloading: this never resolves, so the button keeps its busy state until Stripe opens.
    return new Promise<Entitlement>(() => {});
  },
  // Nothing to restore on the web: the server keeps the subscription in sync with Stripe.
  restore: () => api.getEntitlement(),
};
