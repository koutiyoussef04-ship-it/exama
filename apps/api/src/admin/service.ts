/**
 * Owner-only admin dashboard: read-only queries. Authorization happens in routes/admin.ts (every route);
 * nothing here is reachable otherwise.
 *
 * Rules kept throughout:
 *   - Accounts, entitlements and usage come from the database (the same rules as the entitlement resolver).
 *   - Money comes from Stripe, read live (never inferred from analytics); a trial is never revenue.
 *   - Costs are ESTIMATES (billing/ai-pricing.ts) and are kept apart from charges.
 *   - Missing data is reported as unavailable with a reason, never as zero.
 *   - No password hashes, tokens, keys, card data, document content or AI text is ever selected.
 */
import { readFileSync } from 'node:fs';
import { PLANS, type AdminAICostTotals, type AdminAIReport, type AdminAnalyticsReport, type AdminBillingReport, type AdminCategory, type AdminCustomer, type AdminCustomerAI, type AdminCustomerAIDetail, type AdminCustomerDetail, type AdminCustomerPayments, type AdminUsageWindow, type AdminCustomersPage, type AdminEvent, type AdminHealth, type AdminInterval, type AdminOverview, type AdminRangeInfo, type Point, type StripeMoney, type StripeSummary } from '@study/shared';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AI_MODEL_PRICES, AI_PRICING_VERSION, TRANSCRIPTION_USD_PER_MINUTE } from '../billing/ai-pricing.js';
import { stripeBilling } from '../billing/index.js';
import type { StripeChargeLike, StripeListResult, StripeRefundLike } from '../billing/providers/stripe-api.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { HttpError } from '../lib/errors.js';
import { adminCustomersQuerySchema, adminRangeQuerySchema } from '@study/shared';

const DAY = 86_400_000;
type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());
const usd = (micro: unknown) => Math.round(num(micro)) / 1_000_000;

// ---------------------------------------------------------------- ranges

export type Range = { from: Date | null; to: Date; label: string; interval: AdminInterval };

/** Preset (7d/30d/90d/all) or explicit from/to (≤ 366 days). Buckets are bounded: no daily series over 120 days. */
export function resolveRange(query: unknown, now = new Date()): Range {
  const q = adminRangeQuerySchema.safeParse(query);
  if (!q.success) throw new HttpError(400, 'Invalid date range', 'invalid_range');
  const { range, from, to, interval } = q.data;
  let r: Range;
  if (from || to) {
    if (!from || !to || range) throw new HttpError(400, 'Use either range or both from and to', 'invalid_range');
    const f = new Date(`${from}T00:00:00Z`);
    const t = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(+f) || Number.isNaN(+t) || f > t) throw new HttpError(400, '"from" must be on or before "to"', 'invalid_range');
    if (+t - +f > 366 * DAY) throw new HttpError(400, 'A custom range can cover at most 366 days', 'invalid_range');
    if (+f > +now + DAY) throw new HttpError(400, 'The range starts in the future', 'invalid_range');
    const days = (+t - +f) / DAY;
    r = { from: f, to: t > now ? now : t, label: `${from} – ${to}`, interval: days <= 31 ? 'day' : days <= 120 ? 'week' : 'month' };
  } else {
    const preset = range ?? '30d';
    const days = preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : null;
    r = { from: days ? new Date(+now - days * DAY) : null, to: now, label: preset, interval: days === null ? 'month' : days <= 30 ? 'day' : 'week' };
  }
  if (interval) {
    const span = r.from ? (+r.to - +r.from) / DAY : Infinity;
    if (interval === 'day' && span > 120) throw new HttpError(400, 'Daily buckets are limited to 120 days', 'invalid_range');
    r.interval = interval;
  }
  return r;
}
export const rangeInfo = (r: Range): AdminRangeInfo => ({ label: r.label, from: r.from?.toISOString() ?? null, to: r.to.toISOString(), interval: r.interval });
const inRange = (col: SQL, r: Range) => (r.from ? sql`${col} >= ${r.from.toISOString()}::timestamptz and ${col} <= ${r.to.toISOString()}::timestamptz` : sql`${col} <= ${r.to.toISOString()}::timestamptz`);
const bucket = (col: SQL, r: Range) => sql`to_char(date_trunc(${r.interval}, ${col} at time zone 'UTC'), 'YYYY-MM-DD')`;

// ---------------------------------------------------------------- account categories (same rules as getEntitlement)

const inList = (col: SQL, values: string[]) => (values.length ? sql`${col} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})` : sql`false`);
const ownerCond = () => sql`(${inList(sql`u.id::text`, config.OWNER_USER_IDS.map((x) => x.toLowerCase()))} or ${inList(sql`lower(u.email)`, config.OWNER_EMAILS)})`;
/** A trial period: trialing, or a trial cancelled before converting (same as isTrialPeriod). */
const trialPeriod = sql`(s.status = 'trialing' or (s.trial_ends_at is not null and s.current_period_ends_at = s.trial_ends_at))`;
const accessEnd = sql`(case when s.status = 'trialing' then s.trial_ends_at else coalesce(s.current_period_ends_at, s.trial_ends_at) end)`;
/** owner | free | trial | paid — from users u left join subscriptions s. Lapsed rows count as free even before they are marked expired. */
export const categorySql = () => sql`(case
  when ${ownerCond()} then 'owner'
  when s.id is null or s.status = 'expired' or s.plan_id is null then 'free'
  when coalesce(${accessEnd} > now(), false) = false then 'free'
  when ${trialPeriod} then 'trial'
  else 'paid' end)`;
/** The tier the entitlement resolver grants (a Stripe trial gets its plan's tier immediately). */
const tierSql = () => sql`(case
  when ${ownerCond()} then 'owner (full access)'
  when s.id is null or s.status = 'expired' or s.plan_id is null or coalesce(${accessEnd} > now(), false) = false then 'free'
  when ${trialPeriod} and s.provider <> 'stripe' then 'trial'
  else split_part(s.plan_id, '_', 1) end)`;

// ---------------------------------------------------------------- Stripe (live, read-only)

const STRIPE_MAX = 2000;
const stripeCache = new Map<string, { at: number; value: { charges: StripeListResult<StripeChargeLike>; refunds: StripeListResult<StripeRefundLike> } }>();
const STRIPE_CACHE_MS = 60_000;
const stripeInFlight = new Map<string, Promise<{ charges: StripeListResult<StripeChargeLike>; refunds: StripeListResult<StripeRefundLike> }>>();
export const clearStripeCache = () => stripeCache.clear();
const stripeUrl = (kind: 'customers' | 'subscriptions' | 'payments', id: string, livemode: boolean) => `https://dashboard.stripe.com/${livemode ? '' : 'test/'}${kind}/${encodeURIComponent(id)}`;

