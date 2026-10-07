/**
 * Google Play Billing boundary: subscriptionsv2 → subscription mapping, account link, server-side
 * acknowledgement order, cross-store conflicts, restore, RTDN (Pub/Sub push) authentication and
 * handling, the platform-aware catalog, and the Play Developer API client contract.
 * Google itself is replaced by a fake GooglePlayApi / fake fetch — nothing here talks to Google.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose';
import type { AuthResponse } from '@study/shared';

const OWNER_EMAIL = `owner-google-${crypto.randomUUID()}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'false', STRIPE_ENABLED: 'false', OWNER_EMAILS: OWNER_EMAIL, OWNER_USER_IDS: '' });
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { getEntitlement } = await import('../src/billing/entitlements.js');
const { LIMITS } = await import('../src/billing/limits.js');
const google = await import('../src/billing/providers/google.js');
const { createPlayApi } = await import('../src/billing/providers/google-play-api.js');
const { mockProvider } = await import('../src/billing/providers/mock.js');
const { HttpError } = await import('../src/lib/errors.js');
const { purchaseWith, restoreWith, requireStore, storeForBody } = await import('../src/billing/purchases.js');
const { applySubscriptionUpdate, getSubscription } = await import('../src/billing/subscriptions.js');
type Sub = import('../src/billing/providers/google-play-api.js').GoogleSubscription;
type Api = import('../src/billing/providers/google-play-api.js').GooglePlayApi;
after(() => sql.end());

const PKG = 'com.exama.app';
const DAY = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const sub = (over: Partial<Sub> & { line?: Partial<Sub['lineItems'][number]> } = {}): Sub => {
  const { line, ...rest } = over;
  return {
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    startTime: iso(now - DAY),
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    testPurchase: {},
    ...rest,
    lineItems: [
      {
        productId: 'exama_student',
        expiryTime: iso(now + 30 * DAY),
        autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId: 'monthly' },
        offerPhase: { basePrice: {} },
        ...line,
      },
    ],
  };
};
const trialSub = (userId: string, over: Partial<Sub> = {}) =>
  sub({
    externalAccountIdentifiers: { obfuscatedExternalAccountId: userId },
    ...over,
    line: { expiryTime: iso(now + 7 * DAY), offerDetails: { basePlanId: 'monthly', offerId: 'free-trial' }, offerPhase: { freeTrial: {} } },
  });

/** Fake Play Developer API: token → subscription; records acknowledgements (and what was stored when). */
function fakeApi(store: Record<string, Sub> = {}) {
  const acks: { productId: string; token: string; storedBefore: boolean }[] = [];
  const api: Api & { store: Record<string, Sub>; acks: typeof acks; ownerOf: Record<string, string> } = {
    store,
    acks,
    ownerOf: {},
    async getSubscription(token) {
      const s = store[token];
      if (!s) throw new HttpError(400, 'not found', 'invalid_purchase');
      return structuredClone(s);
    },
    async acknowledge(productId, token) {
      const owner = api.ownerOf[token];
      const stored = owner ? (await getSubscription(owner))?.providerRef === token : false;
      acks.push({ productId, token, storedBefore: stored });
      store[token].acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
    },
  };
  return api;
}
const token = () => `tok-${crypto.randomUUID()}-${'x'.repeat(20)}`;

async function newUser(email = `google-${crypto.randomUUID()}@example.com`) {
  const r = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'G' }),
  });
  return ((await r.json()) as AuthResponse).user.id;
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'resolved';
};

