/**
 * Pure store helpers (no native imports, unit-tested in test/store.test.ts).
 *
 * Google Play model (see packages/shared/src/billing.ts): one subscription product per tier,
 * one base plan per period ("monthly", "annual") and a "free-trial" offer on each base plan.
 * Play only returns offers the user is eligible for, so the trial offer is missing for someone
 * who already had it — the base plan is then used.
 */
import { GOOGLE_TRIAL_OFFER_ID, type BillingProviderId } from '@study/shared';

/** The fields we read from expo-iap's SubscriptionOffer (Android). */
export type OfferLike = {
  id?: string | null;
  basePlanIdAndroid?: string | null;
  offerTokenAndroid?: string | null;
  paymentMode?: string | null;
  displayPrice?: string | null;
  pricingPhasesAndroid?: { pricingPhaseList: { priceAmountMicros: string; formattedPrice: string }[] } | null;
};

const phases = (o: OfferLike) => o.pricingPhasesAndroid?.pricingPhaseList ?? [];
const isFreeTrial = (o: OfferLike) => o.id === GOOGLE_TRIAL_OFFER_ID || o.paymentMode === 'free-trial' || phases(o).some((p) => p.priceAmountMicros === '0');

function offersFor(offers: OfferLike[], basePlanId: string) {
  const mine = offers.filter((o) => o.basePlanIdAndroid === basePlanId && !!o.offerTokenAndroid);
  const trial = mine.find(isFreeTrial) ?? null;
  // The base plan itself (Play reports it without an offer id, or with the base plan id).
  const base = mine.find((o) => !isFreeTrial(o) && (!o.id || o.id === basePlanId)) ?? mine.find((o) => !isFreeTrial(o)) ?? null;
  return { trial, base };
}

/** Offer token to buy: the free trial when the server says the account is eligible, else the base plan. */
export function pickGoogleOfferToken(offers: OfferLike[], basePlanId: string, withTrial: boolean): string | null {
  const { trial, base } = offersFor(offers, basePlanId);
  return (withTrial && trial ? trial : base)?.offerTokenAndroid ?? null;
}

/** Localized recurring price of a base plan, as Google Play formats it ("12,99 €"). */
export function googleRecurringPrice(offers: OfferLike[], basePlanId: string): string | null {
  const { trial, base } = offersFor(offers, basePlanId);
  const o = base ?? trial;
  if (!o) return null;
  const paid = phases(o).filter((p) => p.priceAmountMicros !== '0');
  return paid.at(-1)?.formattedPrice ?? (base ? (base.displayPrice ?? null) : null);
}

/** Brand name of a store, for "managed by …" copy. Brand names are not translated. */
export function storeName(provider: BillingProviderId | null | undefined, platformOS?: string): string {
  if (provider === 'google') return 'Google Play';
  if (provider === 'apple') return 'App Store';
  return platformOS === 'android' ? 'Google Play' : 'App Store';
}

/** A real store subscription (billed and managed by Apple or Google, not by the app). */
export const isStoreProvider = (p: BillingProviderId | null | undefined): p is 'apple' | 'google' => p === 'apple' || p === 'google';

/**
 * Store (expo-iap / OpenIAP) error code → the app's error code (translated in errors.codes).
 * `purchase_cancelled` is never shown: the user closed the store sheet.
 */
export function storeErrorCode(code: string | undefined): string {
  switch (code) {
    case 'user-cancelled':
      return 'purchase_cancelled';
    case 'deferred-payment': // Ask to Buy / slow payment method: access starts when the store confirms
    case 'pending':
      return 'purchase_pending';
    case 'already-owned':
      return 'already_subscribed';
    case 'item-unavailable':
    case 'sku-not-found':
    case 'empty-sku-list':
    case 'sku-offer-mismatch':
      return 'store_product_missing';
    case 'network-error':
    case 'service-error':
    case 'service-disconnected':
    case 'service-timeout':
    case 'billing-unavailable':
    case 'iap-not-available':
    case 'not-prepared':
    case 'init-connection':
    case 'connection-closed':
    case 'remote-error':
      return 'store_unavailable';
    default:
      return 'purchase_failed';
  }
}

/** The fields we read from an expo-iap Purchase (Android) to find the subscription being replaced. */
export type OwnedPurchaseLike = {
  productId: string;
  purchaseToken?: string | null;
  purchaseState?: string;
  currentPlanId?: string | null;
  obfuscatedAccountIdAndroid?: string | null;
};

/**
 * Google Play: changing plan (Student ↔ Pro, monthly ↔ yearly) must REPLACE the current subscription,
 * otherwise Play starts a second one and bills both. Returns the replacement parameters for
 * requestPurchase, or null for a first purchase. Only this Exama account's own subscription is replaced.
 */
export function googleReplacement(
  owned: OwnedPurchaseLike[],
  target: { productId: string; basePlanId: string },
  productIds: readonly string[],
  userId: string,
): { purchaseToken: string; subscriptionProductReplacementParams: { oldProductId: string; replacementMode: 'with-time-proration' } } | null {
  const current = owned.find(
    (p) =>
      productIds.includes(p.productId) &&
      !!p.purchaseToken &&
      p.purchaseState !== 'pending' &&
      (!p.obfuscatedAccountIdAndroid || p.obfuscatedAccountIdAndroid.toLowerCase() === userId.toLowerCase()),
  );
  if (!current?.purchaseToken) return null;
  if (current.productId === target.productId && current.currentPlanId === target.basePlanId) return null; // same plan: nothing to replace
  // Remaining time is credited towards the new plan; the change takes effect immediately.
  return { purchaseToken: current.purchaseToken, subscriptionProductReplacementParams: { oldProductId: current.productId, replacementMode: 'with-time-proration' } };
}
