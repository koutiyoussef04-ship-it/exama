/**
 * Stripe web billing: Checkout requests, customer mapping, duplicate-subscription guards, the Customer
 * Portal, webhook verification and idempotency, and how every Stripe subscription state becomes Exama
 * access through the EXISTING entitlement system.
 *
 * Stripe's network is replaced by a fake API; webhook signatures are verified by the real Stripe SDK,
 * so the signature tests exercise the production code path. Nothing here talks to Stripe.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import Stripe from 'stripe';
import type { AuthResponse, BillingCatalog, PlanId } from '@study/shared';

const OWNER_EMAIL = `owner-stripe-${crypto.randomUUID()}@example.com`;
const WEBHOOK_SECRET = 'whsec_FAKE_unit_test';
const PRICES: Record<PlanId, string> = {
  basic_monthly: 'price_basic_monthly_test',
  basic_yearly: 'price_basic_yearly_test',
  student_monthly: 'price_student_monthly_test',
  student_yearly: 'price_student_yearly_test',
  pro_monthly: 'price_pro_monthly_test',
  pro_yearly: 'price_pro_yearly_test',
};
const SUCCESS_URL = 'https://app.example.test/checkout?status=success';
const CANCEL_URL = 'https://app.example.test/checkout?status=cancelled';
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'false',
  OWNER_EMAILS: OWNER_EMAIL,
  OWNER_USER_IDS: '',
  STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_FAKE_unit_test',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_BASIC_MONTHLY_PRICE_ID: PRICES.basic_monthly,
  STRIPE_BASIC_YEARLY_PRICE_ID: PRICES.basic_yearly,
  STRIPE_STUDENT_MONTHLY_PRICE_ID: PRICES.student_monthly,
  STRIPE_STUDENT_YEARLY_PRICE_ID: PRICES.student_yearly,
  STRIPE_PRO_MONTHLY_PRICE_ID: PRICES.pro_monthly,
  STRIPE_PRO_YEARLY_PRICE_ID: PRICES.pro_yearly,
  STRIPE_SUCCESS_URL: SUCCESS_URL,
  STRIPE_CANCEL_URL: CANCEL_URL,
  STRIPE_PORTAL_RETURN_URL: '',
});
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { stripeBilling } = await import('../src/billing/index.js');
const { getEntitlement } = await import('../src/billing/entitlements.js');
const { TIER_FEATURES } = await import('../src/billing/features.js');
const { HttpError } = await import('../src/lib/errors.js');
const { applySubscriptionUpdate, getSubscription } = await import('../src/billing/subscriptions.js');
const { assertNotSubscribedElsewhere } = await import('../src/billing/purchases.js');
const { mapStripeSubscription, PAST_DUE_GRACE_DAYS } = await import('../src/billing/providers/stripe.js');
const service = await import('../src/billing/stripe-service.js');
type Sub = import('../src/billing/providers/stripe-api.js').StripeSubscriptionLike;
after(async () => {
  await flushAnalytics();
  await sql.end();
});

assert.ok(stripeBilling, 'Stripe must be enabled by the test environment');
const DAY = 86_400_000;
const NOW = Date.now();
const sec = (ms: number) => Math.floor(ms / 1000);
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 14);

// ---------------------------------------------------------------- a fake Stripe account

type Checkout = { input: Parameters<typeof stripeBilling.api.createCheckoutSession>[0]; key: string };
const world = {
  subs: new Map<string, Sub>(),
  customers: [] as { id: string; userId: string; email: string }[],
  customerKeys: new Map<string, string>(),
  checkouts: [] as Checkout[],
  portals: [] as { customerId: string; returnUrl: string }[],
  cancelled: [] as string[],
  deleted: [] as string[],
  retrieves: 0,
  failRetrieves: 0,
  failDelete: false,
};
Object.assign(stripeBilling.api, {
  async retrieveSubscription(id: string) {
    world.retrieves++;
    if (world.failRetrieves > 0) {
      world.failRetrieves--;
      throw new HttpError(502, 'Stripe is down', 'billing_unavailable');
    }
    const s = world.subs.get(id);
    return s ? structuredClone(s) : null;
  },
  async listSubscriptions(customerId: string) {
    return [...world.subs.values()].filter((s) => s.customerId === customerId).map((s) => structuredClone(s));
  },
  async createCustomer(input: { userId: string; email: string }, key: string) {
    let id = world.customerKeys.get(key);
    if (!id) {
      id = `cus_${uid()}`;
      world.customerKeys.set(key, id);
      world.customers.push({ id, userId: input.userId, email: input.email });
    }
    return id;
  },
  async createCheckoutSession(input: Checkout['input'], key: string) {
    world.checkouts.push({ input, key });
    return { id: `cs_test_${uid()}`, url: `https://checkout.stripe.test/pay/${key}` };
  },
  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    world.portals.push(input);
    return { url: `https://billing.stripe.test/session/${input.customerId}` };
  },
  async cancelSubscription(id: string) {
    world.cancelled.push(id);
    const s = world.subs.get(id);
    if (s) Object.assign(s, { status: 'canceled', endedAt: sec(Date.now()) });
  },
  async deleteCustomer(id: string) {
    if (world.failDelete) throw new HttpError(502, 'Stripe is down', 'billing_unavailable');
    world.deleted.push(id);
  },
});

/** A Stripe subscription as the (fake) API returns it. */
function makeSub(over: Partial<Sub> & { plan?: PlanId; start?: number; end?: number } = {}): Sub {
  const { plan = 'student_monthly', start = NOW - DAY, end = NOW + 29 * DAY, ...rest } = over;
  return {
    id: `sub_${uid()}`,
    status: 'active',
    customerId: 'cus_unset',
    livemode: false,
    cancelAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    trialEnd: null,
    items: [{ priceId: PRICES[plan], currentPeriodStart: sec(start), currentPeriodEnd: sec(end) }],
    metadata: {},
    ...rest,
  };
}
const trialingSub = (over: Parameters<typeof makeSub>[0] = {}) => makeSub({ status: 'trialing', start: NOW - DAY, end: NOW + 6 * DAY, trialEnd: sec(NOW + 6 * DAY), ...over });

// ---------------------------------------------------------------- helpers

const signer = new Stripe('sk_test_FAKE_for_signing_only');
async function deliver(
  event: { id?: string; type: string; object: Record<string, unknown> },
  opts: { secret?: string; tamper?: boolean; timestamp?: number; header?: string | null } = {},
) {
  const payload = JSON.stringify({
    id: event.id ?? `evt_${uid()}`,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: sec(Date.now()),
    livemode: false,
    type: event.type,
    data: { object: event.object },
  });
  const signature = opts.header === undefined ? signer.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET, timestamp: opts.timestamp }) : opts.header;
  return app.request('/billing/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
    body: opts.tamper ? payload.replace('"type":"', '"type": "') : payload,
  });
}