test('mapping: trial, active, cancelled, grace period, on hold, expired, pending; every plan has a Play product', () => {
  const u = crypto.randomUUID();
  const trial = google.mapGoogleSubscription(trialSub(u), 't1');
  assert.deepEqual([trial.status, trial.provider, trial.environment, trial.planId, trial.providerRef, trial.trialUsed], ['trialing', 'google', 'sandbox', 'student_monthly', 't1', true]);
  assert.equal(+trial.trialEndsAt!, +trial.currentPeriodEndsAt!);

  // Without offerPhase (older responses): our 7-day "free-trial" offer's first period = trial.
  const byOffer = sub({ line: { offerPhase: undefined, expiryTime: iso(now + 6 * DAY), offerDetails: { basePlanId: 'monthly', offerId: 'free-trial' } } });
  assert.equal(google.mapGoogleSubscription(byOffer, 't').status, 'trialing');
  const renewedOnOffer = sub({ startTime: iso(now - 8 * DAY), line: { offerPhase: undefined, offerDetails: { basePlanId: 'monthly', offerId: 'free-trial' } } });
  assert.equal(google.mapGoogleSubscription(renewedOnOffer, 't').status, 'active', 'after the trial the same offer is a paid period');

  const active = google.mapGoogleSubscription(sub({ testPurchase: undefined, line: { productId: 'exama_pro', offerDetails: { basePlanId: 'annual' } } }), 't');
  assert.deepEqual([active.status, active.planId, active.environment, active.willRenew, active.trialEndsAt], ['active', 'pro_yearly', 'production', true, null]);

  const cancelled = google.mapGoogleSubscription(sub({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }), 't');
  assert.deepEqual([cancelled.status, cancelled.willRenew], ['cancelled', false], 'auto-renew off: access until expiry');
  const cancelledTrial = google.mapGoogleSubscription(trialSub(u, { subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }), 't');
  assert.deepEqual([cancelledTrial.status, +cancelledTrial.trialEndsAt!], ['cancelled', now + 7 * DAY]);

  assert.equal(google.mapGoogleSubscription(sub({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }), 't').status, 'active', 'grace period keeps access');
  for (const s of ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'] as const) {
    const m = google.mapGoogleSubscription(sub({ subscriptionState: s }), 't');
    assert.deepEqual([m.status, m.willRenew], ['expired', false], s);
    assert.ok(m.currentPeriodEndsAt! <= new Date(), `${s}: access ends now`);
  }
  assert.equal(google.mapGoogleSubscription(sub({ line: { expiryTime: iso(now - 1000) } }), 't').status, 'expired', 'ACTIVE but past expiry');
  assert.throws(() => google.mapGoogleSubscription(sub({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }), 't'), /waiting for payment/);
  assert.throws(() => google.mapGoogleSubscription(sub({ line: { productId: 'other_app_gold' } }), 't'), /Unknown Google Play product/);
  assert.throws(() => google.mapGoogleSubscription(sub({ line: { offerDetails: { basePlanId: 'weekly' } } }), 't'), /Unknown Google Play product/);

  for (const [product, base, plan] of [
    ['exama_student', 'monthly', 'student_monthly'],
    ['exama_student', 'annual', 'student_yearly'],
    ['exama_pro', 'monthly', 'pro_monthly'],
    ['exama_pro', 'annual', 'pro_yearly'],
  ]) assert.equal(google.planForGoogle(product, base).id, plan);
});

test('account link: the obfuscated account id must be the signed-in user', () => {
  const u = crypto.randomUUID();
  assert.doesNotThrow(() => google.assertGoogleBelongsTo(trialSub(u), u));
  assert.doesNotThrow(() => google.assertGoogleBelongsTo(trialSub(u.toUpperCase()), u));
  assert.throws(() => google.assertGoogleBelongsTo(trialSub(crypto.randomUUID()), u), /different Exama account/);
  assert.throws(() => google.assertGoogleBelongsTo(sub(), u), /different Exama account/, 'no account id → refused');
});

