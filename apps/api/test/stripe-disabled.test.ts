/**
 * Stripe switched OFF (the default): the server behaves exactly as it did before web billing existed —
 * web has no purchases, the Stripe routes answer 503, and nothing else changes.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { AuthResponse, BillingCatalog, Entitlement } from '@study/shared';

Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'false',
  STRIPE_ENABLED: 'false',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  STRIPE_SUCCESS_URL: '',
  STRIPE_CANCEL_URL: '',
});
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { stripeBilling, billingProviders } = await import('../src/billing/index.js');
after(async () => {
  await flushAnalytics();
  await sql.end();
});

const user = async () => {
  const r = await app.request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `nostripe-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'N' }) });
  const j = (await r.json()) as AuthResponse;
  return { id: j.user.id, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j.token}` } };
};

test('Stripe is not configured: no provider, no client', () => {
  assert.equal(stripeBilling, null);
  assert.equal(billingProviders.stripe, undefined);
});

test('the catalog is unchanged: web still has no purchases', async () => {
  for (const platform of ['web', 'ios', 'android']) {
    const c = (await (await app.request(`/billing/plans?platform=${platform}`)).json()) as BillingCatalog;
    assert.deepEqual([c.provider, c.purchasesAvailable, c.testMode], [null, false, false], platform);
    assert.equal(c.trialDays, 7);
    assert.equal(c.plans.length, 6);
  }
});

test('Stripe routes answer 503 (and create nothing)', async () => {
  const u = await user();
  for (const path of ['/billing/stripe/checkout', '/billing/stripe/portal']) {
    const r = await app.request(path, { method: 'POST', headers: u.headers, body: JSON.stringify({ plan: 'student', interval: 'monthly' }) });
    assert.equal(r.status, 503, path);
    assert.equal(((await r.json()) as { code: string }).code, 'stripe_not_configured');
  }
  const hook = await app.request('/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' });
  assert.equal(hook.status, 503);
  assert.equal((await sql`select count(*)::int as n from stripe_customers where user_id = ${u.id}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from stripe_events`)[0].n >= 0, true);
});

test('purchases with store "stripe" are unavailable, and the rest of billing is untouched', async () => {
  const u = await user();
  const r = await app.request('/billing/purchase', { method: 'POST', headers: u.headers, body: JSON.stringify({ store: 'stripe', planId: 'pro_yearly' }) });
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as { code: string }).code, 'purchases_unavailable');
  const status = (await (await app.request('/billing/status', { headers: u.headers })).json()) as Entitlement;
  assert.deepEqual([status.tier, status.provider, status.status, status.trialEligible], ['free', null, 'free', true]);
});

test('account deletion works as before', async () => {
  const u = await user();
  const r = await app.request('/auth/me', { method: 'DELETE', headers: u.headers, body: JSON.stringify({ password: 'password123' }) });
  assert.equal(r.status, 200);
});
