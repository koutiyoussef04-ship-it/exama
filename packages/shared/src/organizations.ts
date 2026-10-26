/**
 * Organizations (the B2B side of Exama): a university, a school, a training center, a company's learning
 * team or an exam-preparation center whose staff upload material, generate draft questions, review them and
 * keep the approved ones in a question bank.
 *
 * - An account is either a `student` (the existing app) or an `organization` user, chosen at sign-up and
 *   stored on the user; the server decides which experience applies, never the client.
 * - Authorization inside an organization comes from `organization_members` (role), checked on every
 *   request. Account type alone grants nothing.
 */
import { z } from 'zod';

export const ACCOUNT_TYPES = ['student', 'organization'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** B2B staff roles, held only by organization accounts and granted only by the server-side provisioning command. */
export const B2B_ROLES = ['owner'] as const;
export type B2BRole = (typeof B2B_ROLES)[number];

/**
 * The kind of organization, chosen at sign-up (or when creating a further organization) and stored in
 * `organizations.market`. These are the categories OFFERED today, for French-speaking markets and the Gulf.
 * Workspace behaviour comes from `marketProfile`, never from ad-hoc checks on the value.
 */
export const ORGANIZATION_CATEGORIES = ['university', 'school', 'training_center', 'corporate', 'exam_prep', 'other'] as const;
export type OrganizationCategory = (typeof ORGANIZATION_CATEGORIES)[number];
/**
 * Values stored by organizations created before the categories above existed (the Spanish launch). They stay
 * valid data — read, displayed and still driving their workspace defaults — but are no longer offered to anyone.
 */
export const LEGACY_ORGANIZATION_MARKETS = ['training_provider', 'academy'] as const;
/** Every value `organizations.market` may hold (the database CHECK constraint lists exactly these). */
export const ORGANIZATION_MARKETS = [...ORGANIZATION_CATEGORIES, ...LEGACY_ORGANIZATION_MARKETS] as const;
export type OrganizationMarket = (typeof ORGANIZATION_MARKETS)[number];
export const isOrganizationMarket = (v: unknown): v is OrganizationMarket => typeof v === 'string' && (ORGANIZATION_MARKETS as readonly string[]).includes(v);

/** admin: everything incl. members · editor: upload, generate, review, export · reviewer: read + review only. */
export const ORGANIZATION_ROLES = ['admin', 'editor', 'reviewer'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export const ROLE_RANK: Record<OrganizationRole, number> = { reviewer: 1, editor: 2, admin: 3 };
export const roleAtLeast = (role: OrganizationRole, min: OrganizationRole) => ROLE_RANK[role] >= ROLE_RANK[min];

export const organizationNameSchema = z.string().trim().min(2).max(120);

/** Sign-up fields for an organization account (with the usual name/email/password/age). */
export const organizationSignupSchema = z.object({
  accountType: z.literal('organization'),
  organizationName: organizationNameSchema,
  market: z.enum(ORGANIZATION_CATEGORIES),
});

export const createOrganizationSchema = z.object({ name: organizationNameSchema, market: z.enum(ORGANIZATION_CATEGORIES) });
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({ name: organizationNameSchema.optional() });
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const addMemberSchema = z.object({ email: z.email(), role: z.enum(ORGANIZATION_ROLES) });
export type AddMemberInput = z.input<typeof addMemberSchema>;
export const updateMemberSchema = z.object({ role: z.enum(ORGANIZATION_ROLES) });
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

/** What `GET /auth/me` says about the organizations an account belongs to. */
export type OrganizationMembershipSummary = { id: string; name: string; market: OrganizationMarket; role: OrganizationRole };

export type OrganizationMember = { userId: string; email: string; name: string; role: OrganizationRole; joinedAt: string };

/**
 * Per-organization allowances: the plan's defaults (ORGANIZATION_PLAN_CATALOG) with any owner overrides on top.
 * "PerMonth" counts are per calendar month on paid plans and for the WHOLE pilot on a (manually granted) pilot.
 */
export type OrganizationLimits = {
  /** Courses (uploads) per calendar month (pilot: in total). */
  coursesPerMonth: number;
  /** AI-generated draft questions per calendar month (pilot: in total). */
  itemsPerMonth: number;
  /** Draft questions per generation request. */
  maxItemsPerRequest: number;
  /** Members of every role (admins, editors and reviewers). */
  maxMembers: number;
};

export type OrganizationUsage = {
  coursesThisMonth: number;
  itemsThisMonth: number;
  /** Estimated AI cost this month, in micro-USD, from `ai_usage` (null when unknown). */
  aiCostMicroUsdThisMonth: number | null;
  /** What the course/draft counts cover: the calendar month, or the whole pilot. */
  period: 'month' | 'pilot';
};

// ---- Plans (B2B). Billing is manual for now (invoice / bank transfer): nothing here charges anyone. The owner assigns
// the plan from the owner tools after the customer has agreed to it.
//
// A new organization starts with NO plan (`none`): it can sign in, see its workspace and add reviewers, but cannot
// upload courses or draft questions until the owner assigns a paid plan or grants a pilot. A pilot is never public or
// automatic: it is an individually negotiated arrangement that only the B2B owner grants, with its own length and,
// optionally, its own allowances.

/** Plans the owner can assign. `none` = no active plan (the default for every new organization). */
export const ORGANIZATION_PLANS = ['none', 'pilot', 'starter', 'esencial', 'profesional', 'centro'] as const;
export type OrganizationPlan = (typeof ORGANIZATION_PLANS)[number];
/**
 * The paid plans, as presented publicly (website pricing, future Stripe products), in display order. The ids are
 * internal and never shown: every surface shows the plan's name in the user's language (website src/i18n/b2b, app
 * `org.plan.name.<id>`): en Starter · Essential · Professional · Institution, fr Indépendant · Essentiel ·
 * Professionnel · Établissement, es Inicial · Esencial · Profesional · Centro. Centro is custom-priced.
 */
export const ORGANIZATION_PAID_PLANS = ['starter', 'esencial', 'profesional', 'centro'] as const;
export type OrganizationPaidPlan = (typeof ORGANIZATION_PAID_PLANS)[number];
/** The plan the pricing recommends ("most chosen"); the one a Starter organization is pointed to at its limit. */
export const ORGANIZATION_RECOMMENDED_PLAN: OrganizationPaidPlan = 'esencial';
export const ORGANIZATION_BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type OrganizationBillingPeriod = (typeof ORGANIZATION_BILLING_PERIODS)[number];
/** Default length of a manually granted pilot (the owner can choose another length or end date): the 2-week pilot offered to organizations. */
export const ORGANIZATION_PILOT_DAYS = 14;
/** Longest pilot the owner can grant in one step (an extension can follow). */
export const ORGANIZATION_PILOT_MAX_DAYS = 365;

export type OrganizationPlanInfo = {
  limits: OrganizationLimits;
  /** List prices in euro cents, VAT excluded; null = no price: no plan, a pilot (free, granted by hand) or Centro (custom). */
  prices: { monthly: number; yearly: number } | null;
};

export const ORGANIZATION_PLAN_CATALOG: Record<OrganizationPlan, OrganizationPlanInfo> = {
  // No active plan: nothing that costs anything (no uploads, no AI drafts); the creating admin only.
  none: { limits: { coursesPerMonth: 0, itemsPerMonth: 0, maxItemsPerRequest: 20, maxMembers: 1 }, prices: null },
  // Default allowances of a manually granted pilot (totals for the whole pilot); the owner can set others per organization.
  pilot: { limits: { coursesPerMonth: 5, itemsPerMonth: 150, maxItemsPerRequest: 20, maxMembers: 3 }, prices: null },
  // Independent trainers and small organizations: an entry test and an end-of-training test for several sessions a month.
  starter: { limits: { coursesPerMonth: 3, itemsPerMonth: 150, maxItemsPerRequest: 20, maxMembers: 2 }, prices: { monthly: 5_900, yearly: 59_000 } },
  esencial: { limits: { coursesPerMonth: 10, itemsPerMonth: 500, maxItemsPerRequest: 20, maxMembers: 10 }, prices: { monthly: 14_900, yearly: 149_000 } },
  profesional: { limits: { coursesPerMonth: 100, itemsPerMonth: 2_000, maxItemsPerRequest: 20, maxMembers: 25 }, prices: { monthly: 34_900, yearly: 349_000 } },
  // Custom terms: starts from Profesional's allowances; the owner sets the agreed ones per organization.
  centro: { limits: { coursesPerMonth: 100, itemsPerMonth: 2_000, maxItemsPerRequest: 20, maxMembers: 25 }, prices: null },
};

/** Plan and pilot state of an organization (read-only for its members; only the B2B owner changes it). */
export type OrganizationPlanState = {
  plan: OrganizationPlan;
  billingPeriod: OrganizationBillingPeriod | null;
  /** Pilot only: when it started (ISO) — the moment the owner granted it. */
  pilotStartedAt: string | null;
  /** Pilot only: when it ends (ISO). */
  pilotEndsAt: string | null;
  /** The pilot has ended: no new courses or AI drafts; everything already there can still be read, reviewed and exported. */
  pilotExpired: boolean;
};

export type Organization = OrganizationPlanState & {
  id: string;
  name: string;
  market: OrganizationMarket;
  status: 'active' | 'suspended';
  role: OrganizationRole;
  limits: OrganizationLimits;
  createdAt: string;
};

export type OrganizationOverview = Organization & {
  counts: { courses: number; drafts: number; approved: number; rejected: number; members: number };
  usage: OrganizationUsage;
};

/**
 * Market-specific behaviour, as data. Services read these fields; only this table maps a market to values.
 * (A test fails if `market ===` appears elsewhere in the API.)
 */
export type MarketProfile = {
  /** Word for the unit staff organize questions by ("module" everywhere; "tema" for the legacy Spanish academies). */
  unitLabel: 'module' | 'tema';
  /** Show the law / official publication / article / effective-date fields on questions (legacy academies only). */
  legalMetadata: boolean;
  /** Generate multiple-choice questions only (legacy academies: their tests are MCQ). */
  mcqOnly: boolean;
  /** Number of options the generator is asked for. */
  optionCount: 4;
};

/** The general workspace defaults: mixed question types, no legal-reference fields. Every offered category uses them. */
const GENERAL_PROFILE: MarketProfile = { unitLabel: 'module', legalMetadata: false, mcqOnly: false, optionCount: 4 };
export const MARKET_PROFILES: Record<OrganizationMarket, MarketProfile> = {
  university: GENERAL_PROFILE,
  school: GENERAL_PROFILE,
  training_center: GENERAL_PROFILE,
  corporate: GENERAL_PROFILE,
  exam_prep: GENERAL_PROFILE,
  other: GENERAL_PROFILE,
  // Legacy values (existing organizations): unchanged behaviour.
  training_provider: GENERAL_PROFILE,
  academy: { unitLabel: 'tema', legalMetadata: true, mcqOnly: true, optionCount: 4 },
};
export const marketProfile = (market: OrganizationMarket): MarketProfile => MARKET_PROFILES[market];

// ---- Owner tooling (admin dashboard): organizations are billed by hand; the owner sets limits and status.

export const adminUpdateOrganizationSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  /**
   * Assign a plan (after the customer agreed to it; billing is manual), grant a pilot (`pilot`, starts now) or remove
   * the plan (`none`). The dates of the last pilot are kept as a record when the organization leaves it.
   */
  plan: z.enum(ORGANIZATION_PLANS).optional(),
  billingPeriod: z.enum(ORGANIZATION_BILLING_PERIODS).nullable().optional(),
  /**
   * Pilot only: its end date (ISO). With `plan: 'pilot'` (granting) it must be in the future, at most
   * ORGANIZATION_PILOT_MAX_DAYS away; on a running pilot it extends it, or ends it now (a date not in the future).
   */
  pilotEndsAt: z.iso.datetime({ offset: true }).optional(),
  limits: z
    .object({
      coursesPerMonth: z.number().int().min(0).max(100_000).optional(),
      itemsPerMonth: z.number().int().min(0).max(1_000_000).optional(),
      maxItemsPerRequest: z.number().int().min(1).max(100).optional(),
      maxMembers: z.number().int().min(1).max(10_000).optional(),
    })
    .optional(),
});
export type AdminUpdateOrganizationInput = z.input<typeof adminUpdateOrganizationSchema>;

export type AdminOrganization = OrganizationPlanState & {
  id: string;
  name: string;
  market: OrganizationMarket;
  status: 'active' | 'suspended';
  limits: OrganizationLimits;
  createdAt: string;
  creatorEmail: string | null;
  counts: { members: number; courses: number; approved: number; drafts: number };
  usage: OrganizationUsage;
};
