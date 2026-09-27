/**
 * Apple App Store (StoreKit 2) provider — integration boundary.
 *
 * What is implemented and tested here (pure logic, no Apple credentials needed):
 *  - mapping a verified StoreKit transaction (+ renewal info) → SubscriptionUpdate
 *    (trial / active / cancelled / grace period / expired / refunded)
 *  - account association: the transaction's appAccountToken must be the signed-in user's id,
 *    the bundle id must be ours, and one originalTransactionId can belong to one account only
 *  - App Store Server Notifications V2 → which change it represents (analytics reason)
 *  - purchase / restore / notification handlers built on an `AppleVerifier`
 *
 * What is deliberately NOT implemented: JWS signature verification. `AppleVerifier` must be
 * backed by Apple's `@apple/app-store-server-library` (SignedDataVerifier with Apple's root
 * certificates, bundle id, app Apple ID and environment). Until then `appleVerifier` is null in
 * billing/index.ts, Apple purchases are refused (503) and nothing is ever trusted unverified.
 * See docs/app-store/apple-subscriptions.md.
 */
import { and, eq, ne } from 'drizzle-orm';
import { applePurchaseSchema, appleRestoreSchema, PLANS, type Plan } from '@study/shared';
import { track } from '../../analytics/index.js';
import { db } from '../../db/client.js';
import { subscriptions, users } from '../../db/schema.js';
import { HttpError, parseBody } from '../../lib/errors.js';
import { applySubscriptionUpdate, getSubscription, type ChangeReason, type SubscriptionRow, type SubscriptionUpdate, subscriptionEventProps } from '../subscriptions.js';
import type { BillingProvider, PurchaseResult } from './types.js';

/** The fields we use from Apple's JWSTransactionDecodedPayload (after verification). */
export type AppleTransaction = {
  bundleId: string;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  purchaseDate: number; // ms since epoch
  expiresDate?: number;
  /** 1 = introductory offer (our free trial), 2 = promotional, 3 = offer code. */
  offerType?: number;
  offerDiscountType?: 'FREE_TRIAL' | 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT';
  revocationDate?: number;
  /** UUID the app passes to StoreKit at purchase time: our user id. */
  appAccountToken?: string;
  environment: 'Sandbox' | 'Production' | 'Xcode' | 'LocalTesting';
};

/** The fields we use from JWSRenewalInfoDecodedPayload. */
export type AppleRenewalInfo = {
  originalTransactionId: string;
  autoRenewStatus: 0 | 1;
  autoRenewProductId?: string;
  gracePeriodExpiresDate?: number;
};

/** Decoded App Store Server Notification V2 (responseBodyV2DecodedPayload). */
export type AppleNotification = {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string };
};

/** Verifies Apple-signed JWS values. Implement with @apple/app-store-server-library. */
export interface AppleVerifier {
  verifyTransaction(signedTransaction: string): Promise<AppleTransaction>;
  verifyRenewalInfo(signedRenewalInfo: string): Promise<AppleRenewalInfo>;
  verifyNotification(signedPayload: string): Promise<AppleNotification>;
}

export function planForProduct(productId: string): Plan {
  const plan = PLANS.find((p) => p.appleProductId === productId);
  if (!plan) throw new HttpError(400, `Unknown App Store product "${productId}"`, 'unknown_product');
  return plan;
}

const isFreeTrial = (tx: AppleTransaction) => tx.offerType === 1 && tx.offerDiscountType === 'FREE_TRIAL';

/** Verified transaction (+ renewal info when known) → normalized subscription state. */
export function mapAppleTransaction(tx: AppleTransaction, renewal: AppleRenewalInfo | null, now = new Date()): SubscriptionUpdate {
  const plan = planForProduct(tx.productId);
  const expires = tx.expiresDate ? new Date(tx.expiresDate) : null;
  const trial = isFreeTrial(tx);
  const willRenew = renewal ? renewal.autoRenewStatus === 1 : true;
  const base = {
    provider: 'apple' as const,
    environment: tx.environment === 'Production' ? ('production' as const) : ('sandbox' as const),
    planId: plan.id,
    trialUsed: true, // Apple allows one intro offer per subscription group; any purchase uses it.
    providerRef: tx.originalTransactionId,
  };

  if (tx.revocationDate) {
    // Refunded / revoked (e.g. Family Sharing removed): access ends immediately.
    return { ...base, status: 'expired', trialEndsAt: trial ? expires : null, currentPeriodEndsAt: new Date(tx.revocationDate), willRenew: false };
  }
  // Billing grace period: Apple keeps access while it retries the payment.
  const grace = renewal?.gracePeriodExpiresDate ? new Date(renewal.gracePeriodExpiresDate) : null;
  const accessEnd = expires && grace ? (grace > expires ? grace : expires) : (expires ?? grace);
  if (!accessEnd || accessEnd <= now) {
    return { ...base, status: 'expired', trialEndsAt: trial ? expires : null, currentPeriodEndsAt: accessEnd, willRenew: false };
  }
  if (trial) {
    // trialEndsAt === currentPeriodEndsAt marks a trial period (trial limits apply, see entitlements).
    return { ...base, status: willRenew ? 'trialing' : 'cancelled', trialEndsAt: expires, currentPeriodEndsAt: expires, willRenew };
  }
  return { ...base, status: willRenew ? 'active' : 'cancelled', trialEndsAt: null, currentPeriodEndsAt: accessEnd, willRenew };
}