test('purchase: verified trial → trial tier; acknowledged only AFTER it is stored; replays refused', async () => {
  const api = fakeApi();
  const provider = google.createGoogleProvider(api);
  const alice = await newUser();
  const bob = await newUser();
  const t = token();
  api.store[t] = trialSub(alice);
  api.ownerOf[t] = alice;

  assert.equal(await code(purchaseWith(provider, alice, { store: 'google', purchaseToken: t, productId: 'exama_pro' })), 'invalid_purchase', 'product mismatch');
  assert.equal(await code(purchaseWith(provider, alice, { planId: 'student_monthly' })), 'invalid_request', 'mock-style input is rejected');
  assert.equal(api.acks.length, 0);

  await purchaseWith(provider, alice, { store: 'google', purchaseToken: t, productId: 'exama_student' });
  const e = await getEntitlement(alice);
  assert.deepEqual([e.tier, e.provider, e.status, e.limits], ['trial', 'google', 'trialing', LIMITS.trial], 'Play trials get the restricted trial tier');
  assert.deepEqual(api.acks, [{ productId: 'exama_student', token: t, storedBefore: true }]);

  // Same purchase reported twice (retry): no second acknowledgement.
  await purchaseWith(provider, alice, { store: 'google', purchaseToken: t, productId: 'exama_student' });
  assert.equal(api.acks.length, 1);

  // Bob replays Alice's token: wrong account id… and a forged id still hits the stored link.
  assert.equal(await code(purchaseWith(provider, bob, { purchaseToken: t, productId: 'exama_student' })), 'purchase_other_account');
  api.store[t].externalAccountIdentifiers = { obfuscatedExternalAccountId: bob };
  assert.equal(await code(purchaseWith(provider, bob, { purchaseToken: t, productId: 'exama_student' })), 'purchase_other_account');
  // An upgrade whose linkedPurchaseToken is Alice's also can't be claimed by Bob.
  const up = token();
  api.store[up] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: bob }, linkedPurchaseToken: t });
  assert.equal(await code(purchaseWith(provider, bob, { purchaseToken: up, productId: 'exama_student' })), 'purchase_other_account');
  assert.equal((await getSubscription(bob)), null);

  // Pending payment and inactive purchases: no access, nothing acknowledged.
  const carol = await newUser();
  const pending = token();
  api.store[pending] = sub({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING', externalAccountIdentifiers: { obfuscatedExternalAccountId: carol } });
  assert.equal(await code(purchaseWith(provider, carol, { purchaseToken: pending, productId: 'exama_student' })), 'purchase_pending');
  const old = token();
  api.store[old] = sub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', externalAccountIdentifiers: { obfuscatedExternalAccountId: carol } });
  assert.equal(await code(purchaseWith(provider, carol, { purchaseToken: old, productId: 'exama_student' })), 'purchase_inactive');
  assert.equal(await code(purchaseWith(provider, carol, { purchaseToken: token(), productId: 'exama_student' })), 'invalid_purchase', 'unknown token');
  assert.equal(api.acks.length, 1);
  assert.equal((await getEntitlement(carol)).tier, 'free');

  // Owner accounts never buy.
  const owner = await newUser(OWNER_EMAIL);
  const ot = token();
  api.store[ot] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: owner } });
  assert.equal(await code(purchaseWith(provider, owner, { purchaseToken: ot, productId: 'exama_student' })), 'full_access');
  assert.equal(api.acks.length, 1);
});

test('if storing fails, the purchase is NOT acknowledged (Google refunds it after 3 days)', async () => {
  const api = fakeApi();
  const provider = google.createGoogleProvider(api);
  const t = token();
  const ghost = crypto.randomUUID(); // no such user → the subscriptions insert violates the FK
  api.store[t] = trialSub(ghost);
  await assert.rejects(purchaseWith(provider, ghost, { purchaseToken: t, productId: 'exama_student' }));
  assert.equal(api.acks.length, 0);
});

test('a failed acknowledgement after storing does not fail the purchase (the app and notifications retry it)', async () => {
  const api = fakeApi();
  const user = await newUser();
  const t = token();
  api.store[t] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user } });
  api.acknowledge = async () => {
    throw new HttpError(503, 'down', 'store_unavailable');
  };
  const orig = console.error;
  console.error = () => undefined;
  try {
    await purchaseWith(google.createGoogleProvider(api), user, { purchaseToken: t, productId: 'exama_student' });
  } finally {
    console.error = orig;
  }
  assert.deepEqual([(await getEntitlement(user)).provider, (await getEntitlement(user)).status], ['google', 'active']);
});

