/**
 * Purchase flow boundary (the client side of billing). The server decides access; a store client
 * only obtains a purchase proof and hands it to the API.
 *
 *  - mock   (development only, BILLING_MOCK_ENABLED on the server): no payment; the API simulates it.
 *  - apple  App Store on iOS (StoreKit 2 via expo-iap)      ┐ one implementation: ./native.ts
 *  - google Google Play Billing on Android (via expo-iap)   ┘ (./native.web.ts on the web: none)
 *
 * Which store sells on this device comes from the server (GET /billing/plans?platform=…).
 */
import type { BillingProviderId } from '@study/shared';
import { api } from '../api';
import { createNativeStore } from './native';
import type { StoreClient } from './types';

export type { StoreClient } from './types';
export { isStoreProvider, storeName } from './offers';

const mockStore: StoreClient = {
  provider: 'mock',
  purchase: (plan, { withTrial }) => api.purchase(plan.id, withTrial),
  restore: () => api.restorePurchases(),
};

const native: Partial<Record<'apple' | 'google', StoreClient | null>> = {};

/** The client matching the server's store for this platform, or null when purchases are unavailable here. */
export function getStoreClient(provider: BillingProviderId | null): StoreClient | null {
  if (provider === 'mock') return mockStore;
  if (provider === 'apple' || provider === 'google') {
    if (!(provider in native)) native[provider] = createNativeStore(provider);
    return native[provider] ?? null;
  }
  return null;
}
