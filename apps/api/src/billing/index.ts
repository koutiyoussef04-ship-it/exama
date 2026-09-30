import { fileURLToPath } from 'node:url';
import type { BillingPlatform, BillingProviderId } from '@study/shared';
import { config, parseServiceAccount } from '../config.js';
import { createAppleProvider, type AppleVerifier } from './providers/apple.js';
import { createAppleVerifier, loadRootCertificates } from './providers/apple-verifier.js';
import { createGoogleProvider } from './providers/google.js';
import { createPlayApi, type GooglePlayApi } from './providers/google-play-api.js';
import { mockProvider } from './providers/mock.js';
import { createStripeBilling, createStripeProvider, type StripeBilling } from './providers/stripe.js';
import type { BillingProvider } from './providers/types.js';

/**
 * Stores and platforms. One Exama account = one entitlement, whichever store sold it:
 *   iOS app      → Apple App Store (StoreKit 2)        — `apple`
 *   Android app  → Google Play Billing                 — `google`
 *   web          → Stripe Checkout when STRIPE_ENABLED (see providers/stripe.ts); otherwise no purchases here.
 *                  A subscription bought in either app (or on the web) applies on every platform.
 *   development  → the mock provider on every platform (BILLING_MOCK_ENABLED, refused in production)
 * The server stays the source of truth: every purchase is verified with the store that sold it.
 */

/**
 * Verifies Apple-signed data (StoreKit 2 JWS) against Apple's root certificates. null unless
 * APPLE_IAP_ENABLED=true — App Store purchases are refused (503) until then.
 */
export const appleVerifier: AppleVerifier | null = config.APPLE_IAP_ENABLED
  ? createAppleVerifier({
      rootCertificates: loadRootCertificates(config.APPLE_ROOT_CERTS_DIR ?? fileURLToPath(new URL('../../certs/apple/', import.meta.url))),
      bundleId: config.APPLE_BUNDLE_ID,
      appAppleId: config.APPLE_APP_APPLE_ID,
      allowSandbox: config.APPLE_ALLOW_SANDBOX,
      onlineChecks: config.APPLE_ONLINE_CHECKS,
    })
  : null;

/** Play Developer API client; null until GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set. */
export const googlePlayApi: GooglePlayApi | null = config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
  ? createPlayApi({ serviceAccount: parseServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)!, packageName: config.GOOGLE_PLAY_PACKAGE_NAME })
  : null;

/** Stripe (web subscriptions): the client of the Stripe API plus the Price/URL configuration; null unless STRIPE_ENABLED. */
export const stripeBilling: StripeBilling | null = config.STRIPE_ENABLED ? createStripeBilling(config) : null;

const real: Partial<Record<BillingProviderId, BillingProvider>> = {
  ...(appleVerifier ? { apple: createAppleProvider(appleVerifier, { bundleId: config.APPLE_BUNDLE_ID }) } : {}),
  ...(googlePlayApi ? { google: createGoogleProvider(googlePlayApi) } : {}),
  ...(stripeBilling ? { stripe: createStripeProvider() } : {}),
};

/** Stores this server accepts purchases from. */
export const billingProviders: Partial<Record<BillingProviderId, BillingProvider>> = config.BILLING_MOCK_ENABLED ? { mock: mockProvider } : real;

/** The store that sells subscriptions on a platform (null = purchases unavailable there). */
export function providerForPlatform(platform: BillingPlatform | undefined): BillingProvider | null {
  if (billingProviders.mock) return billingProviders.mock;
  if (platform === 'ios') return billingProviders.apple ?? null;
  if (platform === 'android') return billingProviders.google ?? null;
  if (platform === 'web') return billingProviders.stripe ?? null;
  return null;
}

/** Legacy single-provider view (older app builds that don't send their platform = iOS). */
export const billingProvider: BillingProvider | null = billingProviders.mock ?? billingProviders.apple ?? null;
