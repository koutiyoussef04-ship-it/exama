/**
 * Subscription plans, entitlements and billing API contract.
 *
 * Access is always decided by the API. The app only displays what the API returns.
 *
 * Commercial structure (three paid tiers, each monthly or yearly):
 *   Free     €0
 *   Basic    €9.99/month  · €79.99/year   PDFs + PowerPoints, exams, practice, basic planner (no lectures)
 *   Student  €14.99/month · €119.99/year  + audio/video lectures, adaptive planner/practice, weak-topic analysis
 *   Pro      €24.99/month · €199.99/year  everything in Student with much higher allowances
 * plus the 7-day trial (full experience, restricted trial caps) and the owner account (unlimited).
 *
 * Stores: Apple App Store (iOS) and Google Play (Android) sell the same six plans; the web sells them
 * through Stripe Checkout (docs/stripe/stripe-web-billing.md). A subscription bought in any of them unlocks
 * the account everywhere (iOS, Android and web). Prices here are list prices for reference/analytics; the
 * apps show the localized price the store returns.
 */
import { z } from 'zod';

/**
 * Access tiers. `trial` is its own tier with its own (small) limits but the full feature set:
 * a trial never gets paid allowances. `basic`, `student` and `pro` are sold as plans.
 */
export const TIERS = ['free', 'trial', 'basic', 'student', 'pro'] as const;
export type Tier = (typeof TIERS)[number];
export const PAID_TIERS = ['basic', 'student', 'pro'] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export type BillingPeriod = 'monthly' | 'yearly';

export const PLAN_IDS = ['basic_monthly', 'basic_yearly', 'student_monthly', 'student_yearly', 'pro_monthly', 'pro_yearly'] as const;
export const planIdSchema = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof planIdSchema>;

export type Plan = {
  id: PlanId;
  tier: PaidTier;
  period: BillingPeriod;
  /** List price in minor units (cents) to avoid float rounding. */
  priceCents: number;
  currency: 'EUR';
  /** App Store Connect product id (one subscription group for all six). */
  appleProductId: string;
  /** Google Play subscription product id (one per tier) … */
  googleProductId: string;
  /** … and the base plan inside it (one per billing period). */
  googleBasePlanId: string;
};

/** Google Play offer id of the 7-day free trial (configured on each base plan in Play Console). */
export const GOOGLE_TRIAL_OFFER_ID = 'free-trial';

export const TRIAL_DAYS = 7;

/** Google Play: one subscription product per tier, base plans `monthly` and `annual` inside it. */
const plan = (tier: PaidTier, period: BillingPeriod, priceCents: number): Plan => ({
  id: `${tier}_${period}` as PlanId,
  tier,
  period,
  priceCents,
  currency: 'EUR',
  appleProductId: `com.exama.app.${tier}.${period === 'yearly' ? 'annual' : 'monthly'}`,
  googleProductId: `exama_${tier}`,
  googleBasePlanId: period === 'yearly' ? 'annual' : 'monthly',
});

export const PLANS: readonly Plan[] = [
  plan('basic', 'monthly', 999),
  plan('basic', 'yearly', 7999),
  plan('student', 'monthly', 1499),
  plan('student', 'yearly', 11999),
  plan('pro', 'monthly', 2499),
  plan('pro', 'yearly', 19999),
];

/** The plan the paywall recommends (pre-selected, highlighted). */
export const RECOMMENDED_PLAN_ID: PlanId = 'student_monthly';

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;
export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
/**
 * A stored plan id → current plan id. Ids from before the three-tier catalog ("student_annual",
 * "pro_annual") are renamed by migration 0007; this also accepts them in case an old row slips
 * through. Anything else → null (no paid access).
 */
export function normalizePlanId(v: unknown): PlanId | null {
  if (isPlanId(v)) return v;
  if (typeof v === 'string' && v.endsWith('_annual')) {
    const renamed = v.replace(/_annual$/, '_yearly');
    return isPlanId(renamed) ? renamed : null;
  }
  return null;
}

/** Tier order, for upgrade/downgrade decisions (higher = more access). */
export const TIER_RANK: Record<Tier, number> = { free: 0, trial: 1, basic: 2, student: 3, pro: 4 };

/**
 * What a tier can do, beyond its usage limits. Decided on the server (GET /billing/status returns
 * the user's features); the apps only use them to show or lock parts of the UI.
 *   lectures           audio/video lecture uploads (transcription)
 *   adaptivePractice   practice sets target the student's weak topics (else: spread over all topics)
 *   weakTopicAnalysis  per-topic mastery and weak-topic breakdown
 *   adaptivePlanner    the study plan prioritises weak/important topics and re-plans after results
 */
