/**
 * Apple StoreKit 2 boundary: transaction → subscription mapping, account association,
 * notification handling. JWS verification is stubbed with a fake verifier here; in production it
 * must be Apple's SignedDataVerifier (not implemented yet → purchases refused with 503).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { AuthResponse, Entitlement } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'false' });
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { getEntitlement } = await import('../src/billing/entitlements.js');
const { LIMITS } = await import('../src/billing/limits.js');
const apple = await import('../src/billing/providers/apple.js');
const { applySubscriptionUpdate, getSubscription } = await import('../src/billing/subscriptions.js');
type Tx = import('../src/billing/providers/apple.js').AppleTransaction;
after(() => sql.end());

const BUNDLE = 'com.exama.app';
const DAY = 86_400_000;
const now = Date.now();
const tx = (over: Partial<Tx> = {}): Tx => ({
  bundleId: BUNDLE,
  productId: 'com.exama.app.student.monthly',
  transactionId: `t-${Math.random()}`,
  originalTransactionId: `o-${crypto.randomUUID()}`,
  purchaseDate: now,
  expiresDate: now + 30 * DAY,
  environment: 'Sandbox',
  ...over,
});

/** Fake verifier: "JWS" strings are just JSON. Real verification = Apple's library. */
const fakeVerifier: import('../src/billing/providers/apple.js').AppleVerifier = {
  verifyTransaction: async (s) => JSON.parse(s),
  verifyRenewalInfo: async (s) => JSON.parse(s),
  verifyNotification: async (s) => JSON.parse(s),
};

