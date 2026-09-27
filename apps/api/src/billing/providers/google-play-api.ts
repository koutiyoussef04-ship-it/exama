/**
 * Minimal Google Play Developer API client (no SDK): service-account OAuth (JWT bearer, signed with
 * `jose`, already a dependency) + the two calls billing needs:
 *   GET  purchases.subscriptionsv2.get          — the source of truth for a purchase token
 *   POST purchases.subscriptions.acknowledge    — must happen within 3 days or Google refunds
 * Server-side only; the key never reaches the app.
 */
import { importPKCS8, SignJWT } from 'jose';
import type { GoogleServiceAccount } from '../../config.js';
import { HttpError } from '../../lib/errors.js';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

/** The fields we use from SubscriptionPurchaseV2. */
export type GoogleSubscription = {
  subscriptionState:
    | 'SUBSCRIPTION_STATE_UNSPECIFIED'
    | 'SUBSCRIPTION_STATE_PENDING'
    | 'SUBSCRIPTION_STATE_ACTIVE'
    | 'SUBSCRIPTION_STATE_PAUSED'
    | 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    | 'SUBSCRIPTION_STATE_ON_HOLD'
    | 'SUBSCRIPTION_STATE_CANCELED'
    | 'SUBSCRIPTION_STATE_EXPIRED'
    | 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED';
  startTime?: string;
  latestOrderId?: string;
  /** Previous token when this purchase replaced another (upgrade, downgrade, resubscribe). */
  linkedPurchaseToken?: string;
  /** Present for license-tester (test card) purchases. */
  testPurchase?: Record<string, never>;
  acknowledgementState?: 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED' | 'ACKNOWLEDGEMENT_STATE_PENDING' | 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  /** obfuscatedExternalAccountId = the Exama user id the app passed to Play Billing. */
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string; obfuscatedExternalProfileId?: string };
  lineItems: {
    productId: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
    offerDetails?: { basePlanId?: string; offerId?: string; offerTags?: string[] };
    /** Current pricing phase of the line item (free trial, introductory, base price…). */
    offerPhase?: { freeTrial?: object; introductoryPrice?: object; basePrice?: object; prorationPeriod?: object };
  }[];
};

/** What the Google provider needs from Google. Tests use a fake; production uses `createPlayApi`. */
export interface GooglePlayApi {
  getSubscription(purchaseToken: string): Promise<GoogleSubscription>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
}

export function createPlayApi(opts: { serviceAccount: GoogleServiceAccount; packageName: string; fetchImpl?: typeof fetch }): GooglePlayApi {
  const f = opts.fetchImpl ?? fetch;
  const tokenUri = opts.serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(opts.serviceAccount.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(opts.serviceAccount.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await f(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      console.error(`[google-play] token exchange failed: ${res.status}`);
      throw new HttpError(503, 'Google Play verification is unavailable right now.', 'store_unavailable');
    }
    cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const res = await f(`${API}/${encodeURIComponent(opts.packageName)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status === 404 || res.status === 410 || res.status === 400) {
      throw new HttpError(400, 'This Google Play purchase could not be found.', 'invalid_purchase');
    }
    if (!res.ok) {
      console.error(`[google-play] ${method} ${path.split('/tokens/')[0]} → ${res.status}`); // never log the token
      throw new HttpError(503, 'Google Play verification is unavailable right now.', 'store_unavailable');
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    getSubscription: (token) => call('GET', `/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`) as Promise<GoogleSubscription>,
    acknowledge: async (productId, token) => {
      await call('POST', `/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, {});
    },
  };
}