export type Features = {
  lectures: boolean;
  adaptivePractice: boolean;
  weakTopicAnalysis: boolean;
  adaptivePlanner: boolean;
};
export const FEATURE_KEYS = ['lectures', 'adaptivePractice', 'weakTopicAnalysis', 'adaptivePlanner'] as const satisfies readonly (keyof Features)[];

/**
 * The access state the entitlement resolver computes on the server: free, the trial, one of the six
 * paid plans, an ended subscription/trial, or the owner account.
 */
export const ACCESS_PLANS = ['free', 'trial', ...PLAN_IDS, 'expired', 'owner'] as const;
export type AccessPlan = (typeof ACCESS_PLANS)[number];
/**
 * What API responses carry. The owner bypass is never revealed to clients: an owner account is
 * reported as `complimentary` (full access granted by the server), like `status`.
 */
export type PublicAccessPlan = Exclude<AccessPlan, 'owner'> | 'complimentary';

/**
 * Usage allowance for a tier. `null` = unlimited. Monthly counters reset on the 1st (UTC).
 * For the `trial` tier the "per month" counters cover the WHOLE trial instead (they never reset).
 */
export type Limits = {
  /** Courses (uploaded PDFs) a user can have at the same time. */
  courses: number | null;
  /** PDFs processed per month (each upload costs an AI analysis, so deleting and re-uploading counts). */
  courseUploadsPerMonth: number | null;
  /** Full exams generated per month. */
  examGenerationsPerMonth: number | null;
  /** Questions generated in practice sets per month (weak-topic targeted on Student/Pro/trial). */
  practiceQuestionsPerMonth: number | null;
  /** Largest exam a user can request. */
  maxQuestionsPerExam: number;
  /** AI study-plan generations per month (creating or rebuilding a plan; viewing/adapting is free). */
  studyPlansPerMonth: number | null;
  /**
   * Lecture recordings (audio/video) added per month — each one is transcribed and analysed.
   * Free: per ACCOUNT, not per month (one free lecture, ever); trial: for the whole trial.
   */
  mediaUploadsPerMonth: number | null;
  /** Minutes of lecture audio/video transcribed per month (rounded up per file). Free: per account; trial: whole trial. */
  mediaMinutesPerMonth: number | null;
  /** Longest lecture accepted, in minutes. */
  maxMediaMinutesPerFile: number;
};

export type Usage = {
  courses: number;
  courseUploadsThisMonth: number;
  examGenerationsThisMonth: number;
  practiceQuestionsThisMonth: number;
  studyPlansThisMonth: number;
  mediaUploadsThisMonth: number;
  mediaMinutesThisMonth: number;
};

export type LectureAllowance = 'none' | 'once' | 'trial' | 'monthly' | 'unlimited';

export type EntitlementStatus =
  | 'free' // never subscribed (or reset)
  | 'trialing'
  | 'active'
  | 'cancelled' // will not renew; access until expiresAt
  | 'expired' // subscription/trial ended; free limits apply
  | 'complimentary'; // premium granted by the server (no billing)

export type BillingProviderId = 'mock' | 'apple' | 'google' | 'stripe';
export const STORE_IDS = ['mock', 'apple', 'google', 'stripe'] as const;

/** Where the app runs. Decides which store sells subscriptions there (see GET /billing/plans?platform=). */
export const BILLING_PLATFORMS = ['ios', 'android', 'web'] as const;
export type BillingPlatform = (typeof BILLING_PLATFORMS)[number];