async function newUser(email = `stripe-${crypto.randomUUID()}@example.com`) {
  const r = await app.request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', name: 'Stripe Tester' }) });
  const j = (await r.json()) as AuthResponse;
  return { id: j.user.id, token: j.token, email };
}
type U = Awaited<ReturnType<typeof newUser>>;
const auth = (u: U) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` });
const post = (path: string, u: U | null, body: unknown = {}) => app.request(path, { method: 'POST', headers: u ? auth(u) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const checkout = (u: U | null, body: unknown) => post('/billing/stripe/checkout', u, body);
const customerOf = (u: U) => world.customers.find((c) => c.userId === u.id)!.id;
const code = async (r: Response) => ((await r.json()) as { code?: string }).code;
const fakeCall = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return 'resolved';
};

/** Checkout → Stripe creates the subscription → its events arrive. Returns the subscription. */
async function subscribe(u: U, sub: Sub, events: string[] = ['checkout.session.completed']) {
  if (!world.customers.some((c) => c.userId === u.id)) assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
  sub.customerId = customerOf(u);
  sub.metadata = { exama_user_id: u.id };
  world.subs.set(sub.id, sub);
  for (const type of events) {
    const object =
      type === 'checkout.session.completed'
        ? { id: `cs_${uid()}`, mode: 'subscription', customer: sub.customerId, subscription: sub.id, client_reference_id: u.id, metadata: { exama_user_id: u.id } }
        : { id: sub.id, customer: sub.customerId };
    const r = await deliver({ type, object });
    assert.equal(r.status, 200, `${type}: ${await r.clone().text()}`);
  }
  return sub;
}
const change = async (sub: Sub, type = 'customer.subscription.updated') => {
  const r = await deliver({ type, object: { id: sub.id, customer: sub.customerId } });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()) as { handled: boolean; duplicate?: boolean; note?: string };
};

// ================================================================ Checkout

test('checkout: every plan and interval maps to ITS Price id, with the 7-day trial and a payment method', async () => {
  for (const tier of ['basic', 'student', 'pro'] as const) {
    for (const interval of ['monthly', 'yearly'] as const) {
      const u = await newUser();
      const before = world.checkouts.length;
      const r = await checkout(u, { plan: tier, interval });
      assert.equal(r.status, 200, `${tier} ${interval}`);
      const { url } = (await r.json()) as { url: string };
      assert.match(url, /^https:\/\/checkout\.stripe\.test\//);
      assert.equal(world.checkouts.length, before + 1);
      const { input } = world.checkouts.at(-1)!;
      assert.equal(input.priceId, PRICES[`${tier}_${interval}` as PlanId], `${tier} ${interval} uses its own Price`);
      assert.equal(input.planId, `${tier}_${interval}`);
      assert.equal(input.trialDays, 7, 'Stripe owns a 7-day trial (no app-side timer)');
      assert.equal(input.userId, u.id);
      assert.equal(input.customerId, customerOf(u));
      assert.equal(input.successUrl, SUCCESS_URL);
      assert.equal(input.cancelUrl, CANCEL_URL);
      assert.ok(input.expiresAt > sec(Date.now()) && input.expiresAt <= sec(Date.now()) + 31 * 60, 'the session expires in about 30 minutes');
    }
  }
});

test('checkout: the browser can only name a plan and an interval — never a price, a customer or an entitlement', async () => {
  const u = await newUser();
  const r = await checkout(u, { plan: 'basic', interval: 'monthly', priceId: 'price_EVIL', price: 'price_EVIL', customer: 'cus_EVIL', trialDays: 365, amount: 1, tier: 'pro' });
  assert.equal(r.status, 200);
  const { input } = world.checkouts.at(-1)!;
  assert.equal(input.priceId, PRICES.basic_monthly);
  assert.notEqual(input.customerId, 'cus_EVIL');
  assert.equal(input.trialDays, 7);
  assert.equal((await getEntitlement(u.id)).tier, 'free', 'requesting checkout grants nothing');
  assert.equal(await getSubscription(u.id), null);
});

test('checkout: invalid plan, invalid interval and a malformed body are refused before anything is created', async () => {
  const u = await newUser();
  const before = { checkouts: world.checkouts.length, customers: world.customers.length };
  for (const [body, expected] of [
    [{ plan: 'platinum', interval: 'monthly' }, 'invalid_plan'],
    [{ plan: 'free', interval: 'monthly' }, 'invalid_plan'],
    [{ plan: 'student_monthly', interval: 'monthly' }, 'invalid_plan'],
    [{ plan: 123, interval: 'monthly' }, 'invalid_plan'],
    [{ interval: 'monthly' }, 'invalid_plan'],
    [{}, 'invalid_plan'],
    [{ plan: 'student', interval: 'weekly' }, 'invalid_interval'],
    [{ plan: 'student', interval: 'annual' }, 'invalid_interval'],
    [{ plan: 'student' }, 'invalid_interval'],
    [{ plan: 'student', interval: ['monthly'] }, 'invalid_interval'],
  ] as const) {
    const r = await checkout(u, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(await code(r), expected, JSON.stringify(body));
  }
  const raw = await app.request('/billing/stripe/checkout', { method: 'POST', headers: auth(u), body: '{not json' });
  assert.equal(raw.status, 400);
  assert.deepEqual({ checkouts: world.checkouts.length, customers: world.customers.length }, before, 'no Stripe objects were created');
});

test('checkout and portal require an authenticated user', async () => {
  const before = world.checkouts.length;
  assert.equal((await checkout(null, { plan: 'student', interval: 'monthly' })).status, 401);
  assert.equal((await post('/billing/stripe/portal', null)).status, 401);
  const badToken = await app.request('/billing/stripe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-token' }, body: '{}' });
  assert.equal(badToken.status, 401);
  assert.equal(world.checkouts.length, before);
});

test('checkout: the Stripe Customer is created once per user and reused — also under concurrent requests', async () => {
  const u = await newUser();
  assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
  assert.equal((await checkout(u, { plan: 'pro', interval: 'yearly' })).status, 200);
  assert.equal(world.customers.filter((c) => c.userId === u.id).length, 1, 'second checkout reuses the Customer');
  assert.equal(world.checkouts.at(-1)!.input.customerId, customerOf(u));

  const racer = await newUser();
  const ids = await Promise.all(Array.from({ length: 6 }, () => service.getOrCreateStripeCustomer(stripeBilling, racer.id)));
  assert.equal(new Set(ids).size, 1, 'six parallel requests, one Customer');
  assert.equal(world.customers.filter((c) => c.userId === racer.id).length, 1);
  const [{ count }] = await sql`select count(*)::int as count from stripe_customers where user_id = ${racer.id}`;
  assert.equal(count, 1);
  assert.equal(await service.stripeCustomerIdFor(racer.id), ids[0]);
});

test('checkout: repeated clicks get the same idempotency key (one Checkout Session, not many)', async () => {
  const u = await newUser();
  assert.equal((await checkout(u, { plan: 'student', interval: 'yearly' })).status, 200);
  assert.equal((await checkout(u, { plan: 'student', interval: 'yearly' })).status, 200);
  const [a, b] = world.checkouts.slice(-2);
  assert.equal(a.key, b.key);
  assert.match(a.key, /^checkout-/);
  const other = await checkout(u, { plan: 'pro', interval: 'yearly' });
  assert.equal(other.status, 200);
  assert.notEqual(world.checkouts.at(-1)!.key, a.key, 'a different plan is a different session');
});

test('checkout: burst protection (429) per user', async () => {
  const u = await newUser();
  let limited: Response | null = null;
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await checkout(u, { plan: 'basic', interval: 'monthly' });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'the limiter kicks in');
  assert.equal(await code(limited), 'too_many_requests');
  const fresh = await newUser();
  assert.equal((await checkout(fresh, { plan: 'basic', interval: 'monthly' })).status, 200, 'other users are unaffected');
});

test('checkout: an account that already has an active or trialing Stripe subscription cannot start another', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub());
  const before = world.checkouts.length;
  const r = await checkout(u, { plan: 'pro', interval: 'yearly' });
  assert.equal(r.status, 409);
  assert.equal(await code(r), 'already_subscribed');
  assert.equal(world.checkouts.length, before, 'no Checkout Session was created');
  // …also once it is paid…
  Object.assign(sub, { status: 'active', trialEnd: null });
  await change(sub);
  assert.equal(await code(await checkout(u, { plan: 'student', interval: 'monthly' })), 'already_subscribed');
  // …and while it is set to cancel at period end (access continues; manage it in the Portal).
  sub.cancelAtPeriodEnd = true;
  await change(sub);
  assert.equal((await getSubscription(u.id))!.status, 'cancelled');
  assert.equal(await code(await checkout(u, { plan: 'student', interval: 'monthly' })), 'already_subscribed');
  assert.equal(world.checkouts.length, before);
});

test('checkout: Stripe is asked too, so a webhook that has not arrived yet cannot cause a duplicate', async () => {
  const u = await newUser();
  assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
  // The customer completed Checkout a moment ago; our database has not seen the webhook yet.
  const sub = makeSub({ customerId: customerOf(u), status: 'trialing', trialEnd: sec(NOW + 7 * DAY) });
  world.subs.set(sub.id, sub);
  assert.equal(await getSubscription(u.id), null);
  const before = world.checkouts.length;
  const r = await checkout(u, { plan: 'student', interval: 'monthly' });
  assert.equal(r.status, 409);
  assert.equal(await code(r), 'already_subscribed');
  assert.equal(world.checkouts.length, before);
});

test('checkout: an ended Stripe subscription does not block a new one, but the trial is not offered twice', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'basic_monthly' }));
  Object.assign(sub, { status: 'canceled', endedAt: sec(NOW - 1000), canceledAt: sec(NOW - 1000) });
  await change(sub, 'customer.subscription.deleted');
  assert.equal((await getEntitlement(u.id)).tier, 'free');
  const r = await checkout(u, { plan: 'student', interval: 'monthly' });
  assert.equal(r.status, 200);
  assert.equal(world.checkouts.at(-1)!.input.trialDays, null, 'the free trial is once per account (trial_used)');
});

test('checkout: a trial Stripe already gave this customer is not offered again, even if our database lags', async () => {
  const u = await newUser();
  assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
  const old = makeSub({ customerId: customerOf(u), status: 'canceled', endedAt: sec(NOW - 20 * DAY), trialEnd: sec(NOW - 30 * DAY) });
  world.subs.set(old.id, old);
  assert.equal((await checkout(u, { plan: 'pro', interval: 'monthly' })).status, 200);
  assert.equal(world.checkouts.at(-1)!.input.trialDays, null);
});

test('checkout: an existing App Store / Google Play subscription blocks a web one — and is never touched', async () => {
  for (const provider of ['apple', 'google'] as const) {
    const u = await newUser();
    await applySubscriptionUpdate(
      u.id,
      { provider, planId: 'student_monthly', status: 'active', trialEndsAt: null, currentPeriodEndsAt: new Date(NOW + 20 * DAY), willRenew: true, trialUsed: true, providerRef: `${provider}-ref-${uid()}`, environment: 'production' },
      'silent',
    );
    const before = { checkouts: world.checkouts.length, cancelled: world.cancelled.length, customers: world.customers.length };
    const r = await checkout(u, { plan: 'student', interval: 'monthly' });
    assert.equal(r.status, 409, provider);
    const body = (await r.json()) as { code: string; details: { provider: string } };
    assert.equal(body.code, 'subscribed_elsewhere');
    assert.equal(body.details.provider, provider, 'the client can say WHICH store bills it');
    assert.deepEqual({ checkouts: world.checkouts.length, cancelled: world.cancelled.length, customers: world.customers.length }, before, 'nothing was created or cancelled');
    const row = await getSubscription(u.id);
    assert.deepEqual([row!.provider, row!.status], [provider, 'active']);
  }
});

test('checkout: an EXPIRED store subscription does not block a web subscription', async () => {
  const u = await newUser();
  await applySubscriptionUpdate(u.id, { provider: 'apple', planId: 'student_monthly', status: 'expired', trialEndsAt: null, currentPeriodEndsAt: new Date(NOW - DAY), willRenew: false, trialUsed: true, providerRef: `apple-${uid()}`, environment: 'production' }, 'silent');
  assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
});

test('checkout: owner accounts already have full access', async () => {
  const owner = await newUser(OWNER_EMAIL);
  const before = world.checkouts.length;
  const r = await checkout(owner, { plan: 'student', interval: 'monthly' });
  assert.equal(r.status, 409);
  assert.equal(await code(r), 'full_access');
  assert.equal(world.checkouts.length, before);
});

test('the reverse rule: a live web subscription blocks App Store / Google Play purchases, and POST /purchase {store:"stripe"} grants nothing', async () => {
  const u = await newUser();
  await subscribe(u, makeSub());
  const row = await getSubscription(u.id);
  for (const store of ['apple', 'google'] as const) {
    assert.throws(() => assertNotSubscribedElsewhere(row, store), (e) => e instanceof HttpError && e.code === 'subscribed_elsewhere' && (e.details as { provider: string }).provider === 'stripe');
  }
  const r = await post('/billing/purchase', u, { store: 'stripe', planId: 'pro_yearly' });
  assert.equal(r.status, 400);
  assert.equal(await code(r), 'use_checkout');
  assert.equal((await getSubscription(u.id))!.planId, 'student_monthly');
});

// ================================================================ Customer Portal

test('portal: only for a user who has a web billing account, and always THEIR customer', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const nobody = await newUser();
  await checkout(alice, { plan: 'student', interval: 'monthly' });
  await checkout(bob, { plan: 'pro', interval: 'monthly' });

  const none = await post('/billing/stripe/portal', nobody);
  assert.equal(none.status, 404);
  assert.equal(await code(none), 'no_billing_account');

  const before = world.portals.length;
  const r = await post('/billing/stripe/portal', bob, { customer: customerOf(alice), customerId: customerOf(alice), userId: alice.id });
  assert.equal(r.status, 200);
  assert.equal(world.portals.length, before + 1);
  assert.equal(world.portals.at(-1)!.customerId, customerOf(bob), "Bob's request reached Bob's customer");
  assert.notEqual(world.portals.at(-1)!.customerId, customerOf(alice), "Alice's customer is unreachable for Bob, whatever he sends");
  assert.equal(world.portals.at(-1)!.returnUrl, 'https://app.example.test/account', 'default return page: /account on the success URL site');
  assert.match(((await r.json()) as { url: string }).url, /^https:\/\/billing\.stripe\.test\//);

  const a = await post('/billing/stripe/portal', alice);
  assert.equal(world.portals.at(-1)!.customerId, customerOf(alice));
  assert.equal(a.status, 200);
});

test('portal: burst protection', async () => {
  const u = await newUser();
  await checkout(u, { plan: 'student', interval: 'monthly' });
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) limited = (await post('/billing/stripe/portal', u)).status === 429;
  assert.ok(limited);
});

// ================================================================ Webhook: verification & idempotency

test('webhook: a valid signature is accepted; unsigned, wrongly signed, tampered and replayed requests are rejected', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub(), []);
  const event = { type: 'customer.subscription.created', object: { id: sub.id, customer: sub.customerId } };

  const ok = await deliver(event);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()) as object, { received: true, handled: true });

  const before = world.retrieves;
  const u2 = await newUser();
  const sub2 = await subscribe(u2, trialingSub(), []);
  for (const [label, r] of [
    ['no signature header', await deliver({ type: event.type, object: { id: sub2.id, customer: sub2.customerId } }, { header: null })],
    ['garbage signature', await deliver({ type: event.type, object: { id: sub2.id, customer: sub2.customerId } }, { header: 't=1,v1=deadbeef' })],
    ['signed with another secret', await deliver({ type: event.type, object: { id: sub2.id, customer: sub2.customerId } }, { secret: 'whsec_someone_else' })],
    ['body changed after signing', await deliver({ type: event.type, object: { id: sub2.id, customer: sub2.customerId } }, { tamper: true })],
    ['replayed (signed 10 minutes ago)', await deliver({ type: event.type, object: { id: sub2.id, customer: sub2.customerId } }, { timestamp: sec(Date.now() - 10 * 60_000) })],
  ] as const) {
    assert.equal(r.status, 400, label);
    assert.equal(await code(r), 'invalid_signature', label);
  }
  assert.equal(world.retrieves, before, 'a rejected webhook never reaches Stripe or the database');
  assert.equal(await getSubscription(u2.id), null, 'and grants nothing');
  assert.equal(await sql`select 1 from stripe_events where id like 'evt_%' and type = 'customer.subscription.created' and processed_at is not null`.then((r) => r.length >= 1), true);
});

test('webhook: the signature covers the raw bytes (a re-serialized body does not verify)', async () => {
  const payload = JSON.stringify({ id: `evt_${uid()}`, object: 'event', type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_x', customer: 'cus_x' } } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const reserialized = JSON.stringify(JSON.parse(payload), null, 2);
  const bad = await app.request('/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: reserialized });
  assert.equal(bad.status, 400);
  const good = await app.request('/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: payload });
  assert.equal(good.status, 200);
});

test('webhook: an oversized body is refused', async () => {
  const r = await app.request('/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: 'x'.repeat(service.MAX_WEBHOOK_BYTES + 1) });
  assert.equal(r.status, 413);
});

test('webhook: a duplicate delivery is processed once', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub(), []);
  const event = { id: `evt_${uid()}`, type: 'customer.subscription.created', object: { id: sub.id, customer: sub.customerId } };
  const first = await deliver(event);
  assert.deepEqual((await first.json()) as object, { received: true, handled: true });
  const row = await getSubscription(u.id);
  const before = world.retrieves;

  const second = await deliver(event);
  assert.equal(second.status, 200, 'Stripe is told "received" so it stops retrying');
  assert.deepEqual((await second.json()) as object, { received: true, handled: false, duplicate: true });
  assert.equal(world.retrieves, before, 'the duplicate did no work');
  assert.deepEqual((await getSubscription(u.id))!.updatedAt, row!.updatedAt, 'the subscription row was not rewritten');
});

test('webhook: the same event delivered in parallel is handled once (the rest are duplicates or told to retry)', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub(), []);
  const event = { id: `evt_${uid()}`, type: 'customer.subscription.created', object: { id: sub.id, customer: sub.customerId } };
  const before = world.retrieves;
  const results = await Promise.all(Array.from({ length: 5 }, () => deliver(event)));
  const handled = (await Promise.all(results.map(async (r) => (r.status === 200 ? ((await r.json()) as { handled: boolean }).handled : false)))).filter(Boolean);
  assert.equal(handled.length, 1, 'exactly one delivery did the work');
  assert.ok(results.every((r) => r.status === 200 || r.status === 409), 'the others were duplicates or asked to retry');
  assert.equal(world.retrieves - before, 1);
  assert.equal((await getSubscription(u.id))!.status, 'trialing');
});

test('webhook: if handling fails, Stripe is told to retry and the retry succeeds', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub(), []);
  const event = { id: `evt_${uid()}`, type: 'customer.subscription.created', object: { id: sub.id, customer: sub.customerId } };
  world.failRetrieves = 1;
  const failed = await deliver(event);
  assert.ok(failed.status >= 500, `a failure is not acknowledged (got ${failed.status})`);
  assert.equal(await getSubscription(u.id), null, 'nothing was granted');
  const retry = await deliver(event);
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()) as object, { received: true, handled: true });
  assert.equal((await getSubscription(u.id))!.status, 'trialing');
});

test('webhook: events this integration does not use are acknowledged and ignored', async () => {
  const r = await deliver({ type: 'charge.succeeded', object: { id: 'ch_1' } });
  assert.deepEqual((await r.json()) as object, { received: true, handled: false });
  const rows = await sql`select 1 from stripe_events where type = 'charge.succeeded'`;
  assert.equal(rows.length, 0, 'not even recorded');
  const malformed = await deliver({ type: 'customer.subscription.updated', object: {} });
  assert.deepEqual(((await malformed.json()) as { handled: boolean }).handled, false);
});

// ================================================================ Webhook → entitlements

test('checkout.session.completed with a trial: trialing, selected plan, full trial access — granted by the webhook only', async () => {
  const u = await newUser();
  assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200);
  assert.equal((await getEntitlement(u.id)).tier, 'free', 'before the webhook: nothing');

  const sub = trialingSub({ plan: 'student_monthly' });
  await subscribe(u, sub);
  const e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.accessPlan, e.provider, e.planId], ['trialing', 'trial', 'trial', 'stripe', 'student_monthly']);
  assert.deepEqual(e.features, TIER_FEATURES.trial, 'the trial unlocks every feature');
  assert.equal(e.usagePeriod, 'trial');
  assert.equal(e.trialEligible, false);
  assert.equal(e.willRenew, true);
  assert.equal(+new Date(e.trialEndsAt!), sec(NOW + 6 * DAY) * 1000);

  const row = await getSubscription(u.id);
  assert.deepEqual([row!.provider, row!.providerRef, row!.environment, row!.trialUsed], ['stripe', sub.id, 'sandbox', true]);

  // …through the public endpoint the web app reads:
  const status = await app.request('/billing/status', { headers: auth(u) });
  assert.equal(((await status.json()) as { provider: string }).provider, 'stripe');
});

test('customer.subscription.created/updated: every paid plan becomes its Exama tier', async () => {
  for (const [plan, tier] of [
    ['basic_monthly', 'basic'],
    ['basic_yearly', 'basic'],
    ['student_monthly', 'student'],
    ['student_yearly', 'student'],
    ['pro_monthly', 'pro'],
    ['pro_yearly', 'pro'],
  ] as const) {
    const u = await newUser();
    await subscribe(u, makeSub({ plan }), ['customer.subscription.created']);
    const e = await getEntitlement(u.id);
    assert.deepEqual([e.tier, e.planId, e.status, e.isPremium, e.provider], [tier, plan, 'active', true, 'stripe'], plan);
    assert.deepEqual(e.features, TIER_FEATURES[tier], plan);
  }
});

test('customer.subscription.updated: a plan change in the Portal changes the entitlement (same subscription)', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'basic_monthly' }));
  assert.equal((await getEntitlement(u.id)).tier, 'basic');

  sub.items = [{ priceId: PRICES.pro_yearly, currentPeriodStart: sec(NOW), currentPeriodEnd: sec(NOW + 365 * DAY) }];
  assert.equal((await change(sub)).handled, true);
  const up = await getEntitlement(u.id);
  assert.deepEqual([up.tier, up.planId], ['pro', 'pro_yearly']);
  assert.equal(+new Date(up.currentPeriodEndsAt!), sec(NOW + 365 * DAY) * 1000);

  sub.items = [{ priceId: PRICES.basic_monthly, currentPeriodStart: sec(NOW), currentPeriodEnd: sec(NOW + 30 * DAY) }];
  await change(sub);
  assert.equal((await getEntitlement(u.id)).tier, 'basic', 'downgrades apply too');
  assert.equal((await sql`select count(*)::int as n from subscriptions where user_id = ${u.id}`)[0].n, 1, 'still ONE subscription row per user');
});

test('customer.subscription.updated: cancel at period end keeps access until the period ends, and can be undone', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'student_monthly', end: NOW + 10 * DAY }));
  sub.cancelAtPeriodEnd = true;
  await change(sub);
  let e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.isPremium, e.willRenew], ['cancelled', 'student', true, false], 'cancelled but still inside the paid period');
  assert.equal(+new Date(e.currentPeriodEndsAt!), sec(NOW + 10 * DAY) * 1000);

  sub.cancelAtPeriodEnd = false;
  await change(sub);
  e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.willRenew], ['active', true]);
});

test('customer.subscription.deleted: paid access is removed', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'pro_monthly' }));
  assert.equal((await getEntitlement(u.id)).tier, 'pro');
  Object.assign(sub, { status: 'canceled', endedAt: sec(NOW - 1000), canceledAt: sec(NOW - 1000) });
  await change(sub, 'customer.subscription.deleted');
  const e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.isPremium, e.accessPlan], ['expired', 'free', false, 'expired']);
  assert.equal(e.trialEnded, false, 'a paid subscription that ended is not a "trial ended"');
});

test('a trial that ends unconverted shows "trial ended" (Stripe cancels it when no payment method is on file)', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub());
  Object.assign(sub, { status: 'canceled', endedAt: sec(NOW - 1000), canceledAt: sec(NOW - 1000), trialEnd: sec(NOW - 1000) });
  await change(sub, 'customer.subscription.deleted');
  const e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.trialEnded], ['expired', 'free', true]);
});

test('trial → paid: invoice.paid converts the subscription to its paid plan', async () => {
  const u = await newUser();
  const sub = await subscribe(u, trialingSub({ plan: 'student_yearly' }));
  assert.equal((await getEntitlement(u.id)).tier, 'trial');
  Object.assign(sub, { status: 'active', items: [{ priceId: PRICES.student_yearly, currentPeriodStart: sec(NOW), currentPeriodEnd: sec(NOW + 365 * DAY) }] });
  // current API shape: invoice.parent.subscription_details.subscription
  const r = await deliver({ type: 'invoice.paid', object: { id: `in_${uid()}`, customer: sub.customerId, parent: { subscription_details: { subscription: sub.id } } } });
  assert.deepEqual(((await r.json()) as { handled: boolean }).handled, true);
  const e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.planId, e.usagePeriod], ['active', 'student', 'student_yearly', 'month']);
  assert.equal(+new Date(e.currentPeriodEndsAt!), sec(NOW + 365 * DAY) * 1000);
});

test('invoice events from older API versions (invoice.subscription) are understood too', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub());
  sub.cancelAtPeriodEnd = true;
  const r = await deliver({ type: 'invoice.paid', object: { id: `in_${uid()}`, customer: sub.customerId, subscription: sub.id } });
  assert.equal(((await r.json()) as { handled: boolean }).handled, true);
  assert.equal((await getSubscription(u.id))!.status, 'cancelled');
  assert.equal(service.invoiceSubscriptionId({ parent: null, subscription: { id: 'sub_9' } }), 'sub_9');
  assert.equal(service.invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_1' } } }), 'sub_1');
  assert.equal(service.invoiceSubscriptionId({ parent: { quote_details: {} } }), null);
});

test('invoice.payment_failed: access continues during the grace period, then ends', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'student_monthly' }));
  // The renewal invoice was created 2 days ago and its payment keeps failing.
  Object.assign(sub, { status: 'past_due', items: [{ priceId: PRICES.student_monthly, currentPeriodStart: sec(NOW - 2 * DAY), currentPeriodEnd: sec(NOW + 28 * DAY) }] });
  const r = await deliver({ type: 'invoice.payment_failed', object: { id: `in_${uid()}`, customer: sub.customerId, parent: { subscription_details: { subscription: sub.id } } } });
  assert.equal(((await r.json()) as { handled: boolean }).handled, true);
  let e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.isPremium, e.willRenew], ['active', 'student', true, true], 'still entitled while Stripe retries');
  assert.equal(+new Date(e.currentPeriodEndsAt!), sec(NOW - 2 * DAY + PAST_DUE_GRACE_DAYS * DAY) * 1000, 'the grace period is bounded');

  // …Stripe keeps retrying for a while; once the grace period is over, access ends by itself.
  sub.items = [{ priceId: PRICES.student_monthly, currentPeriodStart: sec(NOW - (PAST_DUE_GRACE_DAYS + 1) * DAY), currentPeriodEnd: sec(NOW + 21 * DAY) }];
  await change(sub);
  e = await getEntitlement(u.id);
  assert.deepEqual([e.status, e.tier, e.isPremium], ['expired', 'free', false]);
});

test('unpaid, paused and incomplete_expired remove access; incomplete grants nothing', async () => {
  for (const status of ['unpaid', 'paused', 'incomplete_expired'] as const) {
    const u = await newUser();
    const sub = await subscribe(u, makeSub());
    assert.equal((await getEntitlement(u.id)).tier, 'student');
    sub.status = status;
    await change(sub);
    assert.equal((await getEntitlement(u.id)).tier, 'free', status);
  }
  const u = await newUser();
  const pending = await subscribe(u, makeSub({ status: 'incomplete' }));
  assert.equal((await change(pending)).note, 'nothing_to_record');
  assert.equal(await getSubscription(u.id), null, 'a first payment that is not confirmed yet grants nothing');
});

test('out-of-order and stale events converge on Stripe\'s CURRENT state (events are never trusted for state)', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'student_monthly' }));
  Object.assign(sub, { status: 'canceled', endedAt: sec(NOW - 1000), canceledAt: sec(NOW - 1000) });
  await change(sub, 'customer.subscription.deleted');
  assert.equal((await getEntitlement(u.id)).tier, 'free');
  // A delayed "updated" event from before the cancellation arrives last. It carries the old payload,
  // but the handler re-reads the subscription, so it cannot bring the access back.
  const late = await deliver({ type: 'customer.subscription.updated', object: { id: sub.id, customer: sub.customerId, status: 'active' } });
  assert.equal(late.status, 200);
  assert.equal((await getEntitlement(u.id)).tier, 'free');
});

test('concurrent events for one subscription end in the latest state', async () => {
  const u = await newUser();
  const sub = await subscribe(u, makeSub({ plan: 'basic_monthly' }));
  sub.items = [{ priceId: PRICES.pro_monthly, currentPeriodStart: sec(NOW), currentPeriodEnd: sec(NOW + 30 * DAY) }];
  await Promise.all(Array.from({ length: 6 }, (_, i) => deliver({ type: i % 2 ? 'customer.subscription.updated' : 'invoice.paid', object: { id: sub.id, customer: sub.customerId, subscription: sub.id } })));
  assert.equal((await getEntitlement(u.id)).tier, 'pro');
});

// ================================================================ Webhook: account safety

test('webhook: a subscription that belongs to no Exama account is acknowledged, not failed (Stripe would retry forever)', async () => {
  const sub = makeSub({ customerId: `cus_${uid()}`, metadata: { exama_user_id: crypto.randomUUID() } });
  world.subs.set(sub.id, sub);
  const r = await deliver({ type: 'customer.subscription.created', object: { id: sub.id, customer: sub.customerId } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()) as object, { received: true, handled: false, note: 'unknown_account' });
});

test('webhook: a Price that is not one of ours never grants access', async () => {
  const u = await newUser();
  const foreign = makeSub();
  foreign.items[0].priceId = 'price_some_other_product';
  await subscribe(u, foreign, []);
  assert.equal((await change(foreign, 'customer.subscription.created')).note, 'nothing_to_record');
  assert.equal(await getSubscription(u.id), null);
});

test('webhook: the Customer mapping decides the account — metadata cannot redirect a subscription to someone else', async () => {
  const alice = await newUser();
  const mallory = await newUser();
  await checkout(alice, { plan: 'student', interval: 'monthly' });
  await checkout(mallory, { plan: 'student', interval: 'monthly' });
  // A subscription on ALICE's customer whose metadata names Mallory.
  const sub = makeSub({ customerId: customerOf(alice), metadata: { exama_user_id: mallory.id } });
  world.subs.set(sub.id, sub);
  await change(sub, 'customer.subscription.created');
  assert.equal((await getEntitlement(alice.id)).tier, 'student');
  assert.equal((await getEntitlement(mallory.id)).tier, 'free');

  // A subscription on an unknown customer naming a user who already has a DIFFERENT customer: ignored.
  const stray = makeSub({ customerId: `cus_${uid()}`, metadata: { exama_user_id: mallory.id } });
  world.subs.set(stray.id, stray);
  assert.equal((await change(stray, 'customer.subscription.created')).note, 'unknown_account');
  assert.equal((await getEntitlement(mallory.id)).tier, 'free');
});

test('webhook: the first event for a customer we have not mapped yet links it from the metadata we set', async () => {
  const u = await newUser();
  const sub = makeSub({ customerId: `cus_${uid()}`, metadata: { exama_user_id: u.id } });
  world.subs.set(sub.id, sub);
  assert.equal((await change(sub, 'customer.subscription.created')).handled, true);
  assert.equal(await service.stripeCustomerIdFor(u.id), sub.customerId);
  assert.equal((await getEntitlement(u.id)).tier, 'student');
});

test('webhook: a stale/ended OTHER subscription never removes a live one', async () => {
  const u = await newUser();
  const live = await subscribe(u, makeSub({ plan: 'pro_monthly' }));
  const old = makeSub({ customerId: live.customerId, status: 'canceled', endedAt: sec(NOW - DAY), metadata: { exama_user_id: u.id } });
  world.subs.set(old.id, old);
  assert.equal((await change(old, 'customer.subscription.deleted')).note, 'ignored');
  const e = await getEntitlement(u.id);
  assert.deepEqual([e.tier, e.status], ['pro', 'active']);
  assert.equal((await getSubscription(u.id))!.providerRef, live.id);
});

test('webhook: a second LIVE Stripe subscription for the account is cancelled, the first keeps its access', async () => {
  const u = await newUser();
  const first = await subscribe(u, makeSub({ plan: 'student_monthly' }));
  const cancelledBefore = world.cancelled.length;
  const dup = makeSub({ customerId: first.customerId, plan: 'pro_yearly', metadata: { exama_user_id: u.id } });
  world.subs.set(dup.id, dup);
  assert.equal((await change(dup, 'customer.subscription.created')).note, 'duplicate_cancelled');
  assert.deepEqual(world.cancelled.slice(cancelledBefore), [dup.id], 'only the NEW duplicate is cancelled');
  assert.equal((await getSubscription(u.id))!.providerRef, first.id);
  assert.equal((await getEntitlement(u.id)).tier, 'student');
  // Stripe then reports the duplicate as deleted: that changes nothing.
  assert.equal((await change(dup, 'customer.subscription.deleted')).note, 'ignored');
  assert.equal((await getEntitlement(u.id)).tier, 'student');
});

test('webhook: a new subscription replaces a stored one that already ended in Stripe (resubscribing is not a duplicate)', async () => {
  const u = await newUser();
  const first = await subscribe(u, makeSub({ plan: 'basic_monthly' }));
  Object.assign(first, { status: 'canceled', endedAt: sec(NOW - 1000) }); // ended in Stripe; the webhook about it was missed
  const next = makeSub({ customerId: first.customerId, plan: 'pro_monthly', metadata: { exama_user_id: u.id } });
  world.subs.set(next.id, next);
  assert.equal((await change(next, 'customer.subscription.created')).handled, true);
  assert.deepEqual([(await getSubscription(u.id))!.providerRef, (await getEntitlement(u.id)).tier], [next.id, 'pro']);
});

test('webhook: a Stripe subscription never replaces a LIVE App Store / Google Play one — the Stripe duplicate is cancelled instead', async () => {
  for (const provider of ['apple', 'google'] as const) {
    const u = await newUser();
    assert.equal((await checkout(u, { plan: 'student', interval: 'monthly' })).status, 200); // made before the store purchase
    await applySubscriptionUpdate(
      u.id,
      { provider, planId: 'pro_yearly', status: 'active', trialEndsAt: null, currentPeriodEndsAt: new Date(NOW + 200 * DAY), willRenew: true, trialUsed: true, providerRef: `${provider}-${uid()}`, environment: 'production' },
      'silent',
    );
    const sub = makeSub({ customerId: customerOf(u), metadata: { exama_user_id: u.id } });
    world.subs.set(sub.id, sub);
    const cancelledBefore = world.cancelled.length;
    assert.equal((await change(sub, 'customer.subscription.created')).note, 'duplicate_cancelled', provider);
    assert.deepEqual(world.cancelled.slice(cancelledBefore), [sub.id]);
    const row = await getSubscription(u.id);
    assert.deepEqual([row!.provider, row!.planId, row!.status], [provider, 'pro_yearly', 'active'], `the ${provider} subscription is untouched`);
  }
});

test('reasonFor: analytics reasons for state changes', () => {
  const live = (over: object) => ({ provider: 'stripe', providerRef: 'sub_1', status: 'active', willRenew: true, planId: 'student_monthly', ...over }) as never;
  const upd = (over: object) => ({ provider: 'stripe', providerRef: 'sub_1', status: 'active', willRenew: true, planId: 'student_monthly', ...over }) as never;
  assert.equal(service.reasonFor(null, upd({ status: 'trialing' })), 'trial');
  assert.equal(service.reasonFor(null, upd({})), 'purchase');
  assert.equal(service.reasonFor(live({ status: 'trialing' }), upd({})), 'purchase', 'trial converted');
  assert.equal(service.reasonFor(live({}), upd({ status: 'cancelled', willRenew: false })), 'cancel');
  assert.equal(service.reasonFor(live({ status: 'cancelled', willRenew: false }), upd({})), 'restore');
  assert.equal(service.reasonFor(live({}), upd({ planId: 'pro_monthly' })), 'purchase', 'plan change');
  assert.equal(service.reasonFor(live({}), upd({})), 'silent', 'a renewal or a repeat');
  assert.equal(service.reasonFor(live({}), upd({ status: 'expired' })), 'silent');
});

// ================================================================ mapping rules (pure)

test('mapping: every Stripe status has an explicit Exama outcome', () => {
  const at = new Date(NOW);
  const map = (sub: Sub) => mapStripeSubscription(sub, PRICES, at);

  const trial = map(trialingSub())!;
  assert.deepEqual([trial.status, trial.provider, trial.planId, trial.willRenew, trial.trialUsed, trial.environment], ['trialing', 'stripe', 'student_monthly', true, true, 'sandbox']);
  assert.equal(+trial.trialEndsAt!, +trial.currentPeriodEndsAt!, 'trialEndsAt === currentPeriodEndsAt marks a trial period');

  const cancelledTrial = map(trialingSub({ cancelAtPeriodEnd: true }))!;
  assert.deepEqual([cancelledTrial.status, cancelledTrial.willRenew], ['cancelled', false], 'cancelled trial keeps access until the trial ends');

  const active = map(makeSub({ plan: 'pro_yearly', livemode: true }))!;
  assert.deepEqual([active.status, active.planId, active.trialEndsAt, active.willRenew, active.environment], ['active', 'pro_yearly', null, true, 'production']);

  const cancelling = map(makeSub({ cancelAtPeriodEnd: true }))!;
  assert.deepEqual([cancelling.status, cancelling.willRenew], ['cancelled', false]);
  const scheduledInside = map(makeSub({ cancelAt: sec(NOW + 5 * DAY) }))!;
  assert.deepEqual([scheduledInside.status, +scheduledInside.currentPeriodEndsAt!], ['cancelled', sec(NOW + 5 * DAY) * 1000], 'access ends at the scheduled cancellation');
  const scheduledLater = map(makeSub({ cancelAt: sec(NOW + 200 * DAY) }))!;
  assert.deepEqual([scheduledLater.status, scheduledLater.willRenew], ['active', true], 'a cancellation in a later period still renews until then');

  assert.equal(map(makeSub({ end: NOW - 1000 }))!.status, 'expired', 'active but past its period end');
  assert.equal(map(trialingSub({ end: NOW - 1000, trialEnd: sec(NOW - 1000) }))!.status, 'expired');

  const pastDue = (startAgoDays: number) => map(makeSub({ status: 'past_due', start: NOW - startAgoDays * DAY, end: NOW + (30 - startAgoDays) * DAY }))!;
  assert.deepEqual([pastDue(1).status, pastDue(1).willRenew], ['active', true], 'grace period');
  assert.equal(pastDue(PAST_DUE_GRACE_DAYS - 1).status, 'active');
  assert.equal(pastDue(PAST_DUE_GRACE_DAYS + 1).status, 'expired', 'grace period over');
  assert.equal(mapStripeSubscription(makeSub({ status: 'past_due', start: NOW - DAY, end: NOW + 29 * DAY }), PRICES, at, 0)!.status, 'expired', 'grace can be switched off');

  for (const status of ['unpaid', 'paused', 'incomplete_expired', 'something_new']) {
    const m = map(makeSub({ status }))!;
    assert.deepEqual([m.status, m.willRenew], ['expired', false], status);
    assert.ok(m.currentPeriodEndsAt! <= at, `${status}: access ends now`);
  }
  const ended = map(makeSub({ status: 'canceled', endedAt: sec(NOW - 3 * DAY) }))!;
  assert.deepEqual([ended.status, +ended.currentPeriodEndsAt!], ['expired', sec(NOW - 3 * DAY) * 1000]);
  assert.equal(map(makeSub({ status: 'incomplete' })), null, 'nothing to record until the first payment succeeds');
  assert.equal(map(makeSub({ items: [{ priceId: 'price_other', currentPeriodStart: 1, currentPeriodEnd: 2 }] })), null, 'not our Price');
  assert.equal(map(makeSub({ items: [] })), null);
  const twoItems = makeSub();
  twoItems.items.unshift({ priceId: 'price_addon', currentPeriodStart: 1, currentPeriodEnd: 2 });
  assert.equal(map(twoItems)!.planId, 'student_monthly', 'the item that is one of our plans is used');
});

// ================================================================ account deletion

test('deleting an account cancels its web subscription FIRST; if Stripe fails, nothing is deleted', async () => {
  const u = await newUser();
  await subscribe(u, makeSub());
  const customerId = customerOf(u);

  world.failDelete = true;
  const refused = await app.request('/auth/me', { method: 'DELETE', headers: auth(u), body: JSON.stringify({ password: 'password123' }) });
  world.failDelete = false;
  assert.equal(refused.status, 502);
  assert.equal(await code(refused), 'billing_cancel_failed');
  assert.ok(!world.deleted.includes(customerId));
  assert.equal((await app.request('/auth/me', { headers: auth(u) })).status, 200, 'the account still exists');
  assert.equal((await getEntitlement(u.id)).tier, 'student');

  const ok = await app.request('/auth/me', { method: 'DELETE', headers: auth(u), body: JSON.stringify({ password: 'password123' }) });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.ok(world.deleted.includes(customerId), 'the Stripe Customer (and so its subscription) was removed');
  assert.equal((await sql`select 1 from stripe_customers where user_id = ${u.id}`).length, 0);

  // Stripe's "subscription deleted" event for the removed customer arrives afterwards: acknowledged, harmless.
  const late = await deliver({ type: 'customer.subscription.deleted', object: { id: 'sub_gone', customer: customerId } });
  assert.equal(late.status, 200);
});

test('deleting an account without web billing never calls Stripe', async () => {
  const u = await newUser();
  const before = world.deleted.length;
  const r = await app.request('/auth/me', { method: 'DELETE', headers: auth(u), body: JSON.stringify({ password: 'password123' }) });
  assert.equal(r.status, 200);
  assert.equal(world.deleted.length, before);
});

// ================================================================ catalog & configuration

test('catalog: web now sells through Stripe; iOS and Android are unchanged', async () => {
  const catalog = async (platform: string) => (await (await app.request(`/billing/plans?platform=${platform}`)).json()) as BillingCatalog;
  const web = await catalog('web');
  assert.deepEqual([web.provider, web.purchasesAvailable, web.testMode, web.trialDays], ['stripe', true, false, 7]);
  assert.equal(web.plans.length, 6);
  assert.ok(web.plans.every((p) => !JSON.stringify(p).includes('price_')), 'Stripe Price ids are never sent to clients');
  // Apple/Google are not configured in this test environment: they behave exactly as before.
  for (const platform of ['ios', 'android']) {
    const c = await catalog(platform);
    assert.deepEqual([c.provider, c.purchasesAvailable], [null, false], platform);
  }
});

const configScript = fileURLToPath(new URL('./helpers/print-config.ts', import.meta.url));
function loadConfigWith(overrides: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { ...process.env, DATABASE_URL: 'postgres://user:pass@localhost:5432/db', JWT_SECRET: 'x'.repeat(40), BILLING_MOCK_ENABLED: undefined, NODE_ENV: undefined, AI_PROVIDER: undefined };
  for (const k of Object.keys(env)) if (k.startsWith('STRIPE_')) delete env[k];
  Object.assign(env, overrides);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, ['--import', 'tsx', configScript], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const VALID = {
  STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_FAKE_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_FAKE_x',
  STRIPE_BASIC_MONTHLY_PRICE_ID: 'price_1',
  STRIPE_BASIC_YEARLY_PRICE_ID: 'price_2',
  STRIPE_STUDENT_MONTHLY_PRICE_ID: 'price_3',
  STRIPE_STUDENT_YEARLY_PRICE_ID: 'price_4',
  STRIPE_PRO_MONTHLY_PRICE_ID: 'price_5',
  STRIPE_PRO_YEARLY_PRICE_ID: 'price_6',
  STRIPE_SUCCESS_URL: 'https://app.exama.app/checkout?status=success',
  STRIPE_CANCEL_URL: 'https://app.exama.app/checkout?status=cancelled',
};

test('config: Stripe is off by default, empty .env.example placeholders are fine, and nothing is required while disabled', () => {
  assert.equal(loadConfigWith({}).code, 0, 'unset');
  assert.equal(loadConfigWith({ STRIPE_ENABLED: 'false', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_SUCCESS_URL: '', STRIPE_PORTAL_RETURN_URL: '' }).code, 0, 'the empty placeholders of .env.example');
  assert.equal(loadConfigWith({ STRIPE_ENABLED: '' }).code, 0);
});

test('config: enabling Stripe requires everything, with clear messages', () => {
  const none = loadConfigWith({ STRIPE_ENABLED: 'true' });
  assert.equal(none.code, 1);
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_BASIC_MONTHLY_PRICE_ID', 'STRIPE_PRO_YEARLY_PRICE_ID', 'STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL']) assert.match(none.err, new RegExp(name), name);
  assert.equal(loadConfigWith(VALID).code, 0, loadConfigWith(VALID).err);
  assert.equal(loadConfigWith({ ...VALID, STRIPE_SECRET_KEY: 'not-a-key' }).code, 1);
  assert.equal(loadConfigWith({ ...VALID, STRIPE_WEBHOOK_SECRET: 'sk_test_oops' }).code, 1, 'a secret key is not a webhook secret');
  assert.equal(loadConfigWith({ ...VALID, STRIPE_STUDENT_MONTHLY_PRICE_ID: 'prod_123' }).code, 1, 'a product id is not a price id');
  const dup = loadConfigWith({ ...VALID, STRIPE_PRO_MONTHLY_PRICE_ID: 'price_1' });
  assert.equal(dup.code, 1);
  assert.match(dup.err, /OWN Stripe Price/);
  assert.equal(loadConfigWith({ ...VALID, STRIPE_SUCCESS_URL: 'app.exama.app/checkout' }).code, 1);
  assert.equal(loadConfigWith({ ...VALID, STRIPE_SUCCESS_URL: 'http://localhost:8081/checkout' }).code, 0, 'http is fine in development');
  assert.equal(loadConfigWith({ ...VALID, NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-x', STRIPE_SUCCESS_URL: 'http://app.exama.app/checkout' }).code, 1, 'https only in production');
  assert.equal(loadConfigWith({ ...VALID, STRIPE_PORTAL_RETURN_URL: 'nope' }).code, 1);
  const mock = loadConfigWith({ ...VALID, BILLING_MOCK_ENABLED: 'true' });
  assert.equal(mock.code, 0);
  assert.match(mock.err, /Stripe is NOT used/, 'mock billing shadows Stripe — say so');
});

test('the code never contains a Stripe secret, and errors never echo request data', async () => {
  const u = await newUser();
  const r = await checkout(u, { plan: 'nope', interval: 'monthly' });
  const text = await r.text();
  assert.doesNotMatch(text, /sk_(test|live)_|whsec_|price_/);
  const bad = await deliver({ type: 'customer.subscription.created', object: { id: 'sub_1' } }, { header: 't=1,v1=00' });
  assert.doesNotMatch(await bad.text(), /whsec_|sk_test|WEBHOOK_SECRET/);
  assert.equal(await fakeCall(service.createStripePortal(stripeBilling, u.id)), 'no_billing_account');
});