async function newUser() {
  const r = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `apple-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'A' }),
  });
  return ((await r.json()) as AuthResponse).user.id;
}

test('mapping: trial, active, cancelled, grace period, expired, refunded; unknown products rejected', () => {
  const trial = apple.mapAppleTransaction(tx({ offerType: 1, offerDiscountType: 'FREE_TRIAL', expiresDate: now + 7 * DAY }), null);
  assert.deepEqual([trial.status, trial.provider, trial.environment, trial.planId, +trial.trialEndsAt!], ['trialing', 'apple', 'sandbox', 'student_monthly', now + 7 * DAY]);
  assert.equal(+trial.trialEndsAt!, +trial.currentPeriodEndsAt!, 'marks the trial period');

  const cancelledTrial = apple.mapAppleTransaction(tx({ offerType: 1, offerDiscountType: 'FREE_TRIAL' }), { originalTransactionId: 'o', autoRenewStatus: 0 });
  assert.deepEqual([cancelledTrial.status, cancelledTrial.willRenew], ['cancelled', false]);

  const active = apple.mapAppleTransaction(tx({ productId: 'com.exama.app.pro.annual', environment: 'Production' }), { originalTransactionId: 'o', autoRenewStatus: 1 });
  assert.deepEqual([active.status, active.planId, active.environment, active.trialEndsAt], ['active', 'pro_yearly', 'production', null]);

  const grace = apple.mapAppleTransaction(tx({ expiresDate: now - DAY }), { originalTransactionId: 'o', autoRenewStatus: 1, gracePeriodExpiresDate: now + 3 * DAY });
  assert.equal(grace.status, 'active', 'billing grace period keeps access');

  const expired = apple.mapAppleTransaction(tx({ expiresDate: now - DAY }), null);
  assert.equal(expired.status, 'expired');
  const refunded = apple.mapAppleTransaction(tx({ revocationDate: now - 1000 }), null);
  assert.deepEqual([refunded.status, refunded.willRenew], ['expired', false]);

  assert.throws(() => apple.mapAppleTransaction(tx({ productId: 'com.other.app.gold' }), null), /Unknown App Store product/);
  for (const p of ['com.exama.app.student.monthly', 'com.exama.app.student.annual', 'com.exama.app.pro.monthly', 'com.exama.app.pro.annual']) {
    assert.ok(apple.planForProduct(p));
  }
});

test('account association: bundle id and appAccountToken must match the signed-in user', () => {
  const user = crypto.randomUUID();
  assert.doesNotThrow(() => apple.assertTransactionBelongsTo(tx({ appAccountToken: user }), user, BUNDLE));
  assert.throws(() => apple.assertTransactionBelongsTo(tx({ appAccountToken: user, bundleId: 'com.evil.app' }), user, BUNDLE), /different app/);
  assert.throws(() => apple.assertTransactionBelongsTo(tx({ appAccountToken: crypto.randomUUID() }), user, BUNDLE), /different Exama account/);
  assert.throws(() => apple.assertTransactionBelongsTo(tx({}), user, BUNDLE), /different Exama account/);
});

test('notification reasons: subscribe, trial conversion, cancel/resume', () => {
  const up = (status: 'trialing' | 'active') => ({ status }) as never;
  assert.equal(apple.reasonForNotification({ notificationType: 'SUBSCRIBED', subtype: 'INITIAL_BUY' }, null, up('trialing')), 'trial');
  assert.equal(apple.reasonForNotification({ notificationType: 'SUBSCRIBED', subtype: 'RESUBSCRIBE' }, null, up('active')), 'purchase');
  assert.equal(apple.reasonForNotification({ notificationType: 'DID_RENEW' }, { status: 'trialing' } as never, up('active')), 'purchase');
  assert.equal(apple.reasonForNotification({ notificationType: 'DID_RENEW' }, { status: 'active' } as never, up('active')), 'silent');
  assert.equal(apple.reasonForNotification({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED' }, null, up('active')), 'cancel');
  assert.equal(apple.reasonForNotification({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_ENABLED' }, null, up('active')), 'restore');
});

test('provider: verified purchase → trial limits; a transaction cannot be claimed by two accounts', async () => {
  const provider = apple.createAppleProvider(fakeVerifier, { bundleId: BUNDLE });
  const alice = await newUser();
  const bob = await newUser();
  const t = tx({ appAccountToken: alice, offerType: 1, offerDiscountType: 'FREE_TRIAL', expiresDate: now + 7 * DAY });

  await assert.rejects(provider.purchase(alice, { planId: 'student_monthly' }, null), /Required|invalid|expected/i, 'mock-style input is rejected');
  const r = await provider.purchase(alice, { signedTransaction: JSON.stringify(t) }, null);
  assert.equal(r.reason, 'trial');
  await applySubscriptionUpdate(alice, r.update, r.reason);
  const e: Entitlement = await getEntitlement(alice);
  assert.deepEqual([e.tier, e.provider, e.limits], ['trial', 'apple', LIMITS.trial], 'Apple trials get the restricted trial tier too');

  // Bob replays Alice's transaction: wrong appAccountToken…
  await assert.rejects(provider.purchase(bob, { signedTransaction: JSON.stringify(t) }, null), /different Exama account/);
  // …and even with a forged token the originalTransactionId is already linked to Alice.
  await assert.rejects(provider.purchase(bob, { signedTransaction: JSON.stringify({ ...t, appAccountToken: bob }) }, null), /already linked/);

  // Restore only returns this account's live purchases.
  const restored = await provider.restore(alice, { signedTransactions: [JSON.stringify(t), JSON.stringify(tx({ appAccountToken: bob }))] }, null);
  assert.equal(restored?.providerRef, t.originalTransactionId);
  assert.equal(await provider.restore(bob, { signedTransactions: [JSON.stringify(t)] }, null), null);
});

test('App Store Server Notifications: renewal converts the trial, refund expires it, unknown accounts are acknowledged', async () => {
  const user = await newUser();
  const original = `o-${crypto.randomUUID()}`;
  const trial = tx({ appAccountToken: user, originalTransactionId: original, offerType: 1, offerDiscountType: 'FREE_TRIAL', expiresDate: now + 7 * DAY });
  const note = (notificationType: string, t: Tx, subtype?: string) =>
    JSON.stringify({ notificationType, subtype, notificationUUID: crypto.randomUUID(), data: { bundleId: BUNDLE, signedTransactionInfo: JSON.stringify(t) } });

  await apple.handleAppleNotification(fakeVerifier, note('SUBSCRIBED', trial, 'INITIAL_BUY'), { bundleId: BUNDLE });
  assert.equal((await getSubscription(user))?.status, 'trialing');

  // Renewal (no appAccountToken on this transaction → matched by originalTransactionId).
  await apple.handleAppleNotification(fakeVerifier, note('DID_RENEW', tx({ originalTransactionId: original, expiresDate: now + 37 * DAY })), { bundleId: BUNDLE });
  const renewed = await getEntitlement(user);
  assert.deepEqual([renewed.status, renewed.tier], ['active', 'student']);

  await apple.handleAppleNotification(fakeVerifier, note('REFUND', tx({ originalTransactionId: original, revocationDate: now - 1000 })), { bundleId: BUNDLE });
  assert.equal((await getEntitlement(user)).status, 'expired');

  await flushAnalytics();
  const events = await sql`select name, properties from analytics_events where user_id = ${user} order by created_at`;
  const names = events.map((e) => e.name);
  assert.ok(names.includes('trial_started') && names.includes('subscription_started') && names.includes('subscription_expired'));
  assert.equal(events.find((e) => e.name === 'subscription_started')?.properties.from_trial, true);
  assert.ok(events.every((e) => !e.properties.provider || (e.properties.provider === 'apple' && e.properties.environment === 'sandbox')));

  const unknown = await apple.handleAppleNotification(fakeVerifier, note('DID_RENEW', tx()), { bundleId: BUNDLE });
  assert.equal(unknown.handled, false);
  const otherApp = await apple.handleAppleNotification(
    fakeVerifier,
    JSON.stringify({ notificationType: 'DID_RENEW', notificationUUID: 'x', data: { bundleId: 'com.other', signedTransactionInfo: JSON.stringify(trial) } }),
    { bundleId: BUNDLE },
  );
  assert.equal(otherApp.handled, false);
});

test('until Apple verification is configured, the server refuses Apple data and purchases', async () => {
  const r = await app.request('/billing/apple/notifications', { method: 'POST', body: JSON.stringify({ signedPayload: 'x' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as { code: string }).code, 'apple_not_configured');
  const catalog = (await (await app.request('/billing/plans')).json()) as { provider: string | null; purchasesAvailable: boolean };
  assert.deepEqual([catalog.provider, catalog.purchasesAvailable], [null, false]);
});