export type Entitlement = {
  /** Resolved access state: free | trial | basic_monthly … pro_yearly | expired | complimentary. */
  accessPlan: PublicAccessPlan;
  tier: Tier;
  /** Features unlocked right now (server-decided). */
  features: Features;
  /** Where the current subscription comes from (null: free/owner). "apple" → manage it in the App Store. */
  provider: BillingProviderId | null;
  status: EntitlementStatus;
  isPremium: boolean;
  planId: PlanId | null;
  trialEndsAt: string | null;
  /** When access ends (cancelled) or renews (active). Null if not applicable. */
  currentPeriodEndsAt: string | null;
  willRenew: boolean;
  trialEligible: boolean;
  limits: Limits;
  usage: Usage;
  /** What the usage counters cover: the calendar month, or the whole free trial. */
  usagePeriod: 'month' | 'trial';
  /**
   * How the lecture (audio/video) allowance works for this user:
   *   none       no lectures on this plan (Basic)
   *   once       Free: one lecture per account, ever (media usage counts the account's whole history)
   *   trial      the trial's lecture allowance, for the whole trial
   *   monthly    Student/Pro: resets on the 1st of each month
   *   unlimited  no monthly caps (owner)
   */
  lectureAllowance: LectureAllowance;
  /** Start of next month (UTC) when monthly counters reset; for a trial, when the trial ends. */
  usageResetsAt: string;
  /** The free trial has ended without being converted to a paid plan (drives the "trial ended" upsell). */
  trialEnded: boolean;
};

export type BillingCatalog = {
  plans: Plan[];
  trialDays: number;
  /** True when the server can take (test) purchases. False until a billing provider is configured. */
  purchasesAvailable: boolean;
  /** True when purchases go to the development mock provider: no real payment happens. */
  testMode: boolean;
  /**
   * Which purchase flow the app must use on the requesting platform (null = no purchases there —
   * e.g. on the web, where a subscription bought in the iOS/Android app still applies).
   */
  provider: BillingProviderId | null;
  limits: Record<Tier, Limits>;
  /** Features of each tier (for the paywall comparison). */
  features: Record<Tier, Features>;
  /** Pre-selected plan on the paywall. */
  recommendedPlanId: PlanId;
};

/** 402 body returned when an action exceeds the user's plan. */
export type LimitErrorBody = {
  /** English fallback text; apps build a translated message from the fields below. */
  error: string;
  code: 'limit_reached' | 'premium_required';
  feature:
    | 'lectures' // the plan has no audio/video lectures (Basic)
    | 'courses'
    | 'course_uploads'
    | 'exam_generations'
    | 'practice_questions'
    | 'exam_length'
    | 'study_plans'
    | 'media_uploads'
    | 'media_minutes'
    | 'media_length';
  limit: number;
  used: number;
  tier: Tier;
  /** What the refused request needed, when relevant (e.g. the lecture's length in minutes). */
  requested?: number;
};

// ---------- Purchases (POST /billing/purchase, /billing/restore) ----------
// Bodies carry `store` so one account can buy on iOS and restore on Android, and vice versa.
// Without `store`, the shape decides (older app builds): signedTransaction → apple, purchaseToken → google, planId → mock.

// ---------- Google Play Billing ----------

/** What the app sends after a Play Billing purchase. The server verifies it with the Play Developer API. */
export const googlePurchaseSchema = z.object({
  purchaseToken: z.string().min(10).max(4096),
  productId: z.string().min(1).max(200),
});
export const googleRestoreSchema = z.object({ purchases: z.array(googlePurchaseSchema).max(20) });

// ---------- Apple (StoreKit 2) ----------

/**
 * What the app sends after a StoreKit purchase/restore. The server verifies the JWS with Apple's
 * certificates; nothing in it is trusted before verification.
 */
export const applePurchaseSchema = z.object({ signedTransaction: z.string().min(20).max(20_000) });
export const appleRestoreSchema = z.object({ signedTransactions: z.array(z.string().min(20).max(20_000)).max(50) });

// ---------- Stripe (web subscriptions) ----------
// Web has no in-app purchase: the server creates a Stripe Checkout Session and the browser is redirected
// to it. The request names a plan and an interval only — the server picks the Stripe Price, decides
// whether the account still gets the free trial, and grants access only after Stripe's webhook arrives.

export const BILLING_PERIODS = ['monthly', 'yearly'] as const satisfies readonly BillingPeriod[];

/** POST /billing/stripe/checkout body. No prices, no price ids, no entitlements: those are server-side. */
export type StripeCheckoutInput = { plan: PaidTier; interval: BillingPeriod };

/** A Stripe-hosted page to send the browser to (Checkout or the Customer Portal). */
export type BillingRedirect = { url: string };

// ---------- Mock (development) billing ----------

export const mockPurchaseSchema = z.object({ planId: planIdSchema });
export type MockPurchaseInput = z.infer<typeof mockPurchaseSchema>;

export const MOCK_STATES = ['free', 'trial', ...PLAN_IDS, 'expired'] as const;
export const mockSetStateSchema = z.object({ state: z.enum(MOCK_STATES) });
export type MockState = (typeof MOCK_STATES)[number];
