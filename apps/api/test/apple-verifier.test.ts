/**
 * App Store purchase verification end to end, with Apple's own SignedDataVerifier and a test
 * certificate chain (test/fixtures/apple: root → intermediate → leaf, with Apple's OIDs).
 * The JWS values are signed here exactly like Apple signs them (ES256, x5c chain in the header).
 *
 * Covered: signature + chain + OIDs + bundle id + environment checks; tampered, foreign-chain,
 * wrong-OID, wrong-app, Xcode and disallowed-Sandbox data refused; purchase / restore over HTTP;
 * App Store Server Notifications for renewal, cancellation (auto-renew off), refund and expiry.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, sign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import type { AuthResponse, Entitlement } from '@study/shared';

const FIX = new URL('./fixtures/apple/', import.meta.url);
const APP_APPLE_ID = 1234567890;
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'false',
  APPLE_IAP_ENABLED: 'true',
  APPLE_APP_APPLE_ID: String(APP_APPLE_ID),
  APPLE_ALLOW_SANDBOX: 'true',
  APPLE_ONLINE_CHECKS: 'false', // no OCSP calls to Apple in tests (certificate dates checked against signedDate)
  APPLE_ROOT_CERTS_DIR: new URL('./roots/', FIX).pathname,
});
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { appleVerifier } = await import('../src/billing/index.js');
const { createAppleVerifier } = await import('../src/billing/providers/apple-verifier.js');
const { getSubscription } = await import('../src/billing/subscriptions.js');
after(async () => {
  await flushAnalytics();
  await sql.end();
});

const BUNDLE = 'com.exama.app';
const DAY = 86_400_000;
const pem = (f: string) => readFileSync(new URL(f, FIX), 'utf8');
const der = (p: string) => new X509Certificate(p).raw.toString('base64');
const CHAIN = [der(pem('leaf.pem')), der(pem('intermediate.pem')), der(pem('roots/root.pem'))];
const LEAF_KEY = createPrivateKey(pem('leaf.key'));

/** Signs a payload the way the App Store does: ES256 JWS with the certificate chain in x5c. */
function jws(payload: object, chain = CHAIN, key = LEAF_KEY): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg: 'ES256', x5c: chain })}.${enc(payload)}`;
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${sig}`;
}

let seq = 0;
const txPayload = (over: Record<string, unknown> = {}): Record<string, unknown> & { originalTransactionId: string; productId: string; appAccountToken?: string } => {
  const now = Date.now();
  seq++;
  return {
    bundleId: BUNDLE,
    productId: 'com.exama.app.student.monthly',
    transactionId: `2000000${seq}`,
    originalTransactionId: `1000000${seq}-${crypto.randomUUID()}`,
    purchaseDate: now,
    expiresDate: now + 30 * DAY,
    signedDate: now,
    type: 'Auto-Renewable Subscription',
    inAppOwnershipType: 'PURCHASED',
    environment: 'Sandbox',
    ...over,
  };
};
const renewalPayload = (originalTransactionId: string, over: Record<string, unknown> = {}) => ({
  originalTransactionId,
  autoRenewProductId: 'com.exama.app.student.monthly',
  productId: 'com.exama.app.student.monthly',
  autoRenewStatus: 1,
  signedDate: Date.now(),
  environment: 'Sandbox',
  ...over,
});
const notification = (type: string, signedTransactionInfo: string, signedRenewalInfo?: string, subtype?: string, env = 'Sandbox') =>
  jws({
    notificationType: type,
    ...(subtype ? { subtype } : {}),
    notificationUUID: crypto.randomUUID(),
    version: '2.0',
    signedDate: Date.now(),
    data: { bundleId: BUNDLE, environment: env, ...(env === 'Production' ? { appAppleId: APP_APPLE_ID } : {}), signedTransactionInfo, ...(signedRenewalInfo ? { signedRenewalInfo } : {}) },
  });