async function stripeData(r: Range) {
  if (!stripeBilling) return { error: 'Stripe billing is not enabled on this server.' as const };
  // Whole minutes, so repeated views of a preset range (whose start moves every second) share the cache.
  const from = Math.floor((r.from ? +r.from : 0) / 60_000) * 60;
  const to = Math.floor(+r.to / 1000);
  const key = `${from}:${Math.floor(to / 60)}`;
  const now = Date.now();
  for (const [k, v] of stripeCache) if (now - v.at >= STRIPE_CACHE_MS) stripeCache.delete(k); // keep the cache small
  const hit = stripeCache.get(key);
  if (hit) return { ...hit.value, livemode: stripeBilling.api.livemode };
  // Concurrent requests for the same range share one Stripe read instead of each listing up to 2 × STRIPE_MAX objects.
  let pending = stripeInFlight.get(key);
  if (!pending) {
    const api = stripeBilling.api;
    pending = Promise.all([api.listCharges({ from, to }, STRIPE_MAX), api.listRefunds({ from, to }, STRIPE_MAX)])
      .then(([charges, refunds]) => {
        const value = { charges, refunds };
        stripeCache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => stripeInFlight.delete(key));
    stripeInFlight.set(key, pending);
  }
  try {
    return { ...(await pending), livemode: stripeBilling.api.livemode };
  } catch {
    return { error: 'Stripe could not be reached just now. Try again in a moment.' as const };
  }
}

/** Money actually received: a succeeded charge that was captured (an uncaptured authorisation is not). */
const isReceived = (c: StripeChargeLike) => c.status === 'succeeded' && c.captured !== false;

/** Sums per currency. Refunds are counted when they were made (in the range), not against the original charge's date. */
export function summarizeStripe(charges: StripeChargeLike[], refunds: StripeRefundLike[]): StripeMoney[] {
  const by = new Map<string, StripeMoney>();
  const get = (currency: string) => {
    let m = by.get(currency);
    if (!m) by.set(currency, (m = { currency, grossCents: 0, refundedCents: 0, feesCents: 0, netCents: 0, successfulPayments: 0, failedPayments: 0, refunds: 0 }));
    return m;
  };
  for (const c of charges) {
    const m = get(c.currency);
    if (isReceived(c)) {
      m.successfulPayments++;
      m.grossCents += c.amount;
      if (c.fee == null) m.feesCents = null;
      else if (m.feesCents != null) m.feesCents += c.fee;
    } else if (c.status === 'failed') m.failedPayments++;
  }
  for (const rf of refunds) {
    if (rf.status !== 'succeeded') continue;
    const m = get(rf.currency);
    m.refunds++;
    m.refundedCents += rf.amount;
  }
  for (const m of by.values()) m.netCents = m.feesCents == null ? null : m.grossCents - m.refundedCents - m.feesCents;
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

async function stripeSummary(r: Range): Promise<{ summary: StripeSummary; charges: StripeChargeLike[]; livemode: boolean }> {
  const d = await stripeData(r);
  if ('error' in d) return { summary: { available: false, reason: d.error as string }, charges: [], livemode: false };
  return {
    summary: { available: true, source: 'stripe', livemode: d.livemode, byCurrency: summarizeStripe(d.charges.items, d.refunds.items), truncated: d.charges.truncated || d.refunds.truncated, fetchedAt: new Date().toISOString() },
    charges: d.charges.items,
    livemode: d.livemode,
  };
}

// ---------------------------------------------------------------- AI costs (estimates)

async function aiTotals(r: Range): Promise<AdminAICostTotals> {
  const [t] = await rows(sql`select count(*) as calls, count(*) filter (where not success) as failed,
      coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
      coalesce(sum(estimated_cost_micro_usd), 0) as cost, count(*) filter (where estimated_cost_micro_usd is null and input_tokens is not null) as unpriced,
      coalesce(array_agg(distinct pricing_version) filter (where pricing_version is not null), '{}') as versions
    from ai_usage where ${inRange(sql`created_at`, r)}`);
  const [first] = await rows(sql`select min(created_at) as first from ai_usage`);
  const [media] = await rows(sql`select coalesce(sum(amount), 0) as minutes from usage_ledger where kind = 'media_minutes' and ${inRange(sql`created_at`, r)}`);
  const minutes = num(media?.minutes);
  return {
    source: 'estimate',
    trackedSince: iso(first?.first),
    calls: num(t?.calls),
    failedCalls: num(t?.failed),
    inputTokens: num(t?.input),
    outputTokens: num(t?.output),
    estimatedUsd: usd(t?.cost),
    unpricedCalls: num(t?.unpriced),
    pricingVersions: (t?.versions as string[] | undefined) ?? [],
    transcription: { minutes, estimatedUsd: Math.round(minutes * TRANSCRIPTION_USD_PER_MINUTE * 10_000) / 10_000, usdPerMinute: TRANSCRIPTION_USD_PER_MINUTE, source: 'estimate' },
  };
}

// ---------------------------------------------------------------- overview

async function series(table: 'users' | 'analytics_events', r: Range, where: SQL = sql`true`): Promise<Point[]> {
  const t = sql.raw(table);
  const res = await rows(sql`select ${bucket(sql`created_at`, r)} as b, count(*) as n from ${t} where ${inRange(sql`created_at`, r)} and ${where} group by 1 order by 1`);
  return res.map((x) => ({ bucket: String(x.b), count: num(x.n) }));
}

export async function overview(r: Range): Promise<AdminOverview> {
  const [[users], signups, cats, subStatus, events, revenueRows, stripe, ai] = await Promise.all([
    rows(sql`select count(*) as total, count(*) filter (where ${inRange(sql`created_at`, r)}) as fresh from users`),
    series('users', r),
    rows(sql`select ${categorySql()} as category, count(*) as n, count(*) filter (where s.will_renew = false) as cancelling
      from users u left join subscriptions s on s.user_id = u.id group by 1`),
    rows(sql`select status, environment, count(*) as n from subscriptions group by 1, 2`),
    rows(sql`select name,
        count(*) filter (where name = 'subscription_started' and properties->>'from_trial' = 'true') as from_trial,
        count(*) filter (where name = 'subscription_started' and coalesce(properties->>'from_trial', 'false') <> 'true') as direct,
        count(*) filter (where name = 'subscription_expired' and properties->>'was_trial' = 'true') as trial_expired,
        count(*) filter (where name = 'subscription_expired' and coalesce(properties->>'was_trial', 'false') <> 'true') as paid_expired,
        count(*) as n
      from analytics_events where name in ('trial_started', 'subscription_started', 'subscription_cancelled', 'subscription_expired') and ${inRange(sql`created_at`, r)} group by name`),
    rows(sql`select s.plan_id, s.environment, count(*) as n from users u join subscriptions s on s.user_id = u.id
      where ${categorySql()} = 'paid' and s.will_renew group by 1, 2`),
    stripeSummary(r),
    aiTotals(r),
  ]);
  const accounts = { free: 0, trial: 0, paid: 0, owner: 0, paidCancelling: 0, source: 'database' as const };
  for (const c of cats) {
    accounts[c.category as AdminCategory] = num(c.n);
    if (c.category === 'paid') accounts.paidCancelling = num(c.cancelling);
  }
  const byStatus: Record<string, number> = {};
  const byEnvironment: Record<string, number> = {};
  for (const s of subStatus) {
    byStatus[String(s.status)] = (byStatus[String(s.status)] ?? 0) + num(s.n);
    byEnvironment[String(s.environment)] = (byEnvironment[String(s.environment)] ?? 0) + num(s.n);
  }
  const ev = (name: string) => events.find((e) => e.name === name);
  const trialsStarted = num(ev('trial_started')?.n);
  const trialConversions = num(ev('subscription_started')?.from_trial);
  let mrr = 0;
  let paying = 0;
  let excluded = 0;
  for (const row of revenueRows) {
    if (row.environment !== 'production') {
      excluded += num(row.n);
      continue;
    }
    const plan = PLANS.find((p) => p.id === row.plan_id);
    if (!plan) continue;
    paying += num(row.n);
    mrr += num(row.n) * (plan.period === 'yearly' ? plan.priceCents / 12 : plan.priceCents);
  }
  const netByCurrency = stripe.summary.available ? stripe.summary.byCurrency.map((m) => ({ currency: m.currency, netCents: m.netCents })) : [];
  return {
    range: rangeInfo(r),
    users: { total: num(users?.total), newInRange: num(users?.fresh), signups, source: 'database' },
    accounts,
    subscriptions: { byStatus, byEnvironment, source: 'database' },
    conversion: {
      source: 'analytics',
      trialsStarted,
      trialConversions,
      trialConversionRate: trialsStarted ? Math.round((trialConversions / trialsStarted) * 1000) / 1000 : null,
      paidStartsWithoutTrial: num(ev('subscription_started')?.direct),
      cancellations: num(ev('subscription_cancelled')?.n),
      paidExpirations: num(ev('subscription_expired')?.paid_expired),
      trialExpirations: num(ev('subscription_expired')?.trial_expired),
    },
    recurringRevenue: {
      source: 'estimate',
      basis: 'Renewing paid subscriptions in production × catalog price (yearly ÷ 12). Not a Stripe figure; excludes trials, cancelling subscriptions, discounts and taxes.',
      currency: 'EUR',
      mrrCents: Math.round(mrr),
      arrCents: Math.round(mrr * 12),
      payingSubscriptions: paying,
      excludedTestSubscriptions: excluded,
    },
    stripe: stripe.summary,
    aiCost: ai,
    contribution: {
      available: false,
      reason: stripe.summary.available
        ? 'Payments are in ' + (netByCurrency.map((m) => m.currency.toUpperCase()).join(', ') || 'no currency yet') + ' and AI/transcription estimates are in USD; no exchange rate is configured, so they are shown side by side, not subtracted.'
        : 'Live Stripe figures are unavailable for this range.',
      netPaymentsByCurrency: netByCurrency,
      estimatedCostsUsd: Math.round((ai.estimatedUsd + ai.transcription.estimatedUsd) * 10_000) / 10_000,
    },
  };
}

// ---------------------------------------------------------------- customers

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function customerFilters(q: z.output<typeof adminCustomersQuerySchema>): SQL[] {
  const f: SQL[] = [];
  if (q.q) f.push(sql`u.email ilike ${`%${escapeLike(q.q.toLowerCase())}%`}`);
  if (q.status === 'none') f.push(sql`s.id is null`);
  else if (q.status) f.push(sql`s.status = ${q.status}`);
  if (q.signupFrom) f.push(sql`u.created_at >= ${`${q.signupFrom}T00:00:00Z`}::timestamptz`);
  if (q.signupTo) f.push(sql`u.created_at <= ${`${q.signupTo}T23:59:59.999Z`}::timestamptz`);
  if (q.activity === 'active_7d') f.push(sql`exists (select 1 from analytics_events a where a.user_id = u.id and a.created_at > now() - interval '7 days')`);
  if (q.activity === 'active_30d') f.push(sql`exists (select 1 from analytics_events a where a.user_id = u.id and a.created_at > now() - interval '30 days')`);
  if (q.activity === 'inactive_30d') f.push(sql`not exists (select 1 from analytics_events a where a.user_id = u.id and a.created_at > now() - interval '30 days')`);
  if (q.category) f.push(sql`${categorySql()} = ${q.category}`);
  if (q.plan) f.push(sql`${tierSql()} = ${q.plan}`);
  return f;
}

/** Aggregates for a page of accounts: a fixed number of queries per page (never one per customer). */
async function pageAggregates(ids: string[]) {
  const empty = new Map<string, Row>();
  if (!ids.length) return { docs: empty, created: empty, ledger: new Map<string, Row[]>(), activity: empty, ai: empty, trackedSince: null };
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const [docs, created, ledger, activity, ai, trackedSince] = await Promise.all([
    rows(sql`select user_id, count(*) as n from documents where user_id in (${idList}) group by 1`),
    rows(sql`select user_id, count(*) as n from course_creations where user_id in (${idList}) group by 1`),
    rows(sql`select user_id, kind, sum(amount) as total from usage_ledger where user_id in (${idList}) group by 1, 2`),
    rows(sql`select user_id, max(created_at) as last from analytics_events where user_id in (${idList}) group by 1`),
    rows(sql`select user_id, count(*) as calls, coalesce(sum(estimated_cost_micro_usd), 0) as cost,
        count(*) filter (where created_at > now() - interval '30 days') as calls30,
        coalesce(sum(estimated_cost_micro_usd) filter (where created_at > now() - interval '30 days'), 0) as cost30,
        count(*) filter (where estimated_cost_micro_usd is null and input_tokens is not null) as unpriced,
        coalesce(sum(estimated_cost_micro_usd) filter (where created_at > now() - interval '7 days'), 0) as last7,
        coalesce(sum(estimated_cost_micro_usd) filter (where created_at <= now() - interval '7 days' and created_at > now() - interval '35 days'), 0) / 4.0 as prev_avg
      from ai_usage where user_id in (${idList}) group by 1`),
    aiTrackedSince(),
  ]);
  const byUser = (rs: Row[]) => new Map(rs.map((x) => [String(x.user_id), x]));
  const ledgerBy = new Map<string, Row[]>();
  for (const l of ledger) ledgerBy.set(String(l.user_id), [...(ledgerBy.get(String(l.user_id)) ?? []), l]);
  return { docs: byUser(docs), created: byUser(created), ledger: ledgerBy, activity: byUser(activity), ai: byUser(ai), trackedSince };
}

/** The first recorded AI call on this server: AI usage before it was never measured. */
async function aiTrackedSince(): Promise<Date | null> {
  const [first] = await rows(sql`select min(created_at) as first from ai_usage`);
  return first?.first ? new Date(first.first as string) : null;
}

/** Same thresholds as the AI tab's anomaly list (aiReport). Micro-USD inputs. */
export const isUnusual = (last7: number, prevAvg: number) => (prevAvg > 0 && last7 >= 3 * prevAvg && last7 >= 250_000) || (prevAvg === 0 && last7 >= 1_000_000);

export function aiCoverage(signupAt: Date, trackedSince: Date | null): AdminCustomerAI['coverage'] {
  if (!trackedSince) return 'not_tracked';
  return signupAt < trackedSince ? 'partial' : 'full';
}

const customerColumns = () => sql`u.id, u.email, u.created_at, u.email_verified_at is not null as verified,
  s.plan_id, s.provider, s.status, s.trial_ends_at, ${accessEnd} as access_end, s.will_renew,
  ${categorySql()} as category, ${tierSql()} as tier`;

function toCustomer(x: Row, agg: Awaited<ReturnType<typeof pageAggregates>>): AdminCustomer {
  const id = String(x.id);
  const l = agg.ledger.get(id) ?? [];
  const sumKind = (k: string) => num(l.find((r) => r.kind === k)?.total);
  const createdN = num(agg.created.get(id)?.n);
  const ai = agg.ai.get(id);
  const nowN = num(agg.docs.get(id)?.n);
  return {
    id,
    email: String(x.email),
    signupAt: iso(x.created_at)!,
    emailVerified: !!x.verified,
    category: x.category as AdminCategory,
    entitlementTier: String(x.tier),
    planId: (x.plan_id as string) ?? null,
    provider: (x.provider as string) ?? null,
    subscriptionStatus: (x.status as string) ?? null,
    trialEndsAt: iso(x.trial_ends_at),
    accessEndsAt: iso(x.access_end),
    willRenew: x.will_renew == null ? null : !!x.will_renew,
    usage: {
      coursesNow: nowN,
      coursesCreated: Math.max(createdN, nowN),
      exams: sumKind('exam_generation'),
      practiceQuestions: sumKind('practice_questions'),
      studyPlans: sumKind('study_plan_generation'),
      lectureUploads: sumKind('media_upload'),
      lectureMinutes: sumKind('media_minutes'),
    },
    lastActivityAt: iso(agg.activity.get(id)?.last),
    ai: {
      calls: num(ai?.calls),
      estimatedUsd: usd(ai?.cost),
      last30dCalls: num(ai?.calls30),
      last30dUsd: usd(ai?.cost30),
      unpricedCalls: num(ai?.unpriced),
      unusual: ai ? isUnusual(num(ai.last7), num(ai.prev_avg)) : false,
      coverage: aiCoverage(new Date(x.created_at as string), agg.trackedSince),
    },
  };
}

export function parseCustomersQuery(query: unknown) {
  const q = adminCustomersQuerySchema.safeParse(query);
  if (!q.success) throw new HttpError(400, 'Invalid filters', 'invalid_filters');
  if (q.data.signupFrom && q.data.signupTo && q.data.signupFrom > q.data.signupTo) throw new HttpError(400, 'signupFrom must be on or before signupTo', 'invalid_filters');
  return q.data;
}

/**
 * ORDER BY for each directory sort. The AI and activity orders use a per-account subquery on the
 * (user_id, created_at) indexes of ai_usage / analytics_events, computed only for the chosen sort.
 */
function customerOrder(sort: z.output<typeof adminCustomersQuerySchema>['sort']): SQL {
  switch (sort) {
    case 'signup_asc':
      return sql`u.created_at asc, u.id asc`;
    case 'email_asc':
      return sql`lower(u.email) asc, u.id asc`;
    case 'last_active_desc':
      return sql`(select max(a.created_at) from analytics_events a where a.user_id = u.id) desc nulls last, u.created_at desc, u.id desc`;
    case 'ai_cost_desc':
      return sql`(select coalesce(sum(x.estimated_cost_micro_usd), 0) from ai_usage x where x.user_id = u.id) desc, u.created_at desc, u.id desc`;
    case 'ai_cost_30d_desc':
      return sql`(select coalesce(sum(x.estimated_cost_micro_usd), 0) from ai_usage x where x.user_id = u.id and x.created_at > now() - interval '30 days') desc, u.created_at desc, u.id desc`;
    case 'ai_calls_desc':
      return sql`(select count(*) from ai_usage x where x.user_id = u.id) desc, u.created_at desc, u.id desc`;
    default:
      return sql`u.created_at desc, u.id desc`;
  }
}

export async function customers(q: z.output<typeof adminCustomersQuerySchema>): Promise<AdminCustomersPage> {
  const where = customerFilters(q);
  const cond = where.length ? sql.join(where, sql` and `) : sql`true`;
  const page = await rows(sql`select ${customerColumns()}, count(*) over () as total_count
    from users u left join subscriptions s on s.user_id = u.id
    where ${cond}
    order by ${customerOrder(q.sort)}
    limit ${q.limit} offset ${(q.page - 1) * q.limit}`);
  const total = page.length ? num(page[0]!.total_count) : num((await rows(sql`select count(*) as n from users u left join subscriptions s on s.user_id = u.id where ${cond}`))[0]?.n);
  const agg = await pageAggregates(page.map((x) => String(x.id)));
  return { items: page.map((x) => toCustomer(x, agg)), page: q.page, limit: q.limit, total, hasMore: q.page * q.limit < total };
}

// ---------------------------------------------------------------- one customer's Stripe payments (live)

const CUSTOMER_CHARGES_MAX = 100;
const customerChargeCache = new Map<string, { at: number; value: StripeListResult<StripeChargeLike> }>();
const customerChargeInFlight = new Map<string, Promise<StripeListResult<StripeChargeLike>>>();
export const clearCustomerChargeCache = () => customerChargeCache.clear();

/** Gross, refunds (on the charge they belong to), fees and failures per currency for one customer's charges. */
export function summarizeCustomerCharges(charges: StripeChargeLike[]): StripeMoney[] {
  const by = new Map<string, StripeMoney>();
  for (const c of charges) {
    let m = by.get(c.currency);
    if (!m) by.set(c.currency, (m = { currency: c.currency, grossCents: 0, refundedCents: 0, feesCents: 0, netCents: 0, successfulPayments: 0, failedPayments: 0, refunds: 0 }));
    if (isReceived(c)) {
      m.successfulPayments++;
      m.grossCents += c.amount;
      if (c.amountRefunded > 0) {
        m.refunds++;
        m.refundedCents += c.amountRefunded;
      }
      if (c.fee == null) m.feesCents = null;
      else if (m.feesCents != null) m.feesCents += c.fee;
    } else if (c.status === 'failed') m.failedPayments++;
  }
  for (const m of by.values()) m.netCents = m.feesCents == null ? null : m.grossCents - m.refundedCents - m.feesCents;
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

async function customerPayments(stripeCustomerId: string | null, provider: string | null): Promise<AdminCustomerPayments> {
  if (!stripeCustomerId) {
    const store = provider === 'apple' ? 'App Store Connect' : provider === 'google' ? 'Google Play Console' : null;
    return {
      available: false,
      reason: store
        ? `This customer pays through ${store}; store payments are not available here.`
        : 'No Stripe customer for this account, so there are no Stripe payments to show.',
    };
  }
  if (!stripeBilling) return { available: false, reason: 'Stripe billing is not enabled on this server.' };
  const api = stripeBilling.api;
  const now = Date.now();
  for (const [k, v] of customerChargeCache) if (now - v.at >= STRIPE_CACHE_MS) customerChargeCache.delete(k);
  let list: StripeListResult<StripeChargeLike>;
  try {
    const hit = customerChargeCache.get(stripeCustomerId);
    if (hit) list = hit.value;
    else {
      let pending = customerChargeInFlight.get(stripeCustomerId);
      if (!pending) {
        pending = api
          .listCustomerCharges(stripeCustomerId, CUSTOMER_CHARGES_MAX)
          // Defence in depth: only charges Stripe attributes to this customer are ever shown for them.
          .then((r) => ({ ...r, items: r.items.filter((c) => c.customerId === stripeCustomerId) }))
          .then((value) => {
            customerChargeCache.set(stripeCustomerId, { at: Date.now(), value });
            return value;
          })
          .finally(() => customerChargeInFlight.delete(stripeCustomerId));
        customerChargeInFlight.set(stripeCustomerId, pending);
      }
      list = await pending;
    }
  } catch {
    return { available: false, reason: 'Stripe could not return this customer’s payments just now. Try again in a moment.' };
  }
  return {
    available: true,
    source: 'stripe',
    livemode: api.livemode,
    byCurrency: summarizeCustomerCharges(list.items),
    charges: list.items.slice(0, 20).map((c) => ({
      id: c.id,
      created: new Date(c.created * 1000).toISOString(),
      amountCents: c.amount,
      refundedCents: c.amountRefunded,
      currency: c.currency,
      status: c.status === 'succeeded' && c.captured === false ? 'uncaptured' : c.status,
      failureCode: c.failureCode,
      disputed: c.disputed === true,
      url: stripeUrl('payments', c.id, c.livemode),
    })),
    truncated: list.truncated,
    fetchedAt: new Date().toISOString(),
  };
}

const eventRow = (e: Row): AdminEvent => ({ name: String(e.name), source: String(e.source), createdAt: iso(e.created_at)!, properties: (e.properties as Record<string, unknown>) ?? {} });

export async function customerDetail(userId: string): Promise<AdminCustomerDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(404, 'Customer not found', 'not_found');
  const [x] = await rows(sql`select ${customerColumns()} from users u left join subscriptions s on s.user_id = u.id where u.id = ${userId}::uuid`);
  if (!x) throw new HttpError(404, 'Customer not found', 'not_found');
  const [agg, [sub], [cust], [onb], device, history, usageByMonth, aiByFeature, recent, [aiWin], aiByModel, aiDaily, [media]] = await Promise.all([
    pageAggregates([userId]),
    rows(sql`select provider, plan_id, status, environment, trial_ends_at, current_period_ends_at, will_renew, trial_used, provider_ref, created_at, updated_at from subscriptions where user_id = ${userId}::uuid`),
    rows(sql`select stripe_customer_id from stripe_customers where user_id = ${userId}::uuid`),
    rows(sql`select status from user_onboarding where user_id = ${userId}::uuid`),
    rows(sql`select properties->>'app_language' as lang, properties->>'time_zone' as tz from analytics_events
      where user_id = ${userId}::uuid and name = 'app_opened' and source = 'client' order by created_at desc limit 1`),
    rows(sql`select name, source, created_at, properties from analytics_events where user_id = ${userId}::uuid
      and name in ('trial_started', 'subscription_started', 'subscription_cancelled', 'subscription_expired', 'subscription_restored', 'checkout_started', 'checkout_completed', 'upgrade_started')
      order by created_at desc limit 100`),
    rows(sql`select to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as month, kind, sum(amount) as total
      from usage_ledger where user_id = ${userId}::uuid and created_at > now() - interval '12 months' group by 1, 2 order by 1 desc, 2`),
    rows(sql`select feature, count(*) as calls, coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output, coalesce(sum(estimated_cost_micro_usd), 0) as cost
      from ai_usage where user_id = ${userId}::uuid group by 1 order by cost desc`),
    rows(sql`select name, source, created_at, properties from analytics_events where user_id = ${userId}::uuid order by created_at desc limit 50`),
    rows(sql`select ${sql.join(
      (['all', '7', '30'] as const).map((w) => {
        const f = w === 'all' ? sql`true` : sql`created_at > now() - ${`${w} days`}::interval`;
        return sql`count(*) filter (where ${f}) as ${sql.raw(`w${w}_calls`)}, count(*) filter (where ${f} and not success) as ${sql.raw(`w${w}_failed`)},
          coalesce(sum(input_tokens) filter (where ${f}), 0) as ${sql.raw(`w${w}_in`)}, coalesce(sum(output_tokens) filter (where ${f}), 0) as ${sql.raw(`w${w}_out`)},
          coalesce(sum(estimated_cost_micro_usd) filter (where ${f}), 0) as ${sql.raw(`w${w}_cost`)},
          count(*) filter (where ${f} and estimated_cost_micro_usd is null and input_tokens is not null) as ${sql.raw(`w${w}_unpriced`)}`;
      }),
      sql`, `,
    )}, coalesce(array_agg(distinct pricing_version) filter (where pricing_version is not null), '{}') as versions
      from ai_usage where user_id = ${userId}::uuid`),
    rows(sql`select provider, model, count(*) as calls, coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
        coalesce(sum(estimated_cost_micro_usd), 0) as cost, count(*) filter (where estimated_cost_micro_usd is null and input_tokens is not null) as unpriced
      from ai_usage where user_id = ${userId}::uuid group by 1, 2 order by cost desc, calls desc`),
    rows(sql`select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*) as calls, coalesce(sum(estimated_cost_micro_usd), 0) as cost
      from ai_usage where user_id = ${userId}::uuid and created_at > now() - interval '30 days' group by 1 order by 1`),
    rows(sql`select coalesce(sum(amount), 0) as total, coalesce(sum(amount) filter (where created_at > now() - interval '30 days'), 0) as last30
      from usage_ledger where user_id = ${userId}::uuid and kind = 'media_minutes'`),
  ]);
  const livemode = stripeBilling?.api.livemode ?? false;
  const stripeSubId = sub?.provider === 'stripe' ? ((sub.provider_ref as string) ?? null) : null;
  const stripeCustomerId = (cust?.stripe_customer_id as string) ?? null;
  const customer = toCustomer(x, agg);
  const win = (w: 'all' | '7' | '30'): AdminUsageWindow => ({
    calls: num(aiWin?.[`w${w}_calls`]),
    failedCalls: num(aiWin?.[`w${w}_failed`]),
    inputTokens: num(aiWin?.[`w${w}_in`]),
    outputTokens: num(aiWin?.[`w${w}_out`]),
    estimatedUsd: usd(aiWin?.[`w${w}_cost`]),
    unpricedCalls: num(aiWin?.[`w${w}_unpriced`]),
  });
  const minutes = num(media?.total);
  const aiUsage: AdminCustomerAIDetail = {
    source: 'estimate',
    trackedSince: agg.trackedSince?.toISOString() ?? null,
    coverage: customer.ai.coverage,
    pricingVersions: (aiWin?.versions as string[] | undefined) ?? [],
    allTime: win('all'),
    last7d: win('7'),
    last30d: win('30'),
    byModel: aiByModel.map((m) => ({ provider: String(m.provider), model: String(m.model), calls: num(m.calls), inputTokens: num(m.input), outputTokens: num(m.output), estimatedUsd: usd(m.cost), unpricedCalls: num(m.unpriced) })),
    daily: aiDaily.map((d) => ({ day: String(d.day), calls: num(d.calls), estimatedUsd: usd(d.cost) })),
    transcription: {
      source: 'estimate',
      minutes,
      minutesLast30d: num(media?.last30),
      estimatedUsd: Math.round(minutes * TRANSCRIPTION_USD_PER_MINUTE * 10_000) / 10_000,
      usdPerMinute: TRANSCRIPTION_USD_PER_MINUTE,
    },
  };
  return {
    customer: { ...customer, language: (device[0]?.lang as string) ?? null, timeZone: (device[0]?.tz as string) ?? null, onboarding: (onb?.status as string) ?? null },
    subscription: sub
      ? {
          provider: String(sub.provider),
          planId: String(sub.plan_id),
          status: String(sub.status),
          environment: String(sub.environment),
          trialEndsAt: iso(sub.trial_ends_at),
          currentPeriodEndsAt: iso(sub.current_period_ends_at),
          willRenew: !!sub.will_renew,
          trialUsed: !!sub.trial_used,
          createdAt: iso(sub.created_at)!,
          updatedAt: iso(sub.updated_at)!,
          hasStoreReference: sub.provider_ref != null,
        }
      : null,
    stripe:
      stripeCustomerId || stripeSubId
        ? {
            customerId: stripeCustomerId,
            subscriptionId: stripeSubId,
            customerUrl: stripeCustomerId ? stripeUrl('customers', stripeCustomerId, livemode) : null,
            subscriptionUrl: stripeSubId ? stripeUrl('subscriptions', stripeSubId, livemode) : null,
          }
        : null,
    planHistory: history.map(eventRow),
    usageByMonth: usageByMonth.map((u) => ({ month: String(u.month), kind: String(u.kind), total: num(u.total) })),
    aiByFeature: aiByFeature.map((a) => ({ feature: String(a.feature), calls: num(a.calls), inputTokens: num(a.input), outputTokens: num(a.output), estimatedUsd: usd(a.cost) })),
    aiUsage,
    payments: await customerPayments(stripeCustomerId, sub ? String(sub.provider) : null),
    recentEvents: recent.map(eventRow),
  };
}

// ---------------------------------------------------------------- AI report

export async function aiReport(r: Range): Promise<AdminAIReport> {
  const window = inRange(sql`created_at`, r);
  const [totals, byFeature, byModel, ser, top, [active], [paying], anomalies] = await Promise.all([
    aiTotals(r),
    rows(sql`select feature, count(*) as calls, count(*) filter (where not success) as failed, coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
        coalesce(sum(estimated_cost_micro_usd), 0) as cost,
        percentile_cont(0.5) within group (order by latency_ms) as p50, percentile_cont(0.95) within group (order by latency_ms) as p95
      from ai_usage where ${window} group by 1 order by cost desc`),
    rows(sql`select provider, model, count(*) as calls, coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
        coalesce(sum(estimated_cost_micro_usd), 0) as cost, count(*) filter (where estimated_cost_micro_usd is null and input_tokens is not null) as unpriced
      from ai_usage where ${window} group by 1, 2 order by cost desc`),
    rows(sql`select ${bucket(sql`created_at`, r)} as b, count(*) as calls, coalesce(sum(estimated_cost_micro_usd), 0) as cost from ai_usage where ${window} group by 1 order by 1`),
    rows(sql`select a.user_id, u.email, count(*) as calls, coalesce(sum(a.estimated_cost_micro_usd), 0) as cost
      from ai_usage a left join users u on u.id = a.user_id where ${inRange(sql`a.created_at`, r)} group by 1, 2 order by cost desc, calls desc limit 10`),
    rows(sql`select count(distinct user_id) as n from analytics_events where user_id is not null and ${window}`),
    rows(sql`select count(*) as n from users u join subscriptions s on s.user_id = u.id where ${categorySql()} = 'paid'`),
    rows(sql`with w as (
        select user_id,
          coalesce(sum(estimated_cost_micro_usd) filter (where created_at > now() - interval '7 days'), 0) as last7,
          coalesce(sum(estimated_cost_micro_usd) filter (where created_at <= now() - interval '7 days' and created_at > now() - interval '35 days'), 0) / 4.0 as prev_avg
        from ai_usage where user_id is not null and created_at > now() - interval '35 days' group by 1)
      select w.user_id, u.email, w.last7, w.prev_avg from w left join users u on u.id = w.user_id
      where (w.prev_avg > 0 and w.last7 >= 3 * w.prev_avg and w.last7 >= 250000) or (w.prev_avg = 0 and w.last7 >= 1000000)
      order by w.last7 desc limit 10`),
  ]);
  const activeUsers = num(active?.n);
  const payingSubscribers = num(paying?.n);
  const totalUsd = totals.estimatedUsd + totals.transcription.estimatedUsd;
  return {
    range: rangeInfo(r),
    totals,
    prices: {
      version: AI_PRICING_VERSION,
      models: Object.fromEntries(Object.entries(AI_MODEL_PRICES).map(([k, v]) => [k, { inputPerMTok: v.inputPerMTok, outputPerMTok: v.outputPerMTok }])),
      transcriptionUsdPerMinute: TRANSCRIPTION_USD_PER_MINUTE,
    },
    byFeature: byFeature.map((f) => ({
      feature: String(f.feature),
      calls: num(f.calls),
      failedCalls: num(f.failed),
      inputTokens: num(f.input),
      outputTokens: num(f.output),
      estimatedUsd: usd(f.cost),
      p50LatencyMs: numOrNull(f.p50) == null ? null : Math.round(num(f.p50)),
      p95LatencyMs: numOrNull(f.p95) == null ? null : Math.round(num(f.p95)),
    })),
    byModel: byModel.map((m) => ({ provider: String(m.provider), model: String(m.model), calls: num(m.calls), inputTokens: num(m.input), outputTokens: num(m.output), estimatedUsd: usd(m.cost), unpricedCalls: num(m.unpriced) })),
    series: ser.map((s) => ({ bucket: String(s.b), calls: num(s.calls), estimatedUsd: usd(s.cost) })),
    topUsers: top.map((t) => ({ userId: (t.user_id as string) ?? null, email: (t.email as string) ?? null, calls: num(t.calls), estimatedUsd: usd(t.cost) })),
    perActiveUserUsd: activeUsers ? Math.round((totalUsd / activeUsers) * 10_000) / 10_000 : null,
    perPayingSubscriberUsd: payingSubscribers ? Math.round((totalUsd / payingSubscribers) * 10_000) / 10_000 : null,
    activeUsers,
    payingSubscribers,
    anomalies: anomalies.map((a) => ({ userId: String(a.user_id), email: (a.email as string) ?? null, last7dUsd: usd(a.last7), previousWeeklyAvgUsd: usd(a.prev_avg) })),
  };
}

// ---------------------------------------------------------------- billing

export async function billingReport(r: Range): Promise<AdminBillingReport> {
  const livemode = stripeBilling?.api.livemode ?? false;
  const [status, plans, [soon], [cancelling], subs, stripe] = await Promise.all([
    rows(sql`select status, count(*) as n from subscriptions group by 1`),
    rows(sql`select plan_id, count(*) as n from subscriptions where status <> 'expired' group by 1 order by 2 desc`),
    rows(sql`select count(*) as n from subscriptions where status = 'trialing' and trial_ends_at between now() and now() + interval '7 days'`),
    rows(sql`select count(*) as n from users u join subscriptions s on s.user_id = u.id where ${categorySql()} = 'paid' and not s.will_renew`),
    rows(sql`select s.user_id, u.email, s.provider, s.plan_id, s.status, s.environment, s.trial_ends_at, s.current_period_ends_at, s.will_renew, s.provider_ref, s.updated_at, c.stripe_customer_id
      from subscriptions s join users u on u.id = s.user_id left join stripe_customers c on c.user_id = s.user_id
      order by s.updated_at desc limit 50`),
    stripeSummary(r),
  ]);
  const byStatus: Record<string, number> = {};
  for (const s of status) byStatus[String(s.status)] = num(s.n);
  return {
    range: rangeInfo(r),
    database: {
      source: 'database',
      byStatus,
      byPlan: plans.map((p) => ({ planId: String(p.plan_id), count: num(p.n) })),
      trialsEndingNext7d: num(soon?.n),
      cancellingAtPeriodEnd: num(cancelling?.n),
      note: 'Exama stores trialing, active, cancelled and expired. Stripe states such as past_due, unpaid or incomplete are not stored; see Stripe for those.',
      subscriptions: subs.map((s) => {
        const subId = s.provider === 'stripe' ? ((s.provider_ref as string) ?? null) : null;
        return {
          userId: String(s.user_id),
          email: String(s.email),
          provider: String(s.provider),
          planId: String(s.plan_id),
          status: String(s.status),
          environment: String(s.environment),
          trialEndsAt: iso(s.trial_ends_at),
          currentPeriodEndsAt: iso(s.current_period_ends_at),
          willRenew: !!s.will_renew,
          stripeCustomerId: (s.stripe_customer_id as string) ?? null,
          stripeSubscriptionId: subId,
          stripeUrl: subId ? stripeUrl('subscriptions', subId, livemode) : null,
          updatedAt: iso(s.updated_at)!,
        };
      }),
    },
    stripe: stripe.summary,
    charges: stripe.summary.available
      ? stripe.charges.slice(0, 50).map((c) => ({
          id: c.id,
          created: new Date(c.created * 1000).toISOString(),
          amountCents: c.amount,
          refundedCents: c.amountRefunded,
          currency: c.currency,
          status: c.status,
          failureCode: c.failureCode,
          customerId: c.customerId,
          url: stripeUrl('payments', c.id, stripe.livemode),
        }))
      : { available: false, reason: stripe.summary.reason },
  };
}

// ---------------------------------------------------------------- product analytics

const FUNNEL_EVENTS = ['paywall_viewed', 'plan_selected', 'upgrade_started', 'checkout_started', 'checkout_completed', 'trial_started', 'subscription_started'] as const;
const SERIES_EVENTS = ['signup_completed', 'email_verified', 'upload_succeeded', 'exam_generation_completed', 'practice_completed', 'paywall_viewed', 'upgrade_started', 'checkout_started', 'trial_started', 'subscription_started', 'subscription_cancelled', 'subscription_expired'];

export async function analyticsReport(r: Range): Promise<AdminAnalyticsReport> {
  const cohort = inRange(sql`u.created_at`, r);
  const hasEvent = (name: string, extra: SQL = sql`true`) => sql`count(*) filter (where exists (select 1 from analytics_events a where a.user_id = u.id and a.name = ${name} and ${extra}))`;
  const [[f], ser, firstSeen] = await Promise.all([
    rows(sql`select count(*) as signed_up,
        count(*) filter (where u.email_verified_at is not null) as verified,
        count(*) filter (where exists (select 1 from user_onboarding o where o.user_id = u.id and o.status in ('completed', 'skipped'))) as onboarded,
        count(*) filter (where exists (select 1 from course_creations c where c.user_id = u.id) or exists (select 1 from documents d where d.user_id = u.id)) as course,
        count(*) filter (where exists (select 1 from usage_ledger l where l.user_id = u.id and l.kind = 'exam_generation')) as exam,
        count(*) filter (where exists (select 1 from usage_ledger l where l.user_id = u.id and l.kind = 'practice_questions')) as practice,
        ${hasEvent('paywall_viewed')} as paywall_viewed, ${hasEvent('plan_selected')} as plan_selected, ${hasEvent('upgrade_started')} as upgrade_started,
        ${hasEvent('checkout_started')} as checkout_started, ${hasEvent('trial_started')} as trial_started,
        ${hasEvent('subscription_started')} as paid
      from users u where ${cohort}`),
    rows(sql`select name, ${bucket(sql`created_at`, r)} as b, count(*) as n from analytics_events
      where name in (${sql.join(SERIES_EVENTS.map((e) => sql`${e}`), sql`, `)}) and ${inRange(sql`created_at`, r)} group by 1, 2 order by 2`),
    rows(sql`select name, min(created_at) as first from analytics_events where name in (${sql.join(FUNNEL_EVENTS.map((e) => sql`${e}`), sql`, `)}) group by 1`),
  ]);
  const first = (name: string) => iso(firstSeen.find((x) => x.name === name)?.first);
  const series: Record<string, Point[]> = Object.fromEntries(SERIES_EVENTS.map((e) => [e, [] as Point[]]));
  for (const s of ser) series[String(s.name)]!.push({ bucket: String(s.b), count: num(s.n) });
  const checkoutSince = first('checkout_started');
  return {
    range: rangeInfo(r),
    funnel: [
      { key: 'signed_up', label: 'Signed up', users: num(f?.signed_up), source: 'database' },
      { key: 'verified', label: 'Confirmed email', users: num(f?.verified), source: 'database' },
      { key: 'onboarded', label: 'Finished onboarding (answered or skipped)', users: num(f?.onboarded), source: 'database' },
      { key: 'course', label: 'Created a course', users: num(f?.course), source: 'database' },
      { key: 'exam', label: 'Generated an exam', users: num(f?.exam), source: 'database' },
      { key: 'practice', label: 'Practised weak topics', users: num(f?.practice), source: 'database' },
      { key: 'paywall_viewed', label: 'Saw the paywall', users: num(f?.paywall_viewed), source: 'analytics', note: 'Only views while signed in are linked to an account.' },
      { key: 'plan_selected', label: 'Selected a plan', users: num(f?.plan_selected), source: 'analytics' },
      { key: 'upgrade_started', label: 'Tapped subscribe (app)', users: num(f?.upgrade_started), source: 'analytics' },
      {
        key: 'checkout_started',
        label: 'Opened Stripe Checkout (web)',
        users: checkoutSince ? num(f?.checkout_started) : null,
        source: 'analytics',
        note: checkoutSince ? `Recorded since ${checkoutSince.slice(0, 10)}.` : 'Not recorded yet (added with this dashboard).',
      },
      { key: 'trial_started', label: 'Started a free trial', users: num(f?.trial_started), source: 'analytics', note: 'A trial is not a payment.' },
      { key: 'paid', label: 'Started a paid subscription', users: num(f?.paid), source: 'analytics', note: 'subscription_started only (direct or after a trial); trials are not counted.' },
    ],
    series,
    missing: [
      { event: 'checkout_started', note: 'Server event when a Stripe Checkout page is created. Added with this dashboard; earlier checkouts are not counted.', firstSeen: checkoutSince },
      { event: 'checkout_completed', note: 'Server event from the Stripe webhook (payment_status tells a paid checkout from a trial). Added with this dashboard.', firstSeen: first('checkout_completed') },
      { event: 'checkout_returned', note: 'Not tracked: returning from Checkout without paying (cancel URL) isn’t recorded. Smallest fix: a client event on the cancel/return page.', firstSeen: null },
      { event: 'store purchases started', note: 'App Store / Google Play purchase sheets opened are not recorded separately from upgrade_started.', firstSeen: null },
    ],
  };
}

// ---------------------------------------------------------------- health

const startedAt = Date.now();
function expectedMigrations(): { count: number; latest: string | null } | null {
  try {
    const j = JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { tag: string }[] };
    return { count: j.entries.length, latest: j.entries.at(-1)?.tag ?? null };
  } catch {
    return null;
  }
}

export async function health(): Promise<AdminHealth> {
  let dbOk = true;
  let applied: number | null = null;
  try {
    applied = num((await rows(sql`select count(*) as n from drizzle.__drizzle_migrations`))[0]?.n);
  } catch {
    try {
      await rows(sql`select 1`);
    } catch {
      dbOk = false;
    }
  }
  const expected = expectedMigrations();
  const [[docs], [mats], [ai], aiCodes, [hooks], hookTypes, reminders] = await Promise.all([
    rows(sql`select count(*) filter (where status = 'processing') as processing,
        count(*) filter (where status = 'processing' and created_at < now() - interval '30 minutes') as stuck,
        count(*) filter (where status = 'failed' and created_at > now() - interval '7 days') as failed from documents`),
    rows(sql`select count(*) filter (where status in ('processing', 'transcribing', 'analyzing')) as processing,
        count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days') as failed from course_materials`),
    rows(sql`select count(*) as calls, count(*) filter (where not success) as failed,
        percentile_cont(0.5) within group (order by latency_ms) as p50, percentile_cont(0.95) within group (order by latency_ms) as p95
      from ai_usage where created_at > now() - interval '24 hours'`),
    rows(sql`select error_code, count(*) as n from ai_usage where not success and created_at > now() - interval '24 hours' group by 1`),
    rows(sql`select count(*) as received, count(*) filter (where processed_at is null and claimed_at < now() - interval '10 minutes') as unprocessed, max(claimed_at) as last
      from stripe_events where claimed_at > now() - interval '7 days'`),
    rows(sql`select type, count(*) as n from stripe_events where claimed_at > now() - interval '7 days' group by 1`),
    rows(sql`select status, count(*) as n from study_reminder_emails where updated_at > now() - interval '7 days' group by 1`),
  ]);
  const calls = num(ai?.calls);
  const onOff = (v: boolean) => (v ? 'enabled' : 'disabled') as 'enabled' | 'disabled';
  return {
    api: { ok: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), node: process.version },
    database: {
      ok: dbOk,
      migrationsApplied: applied,
      migrationsExpected: expected?.count ?? null,
      latestExpected: expected?.latest ?? null,
      upToDate: applied == null || !expected ? null : applied >= expected.count,
    },
    jobs: { documentsProcessing: num(docs?.processing), documentsStuck: num(docs?.stuck), documentsFailed7d: num(docs?.failed), materialsProcessing: num(mats?.processing), materialsFailed7d: num(mats?.failed) },
    ai: {
      calls24h: calls,
      failed24h: num(ai?.failed),
      errorRate24h: calls ? Math.round((num(ai?.failed) / calls) * 1000) / 1000 : null,
      p50LatencyMs: ai?.p50 == null ? null : Math.round(num(ai.p50)),
      p95LatencyMs: ai?.p95 == null ? null : Math.round(num(ai.p95)),
      errorCodes: Object.fromEntries(aiCodes.map((c) => [String(c.error_code ?? 'unknown'), num(c.n)])),
    },
    stripeWebhooks: { received7d: num(hooks?.received), unprocessed: num(hooks?.unprocessed), lastReceivedAt: iso(hooks?.last), byType: Object.fromEntries(hookTypes.map((h) => [String(h.type), num(h.n)])) },
    email: {
      reminders7d: Object.fromEntries(reminders.map((x) => [String(x.status), num(x.n)])),
      otherEmails: { available: false, reason: 'Delivery outcomes of verification, password-reset and receipt emails are not recorded (no Resend webhook). See the Resend dashboard.' },
    },
    features: {
      stripeBilling: onOff(!!stripeBilling),
      email: onOff(config.EMAIL_PROVIDER !== 'disabled'),
      studyReminderEmails: onOff(config.STUDY_REMINDER_EMAILS_ENABLED),
      realAI: onOff(config.AI_PROVIDER !== 'mock'),
      lectureTranscription: onOff(config.TRANSCRIPTION_PROVIDER !== 'disabled'),
    },
  };
}
