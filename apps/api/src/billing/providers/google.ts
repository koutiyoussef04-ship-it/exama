/**
 * Google Play Billing provider (Android). Same contract as the Apple provider: a purchase proof
 * from the app (a Play purchase token) → verified with Google → normalized SubscriptionUpdate.
 *
 *  - Verification: purchases.subscriptionsv2.get via the Play Developer API (never trusts the app).
 *  - Account link: the app passes the Exama user id as `obfuscatedAccountId`; Google returns it as
 *    externalAccountIdentifiers.obfuscatedExternalAccountId. One purchase token = one account.
 *  - Acknowledgement: done by the SERVER after the subscription is recorded. If anything fails
 *    before that, Google refunds the unacknowledged purchase automatically after 3 days.
 *  - Real-time developer notifications (Pub/Sub push) keep renewals, cancellations, grace period,
 *    holds, pauses, refunds/revocations and expiry in sync (handleGoogleNotification).
 *
 * Play Console model: one subscription product per tier (exama_student, exama_pro), a base plan
 * per period (monthly, annual) and a "free-trial" offer (7 days) on each base plan.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { GOOGLE_TRIAL_OFFER_ID, googlePurchaseSchema, googleRestoreSchema, PLANS, TRIAL_DAYS, type Plan } from '@study/shared';
import { track } from '../../analytics/index.js';
import { db } from '../../db/client.js';
import { subscriptions, users } from '../../db/schema.js';
import { HttpError, parseBody } from '../../lib/errors.js';
import { applySubscriptionUpdate, getSubscription, subscriptionEventProps, type ChangeReason, type SubscriptionRow, type SubscriptionUpdate } from '../subscriptions.js';
import type { GooglePlayApi, GoogleSubscription } from './google-play-api.js';
import type { BillingProvider, PurchaseResult } from './types.js';

const DAY = 86_400_000;

export function planForGoogle(productId: string, basePlanId: string | undefined): Plan {
  const plan = PLANS.find((p) => p.googleProductId === productId && p.googleBasePlanId === basePlanId);
  if (!plan) throw new HttpError(400, `Unknown Google Play product "${productId}/${basePlanId ?? '?'}"`, 'unknown_product');
  return plan;
}

type Line = GoogleSubscription['lineItems'][number];

/** In the free-trial phase? (offerPhase when Google reports it; else our trial offer's first period.) */
export function isTrialPhase(sub: GoogleSubscription, line: Line): boolean {
  if (line.offerPhase) return !!line.offerPhase.freeTrial;
  if (line.offerDetails?.offerId !== GOOGLE_TRIAL_OFFER_ID || !sub.startTime || !line.expiryTime) return false;
  return Date.parse(line.expiryTime) - Date.parse(sub.startTime) <= (TRIAL_DAYS + 1) * DAY;
}

/** Verified Play subscription → normalized state. `purchaseToken` becomes the provider reference. */
export function mapGoogleSubscription(sub: GoogleSubscription, purchaseToken: string, now = new Date()): SubscriptionUpdate {
  const line = sub.lineItems?.[0];
  if (!line) throw new HttpError(400, 'This Google Play purchase has no subscription.', 'invalid_purchase');
  const plan = planForGoogle(line.productId, line.offerDetails?.basePlanId);
  const expires = line.expiryTime ? new Date(line.expiryTime) : null;
  const trial = isTrialPhase(sub, line);
  const base = {
    provider: 'google' as const,
    environment: sub.testPurchase ? ('sandbox' as const) : ('production' as const),
    planId: plan.id,
    trialUsed: true, // any Play purchase uses the intro offer eligibility, as on the App Store
    providerRef: purchaseToken,
  };
  const expired = (): SubscriptionUpdate => ({
    ...base,
    status: 'expired',
    trialEndsAt: trial ? expires : null,
    currentPeriodEndsAt: expires && expires < now ? expires : now,
    willRenew: false,
  });

  switch (sub.subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': // Google keeps access while it retries the payment
    case 'SUBSCRIPTION_STATE_CANCELED': {
      // CANCELED = auto-renew turned off; access continues until expiryTime.
      if (!expires || expires <= now) return expired();
      const willRenew = sub.subscriptionState !== 'SUBSCRIPTION_STATE_CANCELED' && line.autoRenewingPlan?.autoRenewEnabled !== false;
      if (trial) return { ...base, status: willRenew ? 'trialing' : 'cancelled', trialEndsAt: expires, currentPeriodEndsAt: expires, willRenew };
      return { ...base, status: willRenew ? 'active' : 'cancelled', trialEndsAt: null, currentPeriodEndsAt: expires, willRenew };
    }
    case 'SUBSCRIPTION_STATE_PENDING':
      // Payment not completed yet (e.g. cash / slow payment method): no access until Google confirms.
      throw new HttpError(409, 'This purchase is waiting for payment. Access starts once Google Play confirms it.', 'purchase_pending');
    default:
      // ON_HOLD (payment failed after grace), PAUSED, EXPIRED, PENDING_PURCHASE_CANCELED: no access.
      return expired();
  }
}