/** The transaction must be for this app and bought by this account (appAccountToken = user id). */
export function assertTransactionBelongsTo(tx: AppleTransaction, userId: string, bundleId: string): void {
  if (tx.bundleId !== bundleId) throw new HttpError(400, 'This purchase is for a different app.', 'wrong_app');
  if (!tx.appAccountToken || tx.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    throw new HttpError(409, 'This purchase belongs to a different Exama account.', 'purchase_other_account');
  }
}

/** Which analytics reason an App Store notification represents. */
export function reasonForNotification(n: Pick<AppleNotification, 'notificationType' | 'subtype'>, previous: SubscriptionRow | null, next: SubscriptionUpdate): ChangeReason {
  switch (n.notificationType) {
    case 'SUBSCRIBED':
      return next.status === 'trialing' ? 'trial' : 'purchase';
    case 'DID_RENEW':
      // First paid renewal after a free trial = the trial converted.
      return previous?.status === 'trialing' && next.status === 'active' ? 'purchase' : 'silent';
    case 'DID_CHANGE_RENEWAL_STATUS':
      return n.subtype === 'AUTO_RENEW_DISABLED' ? 'cancel' : n.subtype === 'AUTO_RENEW_ENABLED' ? 'restore' : 'silent';
    default:
      // EXPIRED, GRACE_PERIOD_EXPIRED, REFUND, REVOKE, DID_FAIL_TO_RENEW, DID_CHANGE_RENEWAL_PREF, …
      return 'silent';
  }
}

async function assertNotLinkedElsewhere(originalTransactionId: string, userId: string) {
  const [other] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, 'apple'), eq(subscriptions.providerRef, originalTransactionId), ne(subscriptions.userId, userId)));
  if (other) throw new HttpError(409, 'This App Store subscription is already linked to another Exama account.', 'purchase_other_account');
}

export function createAppleProvider(verifier: AppleVerifier, opts: { bundleId: string }): BillingProvider {
  return {
    id: 'apple',
    testMode: false,

    async purchase(userId, input): Promise<PurchaseResult> {
      const { signedTransaction } = parseBody(applePurchaseSchema, input);
      const tx = await verifier.verifyTransaction(signedTransaction);
      assertTransactionBelongsTo(tx, userId, opts.bundleId);
      await assertNotLinkedElsewhere(tx.originalTransactionId, userId);
      const update = mapAppleTransaction(tx, null);
      return { update, reason: update.status === 'trialing' ? 'trial' : 'purchase' };
    },

    async restore(userId, input) {
      const { signedTransactions } = parseBody(appleRestoreSchema, input);
      let best: SubscriptionUpdate | null = null;
      for (const jws of signedTransactions) {
        const tx = await verifier.verifyTransaction(jws);
        try {
          assertTransactionBelongsTo(tx, userId, opts.bundleId);
          await assertNotLinkedElsewhere(tx.originalTransactionId, userId);
        } catch {
          continue; // restore only this account's purchases
        }
        const update = mapAppleTransaction(tx, null);
        if (update.status === 'expired') continue;
        if (!best || (update.currentPeriodEndsAt?.getTime() ?? 0) > (best.currentPeriodEndsAt?.getTime() ?? 0)) best = update;
      }
      return best;
    },
  };
}

/**
 * App Store Server Notifications V2 (POST /billing/apple/notifications). Apple retries on non-2xx,
 * so unknown users/products are acknowledged and logged rather than failed.
 */
export async function handleAppleNotification(verifier: AppleVerifier, signedPayload: string, opts: { bundleId: string }) {
  const n = await verifier.verifyNotification(signedPayload);
  if (n.notificationType === 'TEST' || !n.data?.signedTransactionInfo) return { handled: false as const };
  if (n.data.bundleId && n.data.bundleId !== opts.bundleId) return { handled: false as const };
  const tx = await verifier.verifyTransaction(n.data.signedTransactionInfo);
  const renewal = n.data.signedRenewalInfo ? await verifier.verifyRenewalInfo(n.data.signedRenewalInfo) : null;

  // Link to the account: appAccountToken (set by the app at purchase), else the stored originalTransactionId.
  let userId: string | null = null;
  if (tx.appAccountToken) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, tx.appAccountToken.toLowerCase()));
    userId = u?.id ?? null;
  }
  if (!userId) {
    const [s] = await db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.provider, 'apple'), eq(subscriptions.providerRef, tx.originalTransactionId)));
    userId = s?.userId ?? null;
  }
  if (!userId) {
    console.warn(`[apple] ${n.notificationType} for an unknown account (notification ${n.notificationUUID})`);
    return { handled: false as const };
  }

  const previous = await getSubscription(userId);
  const update = mapAppleTransaction(tx, renewal);
  await applySubscriptionUpdate(userId, update, reasonForNotification(n, previous, update));
  if (update.status === 'expired' && previous && previous.status !== 'expired') {
    void track('subscription_expired', userId, { ...subscriptionEventProps(update.planId, 'apple', update.environment), was_trial: previous.status === 'trialing' });
  }
  return { handled: true as const, userId };
}
