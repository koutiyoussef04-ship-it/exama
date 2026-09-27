/**
 * App Store (iOS) and Google Play (Android) purchases through expo-iap — one implementation for
 * both stores. The web build uses native.web.ts instead (no in-app purchases on the web).
 *
 * The app only OBTAINS a purchase proof; the server verifies it with the store and decides access:
 *   1. requestPurchase — iOS: appAccountToken = user id; Android: obfuscatedAccountId = user id
 *      and the offer token of the chosen base plan (or its free-trial offer).
 *   2. the proof goes to the API (iOS: StoreKit 2 signed transaction; Android: purchase token).
 *   3. finishTransaction ONLY after the server accepted it. On Android that also acknowledges the
 *      purchase (the server acknowledges first); a purchase the server refused is never
 *      acknowledged, so Google refunds it automatically.
 *
 * expo-iap has native code: it's loaded lazily so Expo Go (which doesn't include it) still runs the
 * rest of the app — purchases then report `store_dev_build_required`.
 */
import { PLANS, type BillingProviderId, type Entitlement, type Plan, type PlanId } from '@study/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { api, ApiError } from '../api';
import { log } from '../log';
import { googleRecurringPrice, googleReplacement, pickGoogleOfferToken, storeErrorCode, type OfferLike } from './offers';
import type { StoreClient } from './types';

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

let iapModule: Iap | null | undefined;
function loadIap(): Iap | null {
  if (iapModule !== undefined) return iapModule;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return (iapModule = null); // Expo Go
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    iapModule = require('expo-iap') as Iap;
  } catch {
    iapModule = null; // a build without the native module
  }
  return iapModule;
}

const storeError = (code: string, status = code === 'purchase_cancelled' ? 499 : 409) => new ApiError(status, code, code);

function requireIap(): Iap {
  const m = loadIap();
  if (!m) throw storeError('store_dev_build_required', 503);
  return m;
}

let connecting: Promise<unknown> | null = null;
async function connected(m: Iap) {
  connecting ??= m.initConnection().catch((err: unknown) => {
    connecting = null; // retry next time
    throw err;
  });
  try {
    await connecting;
  } catch (err) {
    throw toAppError(err);
  }
}

/** Any store/native error → ApiError with a translatable code. */
function toAppError(err: unknown): Error {
  if (err instanceof ApiError) return err;
  const code = (err as { code?: string } | null)?.code;
  const mapped = storeErrorCode(code);
  if (mapped !== 'purchase_cancelled') log.warn('store', `store error ${code ?? 'unknown'}`);
  return storeError(mapped, mapped === 'store_unavailable' ? 503 : undefined);
}

const skuOf = (provider: 'apple' | 'google', plan: Plan) => (provider === 'apple' ? plan.appleProductId : plan.googleProductId);

/** Resolves with the store's purchase for `sku` (events: purchaseUpdated / purchaseError). */
function awaitPurchase(m: Iap, sku: string, start: () => Promise<unknown>): Promise<Purchase> {
  return new Promise<Purchase>((resolve, reject) => {
    const subs: { remove(): void }[] = [];
    const done = () => subs.forEach((s) => s.remove());
    subs.push(
      m.purchaseUpdatedListener((p) => {
        if (p.productId !== sku) return;
        done();
        resolve(p);
      }),
      m.purchaseErrorListener((e) => {
        done();
        reject(toAppError(e));
      }),
    );
    start().catch((err: unknown) => {
      done();
      reject(toAppError(err));
    });
  });
}

async function finish(m: Iap, purchase: Purchase) {
  // Never throws into the UI: access is already granted server-side at this point.
  await m.finishTransaction({ purchase, isConsumable: false }).catch(() => log.warn('store', 'finishTransaction failed'));
}