test('cross-store: an active App Store subscription blocks a Play purchase (and vice versa) until it ends', async () => {
  const api = fakeApi();
  const provider = google.createGoogleProvider(api);
  const user = await newUser();
  await applySubscriptionUpdate(
    user,
    { provider: 'apple', planId: 'pro_monthly', status: 'active', trialEndsAt: null, currentPeriodEndsAt: new Date(now + 20 * DAY), willRenew: true, trialUsed: true, providerRef: `o-${crypto.randomUUID()}`, environment: 'sandbox' },
    'purchase',
  );
  const t = token();
  api.store[t] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user } });
  api.ownerOf[t] = user;

  try {
    await purchaseWith(provider, user, { purchaseToken: t, productId: 'exama_student' });
    assert.fail('should refuse');
  } catch (e) {
    const err = e as { status: number; code: string; details?: { provider?: string } };
    assert.deepEqual([err.status, err.code, err.details?.provider], [409, 'subscribed_elsewhere', 'apple']);
  }
  assert.equal(await code(restoreWith(provider, user, { purchases: [{ purchaseToken: t, productId: 'exama_student' }] })), 'subscribed_elsewhere');
  assert.equal(api.acks.length, 0, 'the duplicate Play purchase is never acknowledged → auto-refunded');
  assert.equal((await getEntitlement(user)).provider, 'apple', 'Apple subscription untouched');

  // Once the App Store subscription has ended, Play can take over.
  await applySubscriptionUpdate(
    user,
    { provider: 'apple', planId: 'pro_monthly', status: 'expired', trialEndsAt: null, currentPeriodEndsAt: new Date(now - 1000), willRenew: false, trialUsed: true, environment: 'sandbox' },
    'silent',
  );
  await purchaseWith(provider, user, { purchaseToken: t, productId: 'exama_student' });
  assert.deepEqual([(await getEntitlement(user)).provider, api.acks.length], ['google', 1]);
});

test('restore: only this account’s live Play purchases; the latest one wins and is acknowledged', async () => {
  const api = fakeApi();
  const provider = google.createGoogleProvider(api);
  const user = await newUser();
  const other = await newUser();
  const [short, long, foreign, dead] = [token(), token(), token(), token()];
  api.store[short] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user }, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', line: { expiryTime: iso(now + 5 * DAY) } });
  api.store[long] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user }, line: { productId: 'exama_pro', offerDetails: { basePlanId: 'annual' }, expiryTime: iso(now + 300 * DAY) } });
  api.store[foreign] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: other }, line: { expiryTime: iso(now + 900 * DAY) } });
  api.store[dead] = sub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', externalAccountIdentifiers: { obfuscatedExternalAccountId: user } });
  const p = (purchaseToken: string, productId = 'exama_student') => ({ purchaseToken, productId });

  await restoreWith(provider, user, { store: 'google', purchases: [p(short), p(long, 'exama_pro'), p(foreign), p(dead), p(token())] });
  const s = await getSubscription(user);
  assert.deepEqual([s?.planId, s?.providerRef, s?.status], ['pro_yearly', long, 'active']);
  assert.deepEqual(api.acks.map((a) => a.token), [long]);

  assert.equal(await code(restoreWith(provider, other, { purchases: [p(short), p(dead)] })), 'nothing_to_restore');
  assert.equal(await code(restoreWith(provider, other, { purchases: [] })), 'nothing_to_restore');

  // Google unavailable during restore → 503, not "nothing to restore".
  const down: Api = { getSubscription: async () => {
      throw new HttpError(503, 'down', 'store_unavailable');
    }, acknowledge: async () => undefined };
  assert.equal(await code(restoreWith(google.createGoogleProvider(down), user, { purchases: [p(short)] })), 'store_unavailable');
});

test('Pub/Sub push authentication: Google-signed token for our audience and push account only', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' } as JWK;
  const keys = createLocalJWKSet({ keys: [jwk] });
  const AUD = 'https://api.exama.test/billing/google/notifications';
  const SA = 'pubsub-push@exama-test.iam.gserviceaccount.com';
  const sign = (claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string; key?: typeof privateKey } = {}) =>
    new SignJWT({ email: SA, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? 'https://accounts.google.com')
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(opts.key ?? privateKey);
  const check = async (auth: string | undefined, serviceAccount: string | null = SA) =>
    code(google.verifyPubSubToken(auth, { audience: AUD, serviceAccount: serviceAccount ?? undefined, keys }));

  assert.equal(await check(`Bearer ${await sign()}`), 'resolved');
  assert.equal(await check(`Bearer ${await sign({}, { iss: 'accounts.google.com' })}`), 'resolved');
  assert.equal(await check(`Bearer ${await sign({ email: 'someone@else.com' })}`, null), 'resolved', 'no push account configured: audience only');
  assert.equal(await check(undefined), 'unauthenticated');
  assert.equal(await check('Basic abc'), 'unauthenticated');
  assert.equal(await check(`Bearer ${await sign({}, { aud: 'https://evil.test' })}`), 'unauthenticated');
  assert.equal(await check(`Bearer ${await sign({}, { iss: 'https://evil.test' })}`), 'unauthenticated');
  assert.equal(await check(`Bearer ${await sign({ email: 'attacker@evil.iam.gserviceaccount.com' })}`), 'unauthenticated');
  assert.equal(await check(`Bearer ${await sign({ email_verified: false })}`), 'unauthenticated');
  assert.equal(await check(`Bearer ${await sign({}, { exp: '-1m' })}`), 'unauthenticated');
  const other = await generateKeyPair('RS256');
  assert.equal(await check(`Bearer ${await sign({}, { key: other.privateKey })}`), 'unauthenticated', 'not signed by Google');
});