const call = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
async function newUser() {
  const r = await call('/auth/register', { method: 'POST', body: JSON.stringify({ email: `iap-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'I' }) });
  return (await r.json()) as AuthResponse;
}
const status = async (token: string) => (await (await call('/billing/status', {}, token)).json()) as Entitlement;

const verifier = () => {
  assert.ok(appleVerifier, 'APPLE_IAP_ENABLED=true builds a verifier from APPLE_ROOT_CERTS_DIR');
  return appleVerifier;
};

test('a correctly signed Sandbox transaction is verified and decoded', async () => {
  const p = txPayload({ offerType: 1, offerDiscountType: 'FREE_TRIAL', appAccountToken: crypto.randomUUID() });
  const tx = await verifier().verifyTransaction(jws(p));
  assert.deepEqual(
    [tx.bundleId, tx.productId, tx.originalTransactionId, tx.environment, tx.offerType, tx.offerDiscountType, tx.appAccountToken],
    [BUNDLE, p.productId, p.originalTransactionId, 'Sandbox', 1, 'FREE_TRIAL', p.appAccountToken],
  );
  const renewal = await verifier().verifyRenewalInfo(jws(renewalPayload(p.originalTransactionId, { autoRenewStatus: 0 })));
  assert.deepEqual([renewal.originalTransactionId, renewal.autoRenewStatus], [p.originalTransactionId, 0]);
});

test('Production data needs our App Apple ID; tampered, foreign or mis-issued data is refused', async () => {
  const rejects = (jwsValue: string, why: string) => assert.rejects(verifier().verifyTransaction(jwsValue), /could not be verified|not accepted/, why);

  assert.equal((await verifier().verifyTransaction(jws(txPayload({ environment: 'Production' })))).environment, 'Production');

  // Payload changed after signing (e.g. product upgraded to Pro): signature no longer matches.
  const good = jws(txPayload());
  const [h, , s] = good.split('.');
  await rejects(`${h}.${Buffer.from(JSON.stringify(txPayload({ productId: 'com.exama.app.pro.annual' }))).toString('base64url')}.${s}`, 'tampered payload');
  // Same names, different root: the chain doesn't lead to a trusted root.
  await rejects(jws(txPayload(), [der(pem('leaf.pem')), der(pem('evil-inter.pem')), der(pem('evil-root.pem'))]), 'untrusted root');
  // A certificate without Apple's receipt-signing OID.
  await rejects(jws(txPayload(), [der(pem('leaf-no-oid.pem')), CHAIN[1]!, CHAIN[2]!]), 'leaf without the App Store OID');
  // Chain must have exactly leaf, intermediate, root.
  await rejects(jws(txPayload(), CHAIN.slice(0, 2)), 'short chain');
  // Another app's purchase.
  await rejects(jws(txPayload({ bundleId: 'com.other.app' })), 'wrong bundle id');
  // Xcode / StoreKit-testing data is unsigned by Apple: never accepted.
  await rejects(jws(txPayload({ environment: 'Xcode' })), 'Xcode environment');
  await rejects(jws(txPayload({ environment: 'LocalTesting' })), 'LocalTesting environment');
  await rejects('not-a-jws', 'garbage');

  // Sandbox switched off / no App Apple ID configured.
  const roots = [readFileSync(new URL('./roots/root.pem', FIX))];
  const prodOnly = createAppleVerifier({ rootCertificates: roots, bundleId: BUNDLE, appAppleId: APP_APPLE_ID, allowSandbox: false, onlineChecks: false });
  await assert.rejects(prodOnly.verifyTransaction(jws(txPayload())), /not accepted/, 'sandbox off');
  const sandboxOnly = createAppleVerifier({ rootCertificates: roots, bundleId: BUNDLE, allowSandbox: true, onlineChecks: false });
  await assert.rejects(sandboxOnly.verifyTransaction(jws(txPayload({ environment: 'Production' }))), /not accepted/, 'production without App Apple ID');
  // Notifications are checked for our bundle id and (Production) our App Apple ID too.
  const n = await verifier().verifyNotification(notification('TEST', jws(txPayload({ environment: 'Production' })), undefined, undefined, 'Production'));
  assert.equal(n.notificationType, 'TEST');
  const otherApp = jws({ notificationType: 'DID_RENEW', notificationUUID: crypto.randomUUID(), signedDate: Date.now(), data: { bundleId: BUNDLE, environment: 'Production', appAppleId: 42 } });
  await assert.rejects(verifier().verifyNotification(otherApp), /could not be verified/, 'another app’s Apple ID');
});

test('purchase over HTTP: a verified App Store purchase unlocks the plan; the trial offer gives trial limits', async () => {
  const { token, user } = await newUser();
  const catalog = (await (await call('/billing/plans?platform=ios')).json()) as { provider: string; purchasesAvailable: boolean };
  assert.deepEqual([catalog.provider, catalog.purchasesAvailable], ['apple', true]);

  const p = txPayload({ offerType: 1, offerDiscountType: 'FREE_TRIAL', expiresDate: Date.now() + 7 * DAY, appAccountToken: user.id });
  const r = await call('/billing/purchase', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransaction: jws(p) }) }, token);
  assert.equal(r.status, 200, await r.clone().text());
  const e = (await r.json()) as Entitlement;
  assert.deepEqual([e.status, e.tier, e.provider, e.features.weakTopicAnalysis], ['trialing', 'trial', 'apple', true]);

  // Forged purchase (bad signature) → refused, nothing stored.
  const other = await newUser();
  const signed = jws(txPayload({ appAccountToken: other.user.id }));
  const i = signed.lastIndexOf('.') + 10; // flip a character inside the signature
  const forged = signed.slice(0, i) + (signed[i] === 'A' ? 'B' : 'A') + signed.slice(i + 1);
  const bad = await call('/billing/purchase', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransaction: forged }) }, other.token);
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, 'invalid_purchase');
  assert.equal((await status(other.token)).isPremium, false);

  // Someone else's transaction (appAccountToken = another user) can't be claimed.
  const stolen = await call('/billing/purchase', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransaction: jws(p) }) }, other.token);
  assert.equal(stolen.status, 409);
});

test('notifications: renewal converts the trial, auto-renew off = cancelled, refund and expiry end access', async () => {
  const { token, user } = await newUser();
  const original = `1000000-${crypto.randomUUID()}`;
  const trial = txPayload({ originalTransactionId: original, offerType: 1, offerDiscountType: 'FREE_TRIAL', expiresDate: Date.now() + 7 * DAY, appAccountToken: user.id });
  await call('/billing/purchase', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransaction: jws(trial) }) }, token);
  const post = (signedPayload: string) => call('/billing/apple/notifications', { method: 'POST', body: JSON.stringify({ signedPayload }) });

  // Paid renewal after the trial.
  const renewed = txPayload({ originalTransactionId: original, appAccountToken: user.id, expiresDate: Date.now() + 30 * DAY });
  assert.equal((await post(notification('DID_RENEW', jws(renewed), jws(renewalPayload(original))))).status, 200);
  let e = await status(token);
  assert.deepEqual([e.status, e.tier, e.planId], ['active', 'student', 'student_monthly']);

  // Turned off auto-renew in Settings: keeps access until the period ends.
  assert.equal((await post(notification('DID_CHANGE_RENEWAL_STATUS', jws(renewed), jws(renewalPayload(original, { autoRenewStatus: 0 })), 'AUTO_RENEW_DISABLED'))).status, 200);
  e = await status(token);
  assert.deepEqual([e.status, e.isPremium, e.willRenew], ['cancelled', true, false]);

  // Refund: revocationDate → access ends now.
  const refunded = { ...renewed, revocationDate: Date.now() - 1000, signedDate: Date.now() };
  assert.equal((await post(notification('REFUND', jws(refunded)))).status, 200);
  e = await status(token);
  assert.deepEqual([e.status, e.isPremium], ['expired', false]);
  assert.equal((await getSubscription(user.id))?.status, 'expired');

  // Expiry of another subscriber.
  const b = await newUser();
  const o2 = `1000000-${crypto.randomUUID()}`;
  await call('/billing/purchase', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransaction: jws(txPayload({ originalTransactionId: o2, appAccountToken: b.user.id })) }) }, b.token);
  assert.equal((await status(b.token)).isPremium, true);
  const lapsed = txPayload({ originalTransactionId: o2, appAccountToken: b.user.id, purchaseDate: Date.now() - 31 * DAY, expiresDate: Date.now() - DAY });
  await post(notification('EXPIRED', jws(lapsed), jws(renewalPayload(o2, { autoRenewStatus: 0 })), 'VOLUNTARY'));
  assert.equal((await status(b.token)).isPremium, false);

  // Forged notification (untrusted chain) → 400, nothing changes.
  const evil = jws(
    { notificationType: 'DID_RENEW', notificationUUID: crypto.randomUUID(), signedDate: Date.now(), data: { bundleId: BUNDLE, environment: 'Sandbox', signedTransactionInfo: jws(renewed) } },
    [der(pem('leaf.pem')), der(pem('evil-inter.pem')), der(pem('evil-root.pem'))],
  );
  assert.equal((await post(evil)).status, 400);
  assert.equal((await status(token)).isPremium, false);
});

test('restore: only this account’s verified, still-active App Store purchases', async () => {
  const { token, user } = await newUser();
  const mine = jws(txPayload({ productId: 'com.exama.app.pro.annual', appAccountToken: user.id, expiresDate: Date.now() + 300 * DAY }));
  const old = jws(txPayload({ appAccountToken: user.id, expiresDate: Date.now() - DAY }));
  const notMine = jws(txPayload({ appAccountToken: crypto.randomUUID() }));
  const r = await call('/billing/restore', { method: 'POST', body: JSON.stringify({ store: 'apple', signedTransactions: [old, notMine, mine] }) }, token);
  assert.equal(r.status, 200);
  const e = (await r.json()) as Entitlement;
  assert.deepEqual([e.tier, e.planId, e.status], ['pro', 'pro_yearly', 'active']);
});
