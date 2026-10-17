/**
 * Owner-only admin dashboard (GET /admin/*). Read-only. Every figure carries where it comes from:
 *   - "database": Exama's own records (authoritative for accounts, entitlements, usage);
 *   - "stripe": read live from Stripe at request time (authoritative for money);
 *   - "analytics": product events (counts of what happened, not money);
 *   - "estimate": calculated from usage × a dated price table — never a charge.
 * Missing data is returned as `null` with a reason, never as 0.
 */
import { z } from 'zod';
import { TIERS } from './billing';

export const ADMIN_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];
export const ADMIN_INTERVALS = ['day', 'week', 'month'] as const;
export type AdminInterval = (typeof ADMIN_INTERVALS)[number];
/** Account categories, from the subscription state (a trial is never "paid"). */
export const ADMIN_CATEGORIES = ['free', 'trial', 'paid', 'owner'] as const;
export type AdminCategory = (typeof ADMIN_CATEGORIES)[number];

/** Directory sort orders. AI orders use recorded calls only (see AdminCustomerAI.coverage). */
export const ADMIN_CUSTOMER_SORTS = ['signup_desc', 'signup_asc', 'email_asc', 'last_active_desc', 'ai_cost_desc', 'ai_cost_30d_desc', 'ai_calls_desc'] as const;
export type AdminCustomerSort = (typeof ADMIN_CUSTOMER_SORTS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Either a preset range or an explicit from/to (both YYYY-MM-DD, at most 366 days apart). */
export const adminRangeQuerySchema = z
  .object({
    range: z.enum(ADMIN_RANGES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    interval: z.enum(ADMIN_INTERVALS).optional(),
  })
  .strict();

export const adminCustomersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    category: z.enum(ADMIN_CATEGORIES).optional(),
    status: z.enum(['none', 'trialing', 'active', 'cancelled', 'expired']).optional(),
    signupFrom: isoDate.optional(),
    signupTo: isoDate.optional(),
    activity: z.enum(['active_7d', 'active_30d', 'inactive_30d']).optional(),
    /** The tier the account has now (same rule as the entitlement resolver; owner accounts never match). */
    plan: z.enum(TIERS).optional(),
    sort: z.enum(ADMIN_CUSTOMER_SORTS).default('signup_desc'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AdminCustomersQuery = z.input<typeof adminCustomersQuerySchema>;

export type AdminSource = 'database' | 'stripe' | 'analytics' | 'estimate';
export type Unavailable = { available: false; reason: string };
export type Point = { bucket: string; count: number };

export type AdminRangeInfo = { label: string; from: string | null; to: string; interval: AdminInterval };

export type StripeMoney = {
  currency: string;
  grossCents: number;
  refundedCents: number;
  /** null when Stripe returned no fee for some charge. */
  feesCents: number | null;
  /** gross − refunds − fees (Stripe processing fees only; not taxes or payouts). null when fees are unknown. */
  netCents: number | null;
  successfulPayments: number;
  failedPayments: number;
  refunds: number;
};
export type StripeSummary =
  | { available: true; source: 'stripe'; livemode: boolean; byCurrency: StripeMoney[]; truncated: boolean; fetchedAt: string }
  | Unavailable;

export type AdminOverview = {
  range: AdminRangeInfo;
  users: { total: number; newInRange: number; signups: Point[]; source: 'database' };
  accounts: Record<AdminCategory, number> & { paidCancelling: number; source: 'database' };
  subscriptions: { byStatus: Record<string, number>; byEnvironment: Record<string, number>; source: 'database' };
  conversion: {
    source: 'analytics';
    trialsStarted: number;
    /** subscription_started after a trial (paid conversion), in the range. */
    trialConversions: number;
    /** trialConversions / trialsStarted for the range, or null when no trial started. Cohorts overlap ranges: indicative. */
    trialConversionRate: number | null;
    paidStartsWithoutTrial: number;
    cancellations: number;
    paidExpirations: number;
    trialExpirations: number;
  };
  recurringRevenue: { source: 'estimate'; basis: string; currency: 'EUR'; mrrCents: number; arrCents: number; payingSubscriptions: number; excludedTestSubscriptions: number };
  stripe: StripeSummary;
  aiCost: AdminAICostTotals;
  contribution: { available: false; reason: string; netPaymentsByCurrency: { currency: string; netCents: number | null }[]; estimatedCostsUsd: number | null };
};

export type AdminAICostTotals = {
  source: 'estimate';
  /** First recorded AI call; usage before this was never measured. */
  trackedSince: string | null;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  /** Calls whose model has no price in the table (not included in estimatedUsd). */
  unpricedCalls: number;
  pricingVersions: string[];
  transcription: { minutes: number; estimatedUsd: number; usdPerMinute: number; source: 'estimate' };
};

export type AdminCustomer = {
  id: string;
  email: string;
  signupAt: string;
  emailVerified: boolean;
  category: AdminCategory;
  /** The tier the server grants now (same rules as the entitlement resolver). */
  entitlementTier: string;
  planId: string | null;
  provider: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  willRenew: boolean | null;
  usage: { coursesNow: number; coursesCreated: number; exams: number; practiceQuestions: number; studyPlans: number; lectureUploads: number; lectureMinutes: number };
  lastActivityAt: string | null;
  ai: AdminCustomerAI;
};

/**
 * Per-customer AI usage from ai_usage (provider-reported tokens; cost is an estimate).
 * `coverage` says how much of the customer's history that covers:
 *   - "not_tracked": nothing has been recorded on this server yet — usage is UNAVAILABLE, not zero;
 *   - "partial": the account existed before recording started (`trackedSince`); earlier usage is unknown;
 *   - "full": the account was created after recording started, so 0 calls really means no AI usage.
 */
export type AdminCustomerAI = {
  calls: number;
  estimatedUsd: number;
  last30dCalls: number;
  last30dUsd: number;
  /** Calls with tokens but no price for their model (not in estimatedUsd). */
  unpricedCalls: number;
  /** Same rule as the AI tab's "Unusual consumption". */
  unusual: boolean;
  coverage: 'not_tracked' | 'partial' | 'full';
};

export type AdminUsageWindow = { calls: number; failedCalls: number; inputTokens: number; outputTokens: number; estimatedUsd: number; unpricedCalls: number };
export type AdminCustomerAIDetail = {
  source: 'estimate';
  trackedSince: string | null;
  coverage: AdminCustomerAI['coverage'];
  pricingVersions: string[];
  allTime: AdminUsageWindow;
  last7d: AdminUsageWindow;
  last30d: AdminUsageWindow;
  byModel: { provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; estimatedUsd: number; unpricedCalls: number }[];
  /** Last 30 days, one row per UTC day with calls. */
  daily: { day: string; calls: number; estimatedUsd: number }[];
  /** Billed lecture minutes from the usage ledger (recorded since lecture uploads launched) × the transcription price. */
  transcription: { source: 'estimate'; minutes: number; minutesLast30d: number; estimatedUsd: number; usdPerMinute: number };
};

/**
 * One customer's Stripe charges, read live (Charges API filtered by that Stripe customer id).
 *   - gross: captured, succeeded charges only (pending, failed and uncaptured are not money received);
 *   - refunded: each charge's `amount_refunded` (on the charge it belongs to, so never counted twice);
 *   - fees: the charge's balance-transaction fee in the same currency, else unknown (null) for that currency;
 *   - net = gross − refunded − fees (null when fees are unknown). Not profit: no taxes, disputes, payouts or other costs.
 */
export type AdminCustomerPayments =
  | {
      available: true;
      source: 'stripe';
      livemode: boolean;
      byCurrency: StripeMoney[];
      /** status: succeeded | pending | failed | uncaptured (authorised, never captured: not received). */
      charges: { id: string; created: string; amountCents: number; refundedCents: number; currency: string; status: string; failureCode: string | null; disputed: boolean; url: string }[];
      truncated: boolean;
      fetchedAt: string;
    }
  | Unavailable;
export type AdminCustomersPage = { items: AdminCustomer[]; page: number; limit: number; total: number; hasMore: boolean };

export type AdminEvent = { name: string; source: string; createdAt: string; properties: Record<string, unknown> };
export type AdminCustomerDetail = {
  customer: AdminCustomer & { language: string | null; timeZone: string | null; onboarding: string | null };
  subscription: {
    provider: string;
    planId: string;
    status: string;
    environment: string;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    willRenew: boolean;
    trialUsed: boolean;
    createdAt: string;
    updatedAt: string;
    /** Store references other than Stripe ids are never returned (Google purchase tokens are credentials). */
    hasStoreReference: boolean;
  } | null;
  stripe: { customerId: string | null; subscriptionId: string | null; customerUrl: string | null; subscriptionUrl: string | null } | null;
  planHistory: AdminEvent[];
  usageByMonth: { month: string; kind: string; total: number }[];
  aiByFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedUsd: number }[];
  aiUsage: AdminCustomerAIDetail;
  payments: AdminCustomerPayments;
  recentEvents: AdminEvent[];
};

export type AdminAIReport = {
  range: AdminRangeInfo;
  totals: AdminAICostTotals;
  prices: { version: string; models: Record<string, { inputPerMTok: number; outputPerMTok: number }>; transcriptionUsdPerMinute: number };
  byFeature: { feature: string; calls: number; failedCalls: number; inputTokens: number; outputTokens: number; estimatedUsd: number; p50LatencyMs: number | null; p95LatencyMs: number | null }[];
  byModel: { provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; estimatedUsd: number; unpricedCalls: number }[];
  series: { bucket: string; calls: number; estimatedUsd: number }[];
  topUsers: { userId: string | null; email: string | null; calls: number; estimatedUsd: number }[];
  perActiveUserUsd: number | null;
  perPayingSubscriberUsd: number | null;
  activeUsers: number;
  payingSubscribers: number;
  anomalies: { userId: string; email: string | null; last7dUsd: number; previousWeeklyAvgUsd: number }[];
};

export type AdminBillingReport = {
  range: AdminRangeInfo;
  database: {
    source: 'database';
    byStatus: Record<string, number>;
    byPlan: { planId: string; count: number }[];
    trialsEndingNext7d: number;
    cancellingAtPeriodEnd: number;
    note: string;
    subscriptions: {
      userId: string;
      email: string;
      provider: string;
      planId: string;
      status: string;
      environment: string;
      trialEndsAt: string | null;
      currentPeriodEndsAt: string | null;
      willRenew: boolean;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripeUrl: string | null;
      updatedAt: string;
    }[];
  };
  stripe: StripeSummary;
  charges: { id: string; created: string; amountCents: number; refundedCents: number; currency: string; status: string; failureCode: string | null; customerId: string | null; url: string }[] | Unavailable;
};

export type AdminFunnelStep = { key: string; label: string; users: number | null; source: AdminSource; note?: string };
export type AdminAnalyticsReport = {
  range: AdminRangeInfo;
  /** Cohort: accounts that signed up in the range, and how many of them reached each step (at any time). */
  funnel: AdminFunnelStep[];
  series: Record<string, Point[]>;
  /** Events the funnel needs that are not recorded (or only from a recent date). */
  missing: { event: string; note: string; firstSeen: string | null }[];
};

export type AdminHealth = {
  api: { ok: true; uptimeSeconds: number; node: string };
  database: { ok: boolean; migrationsApplied: number | null; migrationsExpected: number | null; latestExpected: string | null; upToDate: boolean | null };
  jobs: { documentsProcessing: number; documentsStuck: number; documentsFailed7d: number; materialsProcessing: number; materialsFailed7d: number };
  ai: { calls24h: number; failed24h: number; errorRate24h: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null; errorCodes: Record<string, number> };
  stripeWebhooks: { received7d: number; unprocessed: number; lastReceivedAt: string | null; byType: Record<string, number> };
  email: { reminders7d: Record<string, number>; otherEmails: Unavailable };
  features: Record<string, 'enabled' | 'disabled'>;
};