/** The purchase must have been made by this account (obfuscatedAccountId = user id). */
export function assertGoogleBelongsTo(sub: GoogleSubscription, userId: string): void {
  const owner = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!owner || owner.toLowerCase() !== userId.toLowerCase()) {
    throw new HttpError(409, 'This purchase belongs to a different Exama account.', 'purchase_other_account');
  }
}

async function assertNotLinkedElsewhere(tokens: string[], userId: string) {
  const [other] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, 'google'), inArray(subscriptions.providerRef, tokens), ne(subscriptions.userId, userId)));
  if (other) throw new HttpError(409, 'This Google Play subscription is already linked to another Exama account.', 'purchase_other_account');
}

const needsAck = (sub: GoogleSubscription) => sub.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';

export function createGoogleProvider(api: GooglePlayApi): BillingProvider {
  /** Verify + validate one token for this user. */
  async function verify(userId: string, purchaseToken: string, productId: string) {
    const sub = await api.getSubscription(purchaseToken);
    if (sub.lineItems?.[0] && sub.lineItems[0].productId !== productId) {
      throw new HttpError(400, 'This purchase is for a different product.', 'invalid_purchase');
    }
    assertGoogleBelongsTo(sub, userId);
    await assertNotLinkedElsewhere([purchaseToken, ...(sub.linkedPurchaseToken ? [sub.linkedPurchaseToken] : [])], userId);
    return { sub, update: mapGoogleSubscription(sub, purchaseToken) };
  }

  return {
    id: 'google',
    testMode: false,

    async purchase(userId, input): Promise<PurchaseResult> {
      const { purchaseToken, productId } = parseBody(googlePurchaseSchema, input);
      const { sub, update } = await verify(userId, purchaseToken, productId);
      if (update.status === 'expired') throw new HttpError(409, 'This purchase is no longer active.', 'purchase_inactive');
      return {
        update,
        reason: update.status === 'trialing' ? 'trial' : 'purchase',
        // Acknowledge only once the subscription is stored (else Google refunds it after 3 days).
        commit: needsAck(sub) ? () => api.acknowledge(productId, purchaseToken) : undefined,
      };
    },

    async restore(userId, input) {
      const { purchases } = parseBody(googleRestoreSchema, input);
      let best: { update: SubscriptionUpdate; ack?: () => Promise<void> } | null = null;
      for (const p of purchases) {
        let r: Awaited<ReturnType<typeof verify>>;
        try {
          r = await verify(userId, p.purchaseToken, p.productId);
        } catch (err) {
          if (err instanceof HttpError && err.status >= 500) throw err;
          continue; // restore only this account's valid purchases
        }
        if (r.update.status === 'expired') continue;
        if (!best || (r.update.currentPeriodEndsAt?.getTime() ?? 0) > (best.update.currentPeriodEndsAt?.getTime() ?? 0)) {
          best = { update: r.update, ack: needsAck(r.sub) ? () => api.acknowledge(p.productId, p.purchaseToken) : undefined };
        }
      }
      if (best?.ack) await best.ack().catch((err) => console.error('[google] acknowledge on restore failed', err));
      return best?.update ?? null;
    },
  };
}

// ---------------------------------------------------------------- real-time developer notifications

/** Pub/Sub push body → the Play "DeveloperNotification". */
export type GoogleDeveloperNotification = {
  packageName?: string;
  subscriptionNotification?: { notificationType: number; purchaseToken: string; subscriptionId: string };
  testNotification?: object;
  voidedPurchaseNotification?: { purchaseToken: string };
};

export function decodePushMessage(body: unknown): GoogleDeveloperNotification {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== 'string') throw new HttpError(400, 'Missing Pub/Sub message', 'invalid_request');
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as GoogleDeveloperNotification;
  } catch {
    throw new HttpError(400, 'Invalid Pub/Sub message', 'invalid_request');
  }
}

const GOOGLE_CERTS = new URL('https://www.googleapis.com/oauth2/v3/certs');
let remoteKeys: JWTVerifyGetKey | null = null;

/**
 * Pub/Sub push authentication: a Google-signed OIDC token for our configured audience (and, if
 * configured, issued to our push service account). Anything else is rejected with 401.
 */