test('RTDN: purchase → renewal (trial converts) → cancel → expiry; late acknowledgement; unknown data ignored', async () => {
  const api = fakeApi();
  const user = await newUser();
  const t = token();
  api.store[t] = trialSub(user);
  api.ownerOf[t] = user;
  const push = (type: number, purchaseToken = t, packageName = PKG) => ({
    message: { data: Buffer.from(JSON.stringify({ version: '1.0', packageName, eventTimeMillis: String(now), subscriptionNotification: { version: '1.0', notificationType: type, purchaseToken, subscriptionId: 'exama_student' } })).toString('base64') },
  });
  const handle = (body: unknown) => google.handleGoogleNotification(api, google.decodePushMessage(body), { packageName: PKG });

  // SUBSCRIPTION_PURCHASED arrives but the app never reported it (crash): stored AND acknowledged.
  assert.deepEqual(await handle(push(4)), { handled: true, userId: user });
  assert.equal((await getSubscription(user))?.status, 'trialing');
  assert.deepEqual(api.acks, [{ productId: 'exama_student', token: t, storedBefore: true }]);

  // SUBSCRIPTION_RENEWED after the trial: paid.
  api.store[t] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user }, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', line: { expiryTime: iso(now + 37 * DAY) } });
  await handle(push(2));
  const renewed = await getEntitlement(user);
  assert.deepEqual([renewed.status, renewed.tier, renewed.provider], ['active', 'student', 'google']);

  // SUBSCRIPTION_CANCELED: keeps access until expiry.
  api.store[t].subscriptionState = 'SUBSCRIPTION_STATE_CANCELED';
  await handle(push(3));
  assert.deepEqual([(await getEntitlement(user)).status, (await getEntitlement(user)).tier], ['cancelled', 'student']);

  // SUBSCRIPTION_EXPIRED (13) / REVOKED (12): access ends.
  api.store[t].subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED';
  api.store[t].lineItems[0].expiryTime = iso(now - 1000);
  await handle(push(13));
  assert.deepEqual([(await getEntitlement(user)).status, (await getEntitlement(user)).tier], ['expired', 'free']);
  assert.equal(api.acks.length, 1);

  await flushAnalytics();
  const events = await sql`select name, properties from analytics_events where user_id = ${user} order by created_at`;
  const names = events.map((e) => e.name);
  for (const n of ['trial_started', 'subscription_started', 'subscription_cancelled', 'subscription_expired']) assert.ok(names.includes(n), `${n} in ${names}`);
  assert.equal(events.find((e) => e.name === 'subscription_started')?.properties.from_trial, true);
  assert.ok(events.every((e) => !e.properties.provider || (e.properties.provider === 'google' && e.properties.environment === 'sandbox')));
  assert.ok(!JSON.stringify(events).includes(t), 'purchase tokens are never recorded in analytics');

  // Upgrade: new token without an account id is matched through linkedPurchaseToken.
  const up = token();
  api.store[up] = sub({ linkedPurchaseToken: t, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', line: { productId: 'exama_pro', offerDetails: { basePlanId: 'monthly' } } });
  assert.deepEqual(await handle(push(4, up)), { handled: true, userId: user });
  assert.deepEqual([(await getSubscription(user))?.planId, (await getSubscription(user))?.providerRef], ['pro_monthly', up]);

  // Ignored (acknowledged with 2xx so Pub/Sub stops retrying): unknown token, other app, test message, unknown account.
  assert.deepEqual(await handle(push(4, token())), { handled: false });
  assert.deepEqual(await handle(push(4, up, 'com.other.app')), { handled: false });
  assert.deepEqual(await handle({ message: { data: Buffer.from(JSON.stringify({ packageName: PKG, testNotification: { version: '1.0' } })).toString('base64') } }), { handled: false });
  const stranger = token();
  api.store[stranger] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: crypto.randomUUID() } });
  assert.deepEqual(await handle(push(4, stranger)), { handled: false });
  assert.throws(() => google.decodePushMessage({}), /Missing Pub\/Sub message/);
  assert.throws(() => google.decodePushMessage({ message: { data: '!!!not-json' } }), /Invalid Pub\/Sub message/);
});

