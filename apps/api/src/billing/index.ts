import type { BillingPlatform, BillingProviderId } from '@study/shared';
import { config, parseServiceAccount } from '../config.js';
import { createAppleProvider, type AppleVerifier } from './providers/apple.js';
import { createGoogleProvider } from './providers/google.js';
import { createPlayApi, type GooglePlayApi } from './providers/google-play-api.js';
import { mockProvider } from './providers/mock.js';
import type { BillingProvider } from './providers/types.js';

/**
 * Stores and platforms. One Exama account = one entitlement, whichever store sold it:
 *   iOS app      → Apple App Store (StoreKit 2)        — `apple`
 *   Android app  → Google Play Billing                 — `google`
 *   web          → no in-app purchases; a subscription bought in either app applies there too
 *   development  → the mock provider on every platform (BILLING_MOCK_ENABLED, refused in production)
 * The server stays the source of truth: every purchase is verified with the store that sold it.
 */

/**
 * Verifies Apple-signed data. null until implemented with @apple/app-store-server-library
 * (see docs/app-store/apple-subscriptions.md) — Apple purchases are refused until then.
 */
export const appleVerifier: AppleVerifier | null = null;

/** Play Developer API client; null until GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set. */
export const googlePlayApi: GooglePlayApi | null = config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
  ? createPlayApi({ serviceAccount: parseServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)!, packageName: config.GOOGLE_PLAY_PACKAGE_NAME })
  : null;

const real: Partial<Record<BillingProviderId, BillingProvider>> = {
  ...(appleVerifier ? { apple: createAppleProvider(appleVerifier, { bundleId: config.APPLE_BUNDLE_ID }) } : {}),
  ...(googlePlayApi ? { google: createGoogleProvider(googlePlayApi) } : {}),
};

/** Stores this server accepts purchases from. */
export const billingProviders: Partial<Record<BillingProviderId, BillingProvider>> = config.BILLING_MOCK_ENABLED ? { mock: mockProvider } : real;

/** The store that sells subscriptions on a platform (null = purchases unavailable there). */
export function providerForPlatform(platform: BillingPlatform | undefined): BillingProvider | null {
  if (billingProviders.mock) return billingProviders.mock;
  if (platform === 'ios') return billingProviders.apple ?? null;
  if (platform === 'android') return billingProviders.google ?? null;
  return null;
}

/** Legacy single-provider view (older app builds that don't send their platform = iOS). */
export const billingProvider: BillingProvider | null = billingProviders.mock ?? billingProviders.apple ?? null;