export function createNativeStore(provider: 'apple' | 'google'): StoreClient | null {
  if (!loadIap()) return null;

  /** Send one purchase to the server. */
  const report = (p: Purchase): Promise<Entitlement> => {
    if (!p.purchaseToken) throw storeError('purchase_failed');
    return provider === 'apple' ? api.applePurchase(p.purchaseToken) : api.googlePurchase(p.purchaseToken, p.productId);
  };

  return {
    provider,

    async purchase(plan, { withTrial, userId }) {
      const m = requireIap();
      await connected(m);
      const sku = skuOf(provider, plan);
      let purchase: Purchase;
      if (provider === 'apple') {
        // StoreKit applies the introductory free trial automatically when the Apple ID is eligible.
        purchase = await awaitPurchase(m, sku, () => m.requestPurchase({ type: 'subs', request: { apple: { sku, appAccountToken: userId } } }));
      } else {
        const products = (await m.fetchProducts({ skus: [sku], type: 'subs' }).catch((err: unknown) => Promise.reject(toAppError(err)))) ?? [];
        const product = products.find((p) => p.id === sku) as { subscriptionOffers?: OfferLike[] } | undefined;
        const offerToken = product && pickGoogleOfferToken(product.subscriptionOffers ?? [], plan.googleBasePlanId, withTrial);
        if (!offerToken) throw storeError('store_product_missing');
        // Plan change: replace the current Play subscription instead of starting a second one.
        const owned = await m.getAvailablePurchases().catch(() => []);
        const replace = googleReplacement(owned, { productId: sku, basePlanId: plan.googleBasePlanId }, PLANS.map((p) => p.googleProductId), userId);
        purchase = await awaitPurchase(m, sku, () =>
          m.requestPurchase({
            type: 'subs',
            request: { google: { skus: [sku], subscriptionOffers: [{ sku, offerToken }], obfuscatedAccountId: userId, ...(replace ?? {}) } },
          }),
        );
      }
      // Pending payment (cash, bank transfer…): Google confirms later through a notification.
      if (purchase.purchaseState === 'pending') throw storeError('purchase_pending');

      try {
        const entitlement = await report(purchase);
        await finish(m, purchase);
        return entitlement;
      } catch (err) {
        // iOS: a definitive refusal would otherwise replay on every launch; finishing doesn't refund
        // or charge anything. Android: never finish a refused purchase (Google refunds it).
        if (provider === 'apple' && err instanceof ApiError && err.status >= 400 && err.status < 500) await finish(m, purchase);
        throw err;
      }
    },

    async restore() {
      const m = requireIap();
      await connected(m);
      try {
        await m.restorePurchases();
      } catch (err) {
        log.warn('store', `restorePurchases failed: ${(err as { code?: string })?.code ?? 'unknown'}`);
      }
      const all = await m.getAvailablePurchases().catch((err: unknown) => Promise.reject(toAppError(err)));
      const ours = new Set(PLANS.map((p) => skuOf(provider, p)));
      const owned = all.filter((p) => ours.has(p.productId) && !!p.purchaseToken && p.purchaseState !== 'pending');
      if (owned.length === 0) throw storeError('nothing_to_restore', 404);
      if (provider === 'apple') {
        const entitlement = await api.appleRestore(owned.map((p) => p.purchaseToken!));
        await Promise.all(owned.map((p) => finish(m, p)));
        return entitlement;
      }
      // Google: the server picks the live purchase and acknowledges it.
      return api.googleRestore(owned.map((p) => ({ purchaseToken: p.purchaseToken!, productId: p.productId })));
    },

    async prices(plans) {
      const m = loadIap();
      if (!m) return {};
      await connected(m);
      const skus = [...new Set(plans.map((p) => skuOf(provider, p)))];
      const products = ((await m.fetchProducts({ skus, type: 'subs' })) ?? []) as { id: string; displayPrice: string; subscriptionOffers?: OfferLike[] | null }[];
      const out: Partial<Record<PlanId, string>> = {};
      for (const plan of plans) {
        const product = products.find((p) => p.id === skuOf(provider, plan));
        if (!product) continue;
        const price = provider === 'apple' ? product.displayPrice : googleRecurringPrice(product.subscriptionOffers ?? [], plan.googleBasePlanId);
        if (price) out[plan.id] = price;
      }
      return out;
    },
  };
}

export const nativeStoreSupported = (provider: BillingProviderId | null) => (provider === 'apple' || provider === 'google') && !!loadIap();
