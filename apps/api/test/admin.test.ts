/**
 * Owner-only admin dashboard: access control on every endpoint (server side), audit log, validation
 * (pagination, filters, date ranges), account categories matching the entitlement resolver, Stripe money
 * figures (refunds, fees, trials are not revenue), AI usage recording and cost estimates, the analytics
 * funnel, health, and that no secrets or document content ever appear in a response.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { AdminAIReport, AdminAnalyticsReport, AdminBillingReport, AdminCustomerDetail, AdminCustomersPage, AdminHealth, AdminOverview, AuthResponse, DocumentDetail } from '@study/shared';
import { startFakeAnthropic } from './helpers/fake-anthropic.js';

const RUN = Date.now();
const OWNER_EMAIL = `admin-owner-${RUN}@example.com`;
const OWNER_ID = crypto.randomUUID();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  OWNER_EMAILS: OWNER_EMAIL.toUpperCase(),
  OWNER_USER_IDS: OWNER_ID,
  STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_FAKE_admin_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_FAKE_admin_test',
  STRIPE_BASIC_MONTHLY_PRICE_ID: 'price_bm',
  STRIPE_BASIC_YEARLY_PRICE_ID: 'price_by',
  STRIPE_STUDENT_MONTHLY_PRICE_ID: 'price_sm',
  STRIPE_STUDENT_YEARLY_PRICE_ID: 'price_sy',
  STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pm',
  STRIPE_PRO_YEARLY_PRICE_ID: 'price_py',
  STRIPE_SUCCESS_URL: 'https://app.example.test/checkout?status=success',
  STRIPE_CANCEL_URL: 'https://app.example.test/checkout?status=cancelled',
});
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { stripeBilling } = await import('../src/billing/index.js');
const { getEntitlement } = await import('../src/billing/entitlements.js');
const { summarizeStripe, clearStripeCache, resolveRange } = await import('../src/admin/service.js');
const { recordAIUsage, flushAIUsage } = await import('../src/admin/ai-usage-recorder.js');
const { estimateAICostMicroUsd, AI_PRICING_VERSION } = await import('../src/billing/ai-pricing.js');
const { withAIUsage } = await import('../src/ai/usage.js');
const { AnthropicProvider } = await import('../src/ai/providers/anthropic.js');
after(() => sql.end());

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, text, body: (text ? JSON.parse(text) : null) as T & { code?: string } };
}
const post = (body: unknown, token?: string) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });
let n = 0;
async function newUser(email = `admin-${RUN}-${n++}@example.com`) {
  const r = await call<AuthResponse>('/auth/register', post({ email, password: 'password123', name: 'Tester', ageRange: '18_24' }));
  assert.equal(r.status, 201, r.text);
  return { token: r.body.token, id: r.body.user.id, email };
}
const setState = (token: string, state: string) => call('/billing/mock/state', post({ state }, token));

const ENDPOINTS = ['/admin/access', '/admin/overview', '/admin/customers', `/admin/customers/${crypto.randomUUID()}`, '/admin/ai', '/admin/billing', '/admin/analytics', '/admin/health'];

let owner: Awaited<ReturnType<typeof newUser>>;
let free: Awaited<ReturnType<typeof newUser>>;
let trial: Awaited<ReturnType<typeof newUser>>;
let paid: Awaited<ReturnType<typeof newUser>>;
let cancelling: Awaited<ReturnType<typeof newUser>>;
let lapsed: Awaited<ReturnType<typeof newUser>>;
let stripeTrial: Awaited<ReturnType<typeof newUser>>;
let google: Awaited<ReturnType<typeof newUser>>;
const GOOGLE_TOKEN = `google-purchase-token-${RUN}-secret`;

// Fake Stripe reads (live in production): two successful charges, one failed, one refund.
const stripeCalls: unknown[] = [];
before(async () => {
  assert.ok(stripeBilling, 'Stripe is enabled in the test environment');
  const now = Math.floor(Date.now() / 1000);
  Object.assign(stripeBilling.api, {
    async listCharges(range: unknown) {
      stripeCalls.push(range);
      return {
        items: [
          { id: 'ch_ok1', created: now - 100, amount: 1499, amountRefunded: 0, currency: 'eur', status: 'succeeded', customerId: 'cus_1', fee: 47, failureCode: null, livemode: false },
          { id: 'ch_ok2', created: now - 200, amount: 11999, amountRefunded: 11999, currency: 'eur', status: 'succeeded', customerId: 'cus_2', fee: 194, failureCode: null, livemode: false },
          { id: 'ch_fail', created: now - 300, amount: 999, amountRefunded: 0, currency: 'eur', status: 'failed', customerId: 'cus_3', fee: null, failureCode: 'card_declined', livemode: false },
        ],
        truncated: false,
      };
    },
    async listRefunds() {
      return { items: [{ id: 're_1', created: now - 50, amount: 11999, currency: 'eur', status: 'succeeded', chargeId: 'ch_ok2' }], truncated: false };
    },
  });

  owner = await newUser(OWNER_EMAIL);
  free = await newUser();
  trial = await newUser();
  paid = await newUser();
  cancelling = await newUser();
  lapsed = await newUser();
  stripeTrial = await newUser();
  google = await newUser();
  assert.equal((await setState(trial.token, 'trial')).status, 200);
  assert.equal((await setState(paid.token, 'student_monthly')).status, 200);
  assert.equal((await setState(cancelling.token, 'pro_yearly')).status, 200);
  await sql`update subscriptions set status = 'cancelled', will_renew = false where user_id = ${cancelling.id}`;
  assert.equal((await setState(lapsed.token, 'basic_monthly')).status, 200);
  await sql`update subscriptions set current_period_ends_at = now() - interval '1 day' where user_id = ${lapsed.id}`; // lapsed, not yet marked expired
  await sql`insert into subscriptions (user_id, provider, plan_id, status, trial_ends_at, current_period_ends_at, trial_used, provider_ref, environment)
    values (${stripeTrial.id}, 'stripe', 'pro_monthly', 'trialing', now() + interval '3 days', now() + interval '3 days', true, ${`sub_${RUN}`}, 'test')`;
  await sql`insert into stripe_customers (user_id, stripe_customer_id) values (${stripeTrial.id}, ${`cus_${RUN}`})`;
  await sql`insert into subscriptions (user_id, provider, plan_id, status, current_period_ends_at, trial_used, provider_ref, environment)
    values (${google.id}, 'google', 'student_yearly', 'active', now() + interval '200 days', true, ${GOOGLE_TOKEN}, 'production')`;
  await sql`update users set email_verified_at = now() where id = ${free.id}`;
});

test('every admin endpoint refuses non-owners (403) and anonymous requests (401); refusals are audited', async () => {
  for (const path of ENDPOINTS) {
    assert.equal((await call(path)).status, 401, `${path} anonymous`);
    for (const u of [free, paid, trial]) {
      const r = await call(path, { token: u.token });
      assert.equal(r.status, 403, `${path} as a customer`);
      assert.equal(r.body.code, 'forbidden');
      assert.ok(!r.text.includes('@example.com'), 'no customer data in a refusal');
    }
  }
  // Query parameters can't grant anything either.
  assert.equal((await call('/admin/customers?owner=true&role=admin', { token: free.token })).status, 403);
  const [refused] = await sql`select count(*)::int as n from admin_audit_log where actor_user_id = ${free.id} and allowed = false`;
  assert.ok(refused.n >= ENDPOINTS.length + 1);
  // Only the server's owner configuration counts: not a lookalike email.
  const lookalike = await newUser(`ADMIN-owner-${RUN}@example.com.evil.test`);
  assert.equal((await call('/admin/access', { token: lookalike.token })).status, 403);
});

test('owners get every endpoint; access is audited with bounded, non-secret parameters', async () => {
  for (const path of ENDPOINTS.filter((p) => !p.includes('/customers/'))) {
    const r = await call(path, { token: owner.token });
    assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 200)}`);
  }
  assert.equal((await call(`/admin/customers/${crypto.randomUUID()}`, { token: owner.token })).status, 404);
  assert.equal((await call(`/admin/customers/${free.id}`, { token: owner.token })).status, 200);
  const log = await sql`select action, params, target_user_id, allowed, status from admin_audit_log where actor_user_id = ${owner.id} order by created_at`;
  assert.ok(log.some((l) => l.action === 'GET /admin/customers/:id' && l.target_user_id === free.id && l.allowed && l.status === 200));
  await call(`/admin/customers?q=${'x'.repeat(100)}&limit=5&token=abc`, { token: owner.token });
  const [last] = await sql`select params from admin_audit_log where actor_user_id = ${owner.id} and action = 'GET /admin/customers' order by created_at desc limit 1`;
  assert.deepEqual(Object.keys(last.params).sort(), ['limit', 'q'], 'unknown keys (like a token) are not stored');
  assert.equal(last.params.q, '[100 chars]', 'search text (possibly an email) is not stored');

  // A deleted customer is unlinked from the audit trail; the access record itself stays.
  const gone = await newUser();
  assert.equal((await call(`/admin/customers/${gone.id}`, { token: owner.token })).status, 200);
  assert.equal((await call('/auth/me', { method: 'DELETE', body: JSON.stringify({ password: 'password123' }), headers: { 'Content-Type': 'application/json' }, token: gone.token })).status, 200);
  const [{ linked }] = await sql`select count(*)::int as linked from admin_audit_log where target_user_id = ${gone.id}`;
  assert.equal(linked, 0);
});

test('validation: pagination limits, filters and date ranges', async () => {
  const bad = [
    '/admin/customers?limit=101',
    '/admin/customers?limit=0',
    '/admin/customers?page=0',
    '/admin/customers?page=1001',
    '/admin/customers?category=vip',
    '/admin/customers?status=past_due',
    '/admin/customers?signupFrom=2026-10-10&signupTo=2026-10-01',
    '/admin/customers?signupFrom=yesterday',
    `/admin/customers?q=${'a'.repeat(101)}`,
    '/admin/overview?range=1y',
    '/admin/overview?from=2025-01-01&to=2026-06-01',
    '/admin/overview?from=2026-10-01',
    '/admin/overview?range=7d&from=2026-10-01&to=2026-10-02',
    '/admin/analytics?from=2026-01-01&to=2026-10-01&interval=day',
    '/admin/ai?interval=hour',
  ];
  for (const path of bad) assert.equal((await call(path, { token: owner.token })).status, 400, path);
  const r = resolveRange({ from: '2026-01-01', to: '2026-03-01' }, new Date('2026-10-17T00:00:00Z'));
  assert.equal(r.interval, 'week');
  assert.equal(resolveRange({}, new Date()).label, '30d');

  // Pagination over this run's accounts only (search by the run's email prefix).
  const p1 = await call<AdminCustomersPage>(`/admin/customers?q=admin-${RUN}&limit=3&page=1`, { token: owner.token });
  const p2 = await call<AdminCustomersPage>(`/admin/customers?q=admin-${RUN}&limit=3&page=2`, { token: owner.token });
  assert.equal(p1.body.items.length, 3);
  assert.ok(p1.body.total >= 7 && p1.body.hasMore);
  assert.equal(new Set([...p1.body.items, ...p2.body.items].map((c) => c.id)).size, p1.body.items.length + p2.body.items.length, 'no overlap between pages');
  // "%" and "_" are literal in searches.
  assert.equal((await call<AdminCustomersPage>('/admin/customers?q=%25', { token: owner.token })).body.total, 0);
});

test('accounts are Free, trial, paid or owner — the same answer as the entitlement resolver', async () => {
  const page = (await call<AdminCustomersPage>(`/admin/customers?q=${RUN}&limit=100`, { token: owner.token })).body.items;
  const byId = new Map(page.map((c) => [c.id, c]));
  const expected: [typeof owner, string, string][] = [
    [owner, 'owner', 'owner (full access)'],
    [free, 'free', 'free'],
    [trial, 'trial', 'trial'],
    [paid, 'paid', 'student'],
    [cancelling, 'paid', 'pro'],
    [lapsed, 'free', 'free'],
    [stripeTrial, 'trial', 'pro'], // a Stripe trial gets its plan's tier at once, but it is still a trial, not paid
    [google, 'paid', 'student'],
  ];
  for (const [u, category, tier] of expected) {
    const c = byId.get(u.id)!;
    assert.ok(c, u.email);
    assert.deepEqual([c.category, c.entitlementTier], [category, tier], u.email);
    if (category !== 'owner') {
      const e = await getEntitlement(u.id);
      assert.equal(e.tier, tier === 'owner (full access)' ? 'pro' : tier, `${u.email} matches getEntitlement`);
    }
  }
  assert.equal(byId.get(free.id)!.emailVerified, true);
  assert.equal(byId.get(cancelling.id)!.willRenew, false);
  for (const [category, ids] of Object.entries({ trial: [trial.id, stripeTrial.id], paid: [paid.id, cancelling.id, google.id], owner: [owner.id] })) {
    const r = await call<AdminCustomersPage>(`/admin/customers?q=${RUN}&category=${category}&limit=100`, { token: owner.token });
    assert.deepEqual(r.body.items.map((c) => c.id).sort(), [...ids].sort(), category);
  }
  const s = await call<AdminCustomersPage>(`/admin/customers?q=${RUN}&status=none&limit=100`, { token: owner.token });
  assert.ok(s.body.items.every((c) => c.subscriptionStatus === null) && s.body.items.some((c) => c.id === free.id));
});

test('money: Stripe figures with refunds and fees; recurring revenue is an estimate from renewing production subscriptions only', async () => {
  const sum = summarizeStripe(
    [
      { id: 'a', created: 1, amount: 1000, amountRefunded: 0, currency: 'eur', status: 'succeeded', customerId: null, fee: 30, failureCode: null, livemode: true },
      { id: 'b', created: 1, amount: 500, amountRefunded: 500, currency: 'eur', status: 'succeeded', customerId: null, fee: null, failureCode: null, livemode: true },
      { id: 'c', created: 1, amount: 700, amountRefunded: 0, currency: 'eur', status: 'failed', customerId: null, fee: null, failureCode: 'card_declined', livemode: true },
      { id: 'd', created: 1, amount: 900, amountRefunded: 0, currency: 'usd', status: 'pending', customerId: null, fee: null, failureCode: null, livemode: true },
    ],
    [
      { id: 'r1', created: 1, amount: 500, currency: 'eur', status: 'succeeded', chargeId: 'b' },
      { id: 'r2', created: 1, amount: 100, currency: 'eur', status: 'failed', chargeId: 'a' },
    ],
  );
  const eur = sum.find((m) => m.currency === 'eur')!;
  assert.deepEqual([eur.grossCents, eur.refundedCents, eur.successfulPayments, eur.failedPayments, eur.refunds], [1500, 500, 2, 1, 1]);
  assert.equal(eur.feesCents, null, 'an unknown fee makes fees unknown, never 0');
  assert.equal(eur.netCents, null);
  assert.deepEqual(sum.find((m) => m.currency === 'usd'), { currency: 'usd', grossCents: 0, refundedCents: 0, feesCents: 0, netCents: 0, successfulPayments: 0, failedPayments: 0, refunds: 0 }, 'pending is not revenue');

  clearStripeCache();
  const o = await call<AdminOverview>('/admin/overview?range=7d', { token: owner.token });
  assert.equal(o.status, 200);
  assert.ok(o.body.stripe.available);
  if (o.body.stripe.available) {
    assert.deepEqual(o.body.stripe.byCurrency, [{ currency: 'eur', grossCents: 13498, refundedCents: 11999, feesCents: 241, netCents: 1258, successfulPayments: 2, failedPayments: 1, refunds: 1 }]);
  }
  assert.equal(o.body.contribution.available, false, 'EUR payments and USD cost estimates are never subtracted');
  assert.equal(o.body.recurringRevenue.source, 'estimate');
  // A renewing production subscription adds its catalog price (yearly ÷ 12); test-mode ones are excluded.
  const before = o.body.recurringRevenue;
  const extra = await newUser();
  await sql`insert into subscriptions (user_id, provider, plan_id, status, current_period_ends_at, trial_used, environment, will_renew)
    values (${extra.id}, 'stripe', 'pro_yearly', 'active', now() + interval '300 days', true, 'production', true)`;
  const afterRev = (await call<AdminOverview>('/admin/overview?range=7d', { token: owner.token })).body.recurringRevenue;
  assert.ok(Math.abs(afterRev.mrrCents - before.mrrCents - 19999 / 12) <= 1);
  assert.equal(afterRev.payingSubscriptions - before.payingSubscriptions, 1);
  // A trial (Stripe or store) is never counted as paying.
  const cats = (await call<AdminOverview>('/admin/overview?range=7d', { token: owner.token })).body.accounts;
  assert.ok(cats.trial >= 2 && cats.paid >= 4);

  // Billing view: Stripe ids and links, but never a Google purchase token.
  const b = await call<AdminBillingReport>('/admin/billing?range=30d', { token: owner.token });
  const row = b.body.database.subscriptions.find((x) => x.userId === stripeTrial.id)!;
  assert.deepEqual([row.stripeCustomerId, row.stripeSubscriptionId], [`cus_${RUN}`, `sub_${RUN}`]);
  assert.equal(row.stripeUrl, `https://dashboard.stripe.com/test/subscriptions/sub_${RUN}`);
  assert.ok(!b.text.includes(GOOGLE_TOKEN));
  assert.ok(Array.isArray(b.body.charges) && b.body.charges.some((c) => c.status === 'failed' && c.failureCode === 'card_declined'));
});

test('AI usage: recorded per call with user, feature, tokens and a dated estimate; unpriced and missing usage stay unknown', async () => {
  assert.equal(estimateAICostMicroUsd('claude-sonnet-5', { inputTokens: 1000, outputTokens: 500 }), 7000); // $2/M in, $10/M out
  assert.equal(estimateAICostMicroUsd('some-new-model', { inputTokens: 1000, outputTokens: 500 }), null);
  assert.equal(estimateAICostMicroUsd('claude-sonnet-5', { inputTokens: null, outputTokens: null }), null);

  const before = (await call<AdminAIReport>('/admin/ai?range=7d', { token: owner.token })).body.totals;
  // The real provider path: the fake Messages API reports 10 input + 10 output tokens.
  const fake = await startFakeAnthropic(() => ({ text: 'ANSWER-TEXT-7731' }));
  try {
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-5', baseURL: fake.url, maxRetries: 0, onUsage: recordAIUsage });
    await withAIUsage({ userId: paid.id, feature: 'exam_generation' }, () => provider.complete({ system: 's', prompt: 'PROMPT-TEXT-5513' }));
    const failing = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-5', baseURL: 'http://127.0.0.1:1', maxRetries: 0, onUsage: recordAIUsage });
    await assert.rejects(withAIUsage({ userId: paid.id, feature: 'grading' }, () => failing.complete({ system: 's', prompt: 'p' })));
  } finally {
    await fake.close();
  }
  recordAIUsage({ provider: 'anthropic', model: 'unpriced-model', inputTokens: 100, outputTokens: 100, cacheReadTokens: null, cacheWriteTokens: null, latencyMs: 5, success: true, errorCode: null }, { userId: free.id, feature: 'study_plan' });
  await flushAIUsage();

  const rows = await sql`select feature, model, input_tokens, output_tokens, success, error_code, estimated_cost_micro_usd, pricing_version from ai_usage where user_id = ${paid.id} order by feature`;
  assert.deepEqual(rows.map((r) => [r.feature, r.input_tokens, r.output_tokens, r.success, r.estimated_cost_micro_usd, r.pricing_version]), [
    ['exam_generation', 10, 10, true, 120, AI_PRICING_VERSION],
    ['grading', null, null, false, null, null],
  ]);
  assert.ok(rows[1]!.error_code);

  const report = await call<AdminAIReport>('/admin/ai?range=7d', { token: owner.token });
  const t = report.body.totals;
  assert.equal(t.calls - before.calls, 3);
  assert.equal(t.failedCalls - before.failedCalls, 1);
  assert.equal(t.unpricedCalls - before.unpricedCalls, 1, 'an unpriced model is counted, not guessed');
  assert.ok(Math.abs(t.estimatedUsd - before.estimatedUsd - 0.00012) < 1e-9);
  assert.equal(t.source, 'estimate');
  assert.ok(t.trackedSince);
  assert.ok(report.body.byFeature.some((f) => f.feature === 'exam_generation' && f.p50LatencyMs !== null));
  assert.ok(report.body.byModel.some((m) => m.model === 'unpriced-model' && m.unpricedCalls >= 1));
  assert.equal(report.body.prices.version, AI_PRICING_VERSION);
  const detail = await call<AdminCustomerDetail>(`/admin/customers/${paid.id}`, { token: owner.token });
  assert.ok(detail.body.aiByFeature.some((f) => f.feature === 'exam_generation' && f.calls >= 1));
  assert.ok(!report.text.includes('PROMPT-TEXT-5513') && !report.text.includes('ANSWER-TEXT-7731') && !detail.text.includes('ANSWER-TEXT-7731'), 'no prompts or answers');
});

test('funnel: signup cohort with database steps; a trial is not a paid conversion; missing events are listed', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const q = `/admin/analytics?from=${today}&to=${today}`;
  await flushAnalytics();
  const before = (await call<AdminAnalyticsReport>(q, { token: owner.token })).body;
  const u = await newUser();
  await sql`update users set email_verified_at = now() where id = ${u.id}`;
  assert.equal((await call('/billing/purchase', post({ planId: 'student_monthly', startTrial: true }, u.token))).status, 200);
  await flushAnalytics();
  const after = (await call<AdminAnalyticsReport>(q, { token: owner.token })).body;
  const step = (r: AdminAnalyticsReport, k: string) => r.funnel.find((s) => s.key === k)!.users ?? 0;
  assert.equal(step(after, 'signed_up') - step(before, 'signed_up'), 1);
  assert.equal(step(after, 'verified') - step(before, 'verified'), 1);
  assert.equal(step(after, 'trial_started') - step(before, 'trial_started'), 1);
  assert.equal(step(after, 'paid') - step(before, 'paid'), 0, 'starting a trial is not a paid conversion');
  assert.equal((await call('/billing/purchase', post({ planId: 'student_monthly' }, u.token))).status, 200);
  await flushAnalytics();
  const paidAfter = (await call<AdminAnalyticsReport>(q, { token: owner.token })).body;
  assert.equal(step(paidAfter, 'paid') - step(before, 'paid'), 1);
  assert.ok(after.missing.some((m) => m.event === 'checkout_returned' && m.firstSeen === null));
  assert.ok(after.funnel.every((s) => ['database', 'analytics'].includes(s.source)));
  assert.ok(Array.isArray(after.series.signup_completed));
});

test('health and responses never include secrets, password hashes, tokens or document content', async () => {
  const doc = await call<DocumentDetail>('/documents', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new File([pdf], 'biology-notes.pdf', { type: 'application/pdf' })); return f; })(), token: free.token });
  assert.equal(doc.status, 201);
  for (let i = 0; i < 50 && (await call<DocumentDetail>(`/documents/${doc.body.id}`, { token: free.token })).body.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
  const summary = (await call<DocumentDetail>(`/documents/${doc.body.id}`, { token: free.token })).body.summary ?? '';
  const [hash] = await sql`select password_hash from users where id = ${free.id}`;

  const h = await call<AdminHealth>('/admin/health', { token: owner.token });
  assert.equal(h.status, 200);
  assert.equal(h.body.database.upToDate, true);
  assert.ok((h.body.database.migrationsApplied ?? 0) >= 19);
  assert.ok(Object.values(h.body.features).every((v) => v === 'enabled' || v === 'disabled'));

  const texts = [h.text];
  for (const path of ['/admin/overview?range=all', `/admin/customers?q=${RUN}&limit=100`, `/admin/customers/${free.id}`, `/admin/customers/${google.id}`, '/admin/ai?range=all', '/admin/billing?range=90d', '/admin/analytics?range=90d']) {
    const r = await call(path, { token: owner.token });
    assert.equal(r.status, 200, path);
    texts.push(r.text);
  }
  const all = texts.join('\n');
  const forbidden = [hash.password_hash, config.JWT_SECRET, owner.token, free.token, GOOGLE_TOKEN, 'password_hash', 'passwordHash', config.DATABASE_URL];
  if (config.STRIPE_SECRET_KEY) forbidden.push(config.STRIPE_SECRET_KEY);
  if (config.STRIPE_WEBHOOK_SECRET) forbidden.push(config.STRIPE_WEBHOOK_SECRET);
  for (const secret of forbidden) assert.ok(!all.includes(String(secret)), `leaked: ${String(secret).slice(0, 12)}…`);
  if (summary.length > 20) assert.ok(!all.includes(summary.slice(0, 40)), 'no document content');
  assert.ok(!/"(summary|topics|fileKey|file_key|content)"\s*:/.test(all), 'no document fields');
  const detail = JSON.parse(texts[4]!) as AdminCustomerDetail;
  assert.deepEqual([detail.subscription?.provider, detail.subscription?.hasStoreReference, detail.stripe], ['google', true, null]);
});

test('live Stripe reads: concurrent views of a range share one Stripe read, then a 60 s cache', async () => {
  clearStripeCache();
  stripeCalls.length = 0;
  const views = await Promise.all([
    call('/admin/overview?range=30d', { token: owner.token }),
    call('/admin/billing?range=30d', { token: owner.token }),
    call('/admin/overview?range=30d', { token: owner.token }),
  ]);
  assert.deepEqual(views.map((v) => v.status), [200, 200, 200]);
  assert.equal(stripeCalls.length, 1, 'one listCharges for three concurrent views');
  assert.equal((await call('/admin/billing?range=30d', { token: owner.token })).status, 200);
  assert.equal(stripeCalls.length, 1, 'served from the cache');
});