test('RTDN: an old Play token expiring never overwrites an active App Store subscription', async () => {
  const api = fakeApi();
  const user = await newUser();
  const t = token();
  api.store[t] = sub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', externalAccountIdentifiers: { obfuscatedExternalAccountId: user } });
  await applySubscriptionUpdate(
    user,
    { provider: 'apple', planId: 'student_yearly', status: 'active', trialEndsAt: null, currentPeriodEndsAt: new Date(now + 200 * DAY), willRenew: true, trialUsed: true, providerRef: `o-${crypto.randomUUID()}`, environment: 'sandbox' },
    'purchase',
  );
  const r = await google.handleGoogleNotification(api, { packageName: PKG, subscriptionNotification: { notificationType: 13, purchaseToken: t, subscriptionId: 'exama_student' } }, { packageName: PKG });
  assert.deepEqual(r, { handled: false });
  assert.deepEqual([(await getEntitlement(user)).provider, (await getEntitlement(user)).status], ['apple', 'active']);
});

test('RTDN: after a plan change, the replaced Play token expiring leaves the new subscription alone', async () => {
  const api = fakeApi();
  const user = await newUser();
  const [oldTok, newTok] = [token(), token()];
  const provider = google.createGoogleProvider(api);
  api.store[oldTok] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user } });
  await purchaseWith(provider, user, { purchaseToken: oldTok, productId: 'exama_student' });
  // Upgrade in Play: new token linked to the old one.
  api.store[newTok] = sub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: user }, linkedPurchaseToken: oldTok, line: { productId: 'exama_pro', offerDetails: { basePlanId: 'annual' }, expiryTime: iso(now + 365 * DAY) } });
  await purchaseWith(provider, user, { purchaseToken: newTok, productId: 'exama_pro' });
  assert.deepEqual([(await getSubscription(user))?.planId, (await getSubscription(user))?.providerRef], ['pro_yearly', newTok], 'upgrade allowed: same store, same account');
  // Google then expires the replaced token.
  api.store[oldTok].subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED';
  const r = await google.handleGoogleNotification(api, { packageName: PKG, subscriptionNotification: { notificationType: 13, purchaseToken: oldTok, subscriptionId: 'exama_student' } }, { packageName: PKG });
  assert.deepEqual(r, { handled: false });
  const e = await getEntitlement(user);
  assert.deepEqual([e.tier, e.status, e.planId], ['pro', 'active', 'pro_yearly']);
});

test('notification reasons', () => {
  const up = (status: 'trialing' | 'active') => ({ status }) as never;
  assert.equal(google.reasonForGoogleNotification(4, null, up('trialing')), 'trial');
  assert.equal(google.reasonForGoogleNotification(4, null, up('active')), 'purchase');
  assert.equal(google.reasonForGoogleNotification(4, { provider: 'google', status: 'active' } as never, up('active')), 'silent', 'already recorded by the app');
  assert.equal(google.reasonForGoogleNotification(2, { status: 'trialing' } as never, up('active')), 'purchase');
  assert.equal(google.reasonForGoogleNotification(2, { status: 'active' } as never, up('active')), 'silent');
  assert.equal(google.reasonForGoogleNotification(3, null, up('active')), 'cancel');
  assert.equal(google.reasonForGoogleNotification(7, null, up('active')), 'restore');
  assert.equal(google.reasonForGoogleNotification(5, null, up('active')), 'silent');
});