export async function verifyPubSubToken(
  authorization: string | undefined,
  opts: { audience: string; serviceAccount?: string; keys?: JWTVerifyGetKey },
): Promise<void> {
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Missing push authentication', 'unauthenticated');
  const keys = opts.keys ?? (remoteKeys ??= createRemoteJWKSet(GOOGLE_CERTS));
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: opts.audience });
    if (opts.serviceAccount && (payload.email !== opts.serviceAccount || payload.email_verified !== true)) throw new Error('wrong service account');
  } catch {
    throw new HttpError(401, 'Invalid push authentication', 'unauthenticated');
  }
}

/** Which analytics reason a Play notification represents (types from Google's RTDN reference). */
export function reasonForGoogleNotification(type: number, previous: SubscriptionRow | null, next: SubscriptionUpdate): ChangeReason {
  switch (type) {
    case 4: // SUBSCRIPTION_PURCHASED
      return next.status === 'trialing' ? 'trial' : previous?.provider === 'google' && previous.status !== 'expired' ? 'silent' : 'purchase';
    case 2: // SUBSCRIPTION_RENEWED — first paid renewal after the trial = converted
      return previous?.status === 'trialing' && next.status === 'active' ? 'purchase' : 'silent';
    case 3: // SUBSCRIPTION_CANCELED
      return 'cancel';
    case 1: // SUBSCRIPTION_RECOVERED
    case 7: // SUBSCRIPTION_RESTARTED
      return 'restore';
    default:
      // ON_HOLD, IN_GRACE_PERIOD, PAUSED, REVOKED, EXPIRED, PENDING_PURCHASE_CANCELED, …
      return 'silent';
  }
}

/**
 * POST /billing/google/notifications. Google retries on non-2xx, so unknown users/products are
 * acknowledged and logged rather than failed. The message only says *which* token changed; the
 * state always comes from the Play Developer API.
 */
export async function handleGoogleNotification(api: GooglePlayApi, n: GoogleDeveloperNotification, opts: { packageName: string }) {
  if (n.packageName && n.packageName !== opts.packageName) return { handled: false as const };
  const sn = n.subscriptionNotification;
  const token = sn?.purchaseToken ?? n.voidedPurchaseNotification?.purchaseToken;
  if (!token) return { handled: false as const }; // test notification, one-time products…

  let sub: GoogleSubscription;
  try {
    sub = await api.getSubscription(token);
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return { handled: false as const };
    throw err; // Google unavailable: let Pub/Sub retry
  }

  // The account: obfuscatedAccountId set by the app at purchase time, else the stored token(s).
  let userId: string | null = null;
  const owner = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (owner && /^[0-9a-f-]{36}$/i.test(owner)) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, owner.toLowerCase()));
    userId = u?.id ?? null;
  }
  if (!userId) {
    const tokens = [token, ...(sub.linkedPurchaseToken ? [sub.linkedPurchaseToken] : [])];
    const [s] = await db.select({ userId: subscriptions.userId }).from(subscriptions).where(and(eq(subscriptions.provider, 'google'), inArray(subscriptions.providerRef, tokens)));
    userId = s?.userId ?? null;
  }
  if (!userId) {
    console.warn(`[google] notification type ${sn?.notificationType ?? 'voided'} for an unknown account`);
    return { handled: false as const };
  }

  let update: SubscriptionUpdate;
  try {
    update = mapGoogleSubscription(sub, token);
  } catch (err) {
    if (err instanceof HttpError && err.code === 'purchase_pending') return { handled: false as const };
    throw err;
  }
  const previous = await getSubscription(userId);
  // Never let an old/inactive token overwrite a live subscription: one from the other store, or a
  // newer Play purchase that replaced this token (plan change → the old token expires afterwards).
  if (previous && previous.status !== 'expired' && update.status === 'expired' && (previous.provider !== 'google' || previous.providerRef !== token)) {
    return { handled: false as const };
  }
  await applySubscriptionUpdate(userId, update, sn ? reasonForGoogleNotification(sn.notificationType, previous, update) : 'silent');
  if (update.status === 'expired' && previous && previous.status !== 'expired') {
    void track('subscription_expired', userId, { ...subscriptionEventProps(update.planId, 'google', update.environment), was_trial: previous.status === 'trialing' });
  }
  // A purchase the app couldn't report (crash, lost connection) still gets acknowledged here.
  if (update.status !== 'expired' && needsAck(sub) && sub.lineItems[0]) {
    await api.acknowledge(sub.lineItems[0].productId, token).catch((err) => console.error('[google] acknowledge from notification failed', err));
  }
  return { handled: true as const, userId };
}
