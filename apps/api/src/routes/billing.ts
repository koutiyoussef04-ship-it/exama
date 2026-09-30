import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { mockSetStateSchema, PLANS, RECOMMENDED_PLAN_ID, TRIAL_DAYS, type BillingCatalog, type BillingRedirect, type Entitlement } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { appleVerifier, billingProvider, billingProviders, googlePlayApi, providerForPlatform, stripeBilling } from '../billing/index.js';
import { handleAppleNotification } from '../billing/providers/apple.js';
import { decodePushMessage, handleGoogleNotification, verifyPubSubToken } from '../billing/providers/google.js';
import { isBillingPlatform, purchaseWith, requireStore, restoreWith } from '../billing/purchases.js';
import { config } from '../config.js';
import { getEntitlement } from '../billing/entitlements.js';
import { TIER_FEATURES } from '../billing/features.js';
import { LIMITS } from '../billing/limits.js';
import { mockCancel, mockStateUpdate } from '../billing/providers/mock.js';
import { createStripeCheckout, createStripePortal, handleStripeWebhook, MAX_WEBHOOK_BYTES } from '../billing/stripe-service.js';
import { applySubscriptionUpdate, getSubscription } from '../billing/subscriptions.js';
import { db } from '../db/client.js';
import { subscriptions } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';

function requireMock() {
  // Mock-only routes don't exist at all unless the mock provider is enabled.
  if (!billingProviders.mock) throw new HttpError(404, 'Not found', 'not_found');
  return billingProviders.mock;
}
function requireStripe() {
  // Stripe routes answer 503 (not 404) when switched off, like the Apple/Google ones, so a misconfigured server is obvious.
  if (!stripeBilling) throw new HttpError(503, 'Web subscriptions are not available yet.', 'stripe_not_configured');
  return stripeBilling;
}
async function body(c: { req: { json: () => Promise<unknown> } }) {
  return c.req.json().catch(() => ({}));
}

export const billingRoutes = new Hono<AuthEnv>()
  // Public catalog: plans, trial length, limits and features per tier, and which store sells on ?platform=ios|android|web.
  .get('/plans', (c) => {
    const platform = c.req.query('platform');
    const provider = isBillingPlatform(platform) ? providerForPlatform(platform) : billingProvider; // no platform: older iOS builds
    return c.json<BillingCatalog>({
      plans: [...PLANS],
      trialDays: TRIAL_DAYS,
      purchasesAvailable: !!provider,
      testMode: provider?.testMode ?? false,
      provider: provider?.id ?? null,
      limits: LIMITS,
      features: TIER_FEATURES,
      recommendedPlanId: RECOMMENDED_PLAN_ID,
    });
  })
  // App Store Server Notifications V2 (configure this URL in App Store Connect). Signed by Apple, no user auth.
  .post('/apple/notifications', async (c) => {
    if (!appleVerifier) throw new HttpError(503, 'Apple billing is not configured on this server.', 'apple_not_configured');
    const { signedPayload } = (await c.req.json().catch(() => ({}))) as { signedPayload?: unknown };
    if (typeof signedPayload !== 'string') throw new HttpError(400, 'Missing signedPayload', 'invalid_request');
    await handleAppleNotification(appleVerifier, signedPayload, { bundleId: config.APPLE_BUNDLE_ID });
    return c.body(null, 200);
  })
  // Google Play real-time developer notifications (Pub/Sub push, OIDC-authenticated). No user auth.
  .post('/google/notifications', async (c) => {
    if (!googlePlayApi || !config.GOOGLE_PUBSUB_AUDIENCE) throw new HttpError(503, 'Google Play billing is not configured on this server.', 'google_not_configured');
    await verifyPubSubToken(c.req.header('authorization'), { audience: config.GOOGLE_PUBSUB_AUDIENCE, serviceAccount: config.GOOGLE_PUBSUB_SERVICE_ACCOUNT });
    await handleGoogleNotification(googlePlayApi, decodePushMessage(await c.req.json().catch(() => null)), { packageName: config.GOOGLE_PLAY_PACKAGE_NAME });
    return c.body(null, 204);
  })
  // Stripe webhook (Stripe Dashboard → Developers → Webhooks → https://<api>/billing/stripe/webhook). Signed by
  // Stripe — the signature is verified over the RAW request body — so no user auth.
  .post('/stripe/webhook', async (c) => {
    const ctx = requireStripe();
    if (Number(c.req.header('content-length') ?? 0) > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'Payload too large.', 'payload_too_large');
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (raw.length > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'Payload too large.', 'payload_too_large');
    return c.json(await handleStripeWebhook(ctx, raw, c.req.header('stripe-signature')));
  })
  .use(requireAuth)
  .get('/status', async (c) => c.json<Entitlement>(await getEntitlement(c.var.userId)))
  // Body: { store: 'apple' | 'google' | 'mock', ...proof } — see packages/shared/src/billing.ts.
  .post('/purchase', async (c) => {
    const input = await body(c);
    await purchaseWith(requireStore(input), c.var.userId, input);
    return c.json<Entitlement>(await getEntitlement(c.var.userId));
  })
  .post('/restore', async (c) => {
    const input = await body(c);
    await restoreWith(requireStore(input), c.var.userId, input);
    return c.json<Entitlement>(await getEntitlement(c.var.userId));
  })
  // Web subscriptions. Body: { plan: 'basic' | 'student' | 'pro', interval: 'monthly' | 'yearly' } → { url } of the
  // Stripe Checkout page. Never grants access: the webhook does, once Stripe confirms the subscription.
  .post('/stripe/checkout', async (c) => c.json<BillingRedirect>(await createStripeCheckout(requireStripe(), c.var.userId, await body(c))))
  // Stripe Customer Portal for the signed-in user's own customer: payment method, invoices, cancel, change plan.
  .post('/stripe/portal', async (c) => c.json<BillingRedirect>(await createStripePortal(requireStripe(), c.var.userId)))
  // Mock-only: on iOS, cancelling happens in Settings → Subscriptions and reaches us via Apple notifications.
  .post('/cancel', async (c) => {
    requireMock();
    await applySubscriptionUpdate(c.var.userId, mockCancel(await getSubscription(c.var.userId)), 'cancel');
    return c.json<Entitlement>(await getEntitlement(c.var.userId));
  })
  // Mock-only developer tool to jump between states for testing.
  .post('/mock/state', async (c) => {
    requireMock();
    const { state } = parseBody(mockSetStateSchema, await body(c));
    const update = mockStateUpdate(state);
    const current = await getSubscription(c.var.userId);
    if (update) await applySubscriptionUpdate(c.var.userId, update, 'silent');
    else if (current?.trialUsed) {
      // Back to the free plan, but a used trial stays used: one trial per account, even in test mode.
      await db
        .update(subscriptions)
        .set({ status: 'expired', trialEndsAt: null, currentPeriodEndsAt: null, willRenew: false, updatedAt: new Date() })
        .where(eq(subscriptions.userId, c.var.userId));
    } else await db.delete(subscriptions).where(eq(subscriptions.userId, c.var.userId));
    return c.json<Entitlement>(await getEntitlement(c.var.userId));
  });
