/**
 * Web build: no in-app purchases. Subscriptions are bought in the iOS or Android app and apply
 * to the same account everywhere (the server's entitlement is the source of truth).
 * Metro picks this file instead of native.ts for web, so expo-iap is never bundled for the web.
 */
import type { BillingProviderId } from '@study/shared';
import type { StoreClient } from './types';

export function createNativeStore(_provider: 'apple' | 'google'): StoreClient | null {
  return null;
}

export const nativeStoreSupported = (_provider: BillingProviderId | null) => false;