test('routes: platform-aware catalog; Play endpoints refuse until configured; store chosen by body', async () => {
  for (const platform of ['ios', 'android', 'web', undefined, 'windows']) {
    const r = await app.request(`/billing/plans${platform ? `?platform=${platform}` : ''}`);
    const c = (await r.json()) as { provider: string | null; purchasesAvailable: boolean; plans: { googleProductId: string; googleBasePlanId: string }[] };
    assert.deepEqual([r.status, c.provider, c.purchasesAvailable], [200, null, false], `platform ${platform}`);
    assert.ok(c.plans.every((p) => p.googleProductId && p.googleBasePlanId));
  }
  const n = await app.request('/billing/google/notifications', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual([n.status, ((await n.json()) as { code: string }).code], [503, 'google_not_configured']);

  const reg = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `google-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'G' }),
  });
  const { token: jwt } = (await reg.json()) as AuthResponse;
  for (const [path, body] of [
    ['/billing/purchase', { store: 'google', purchaseToken: token(), productId: 'exama_student' }],
    ['/billing/restore', { purchases: [] }],
    ['/billing/purchase', { store: 'apple', signedTransaction: 'x' }],
  ] as const) {
    const r = await app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` } });
    assert.deepEqual([r.status, ((await r.json()) as { code: string }).code], [503, 'purchases_unavailable'], path);
  }

  assert.equal(storeForBody({ store: 'google' }), 'google');
  assert.equal(storeForBody({ store: 'apple', purchaseToken: 'x' }), 'apple', 'explicit store wins');
  assert.equal(storeForBody({ signedTransaction: 'x' }), 'apple', 'older iOS builds');
  assert.equal(storeForBody({ signedTransactions: [] }), 'apple');
  assert.equal(storeForBody({ purchaseToken: 'x' }), 'google');
  assert.equal(storeForBody({ purchases: [] }), 'google');
  assert.equal(storeForBody({ planId: 'student_monthly' }), 'mock');
  assert.equal(storeForBody({ store: 'paypal' }), null);
  const g = google.createGoogleProvider(fakeApi());
  assert.equal(requireStore({ purchaseToken: 'x' }, { google: g }), g);
  assert.equal(requireStore({}, { mock: mockProvider }), mockProvider, 'development: bodies without a store go to the mock');
  assert.throws(() => requireStore({ purchaseToken: 'x' }, { mock: mockProvider }), /not available/);
  assert.throws(() => requireStore({ signedTransaction: 'x' }, { google: g }), /not available/);
});

test('Play Developer API client: service-account JWT, token caching, endpoints, errors; tokens never logged', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const TOKEN_URI = 'https://oauth2.example.test/token';
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let nextStatus = 200;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    if (url === TOKEN_URI) return new Response(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3600 }), { status: 200 });
    if (nextStatus !== 200) return new Response('{"error":{}}', { status: nextStatus });
    if (url.includes(':acknowledge')) return new Response('', { status: 200 });
    return new Response(JSON.stringify(sub()), { status: 200 });
  }) as typeof fetch;
  const api = createPlayApi({ serviceAccount: { client_email: 'play@exama-test.iam.gserviceaccount.com', private_key: pem, token_uri: TOKEN_URI }, packageName: PKG, fetchImpl });

  const secretToken = 'abc/def+ghi==secret-purchase-token';
  const s = await api.getSubscription(secretToken);
  assert.equal(s.lineItems[0].productId, 'exama_student');
  await api.acknowledge('exama_student', secretToken);

  const [tok, get, ack] = calls;
  assert.equal(tok.method, 'POST');
  const form = new URLSearchParams(tok.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const { payload } = await jwtVerify(form.get('assertion')!, publicKey, { issuer: 'play@exama-test.iam.gserviceaccount.com', audience: TOKEN_URI });
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(get.url, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/purchases/subscriptionsv2/tokens/${encodeURIComponent(secretToken)}`);
  assert.deepEqual([get.method, get.headers.Authorization], ['GET', 'Bearer ya29.fake']);
  assert.equal(ack.url, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/purchases/subscriptions/exama_student/tokens/${encodeURIComponent(secretToken)}:acknowledge`);
  assert.equal(ack.method, 'POST');
  assert.equal(calls.filter((c) => c.url === TOKEN_URI).length, 1, 'access token cached');

  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(' '));
  try {
    for (const [status, expected] of [[404, 'invalid_purchase'], [410, 'invalid_purchase'], [400, 'invalid_purchase'], [500, 'store_unavailable'], [401, 'store_unavailable']] as const) {
      nextStatus = status;
      assert.equal(await code(api.getSubscription(secretToken)), expected, String(status));
    }
  } finally {
    console.error = orig;
  }
  assert.ok(logged.length > 0 && logged.every((l) => !l.includes('secret-purchase-token') && !l.includes(encodeURIComponent(secretToken)) && !l.includes('ya29')));
});
