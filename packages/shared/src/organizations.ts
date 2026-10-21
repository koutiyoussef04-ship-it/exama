/**
 * Organizations (the B2B side of Exama): a training provider or an oposiciones academy whose staff
 * upload material, generate draft questions, review them and keep the approved ones in a question bank.
 *
 * - An account is either a `student` (the existing app) or an `organization` user, chosen at sign-up and
 *   stored on the user; the server decides which experience applies, never the client.
 * - Authorization inside an organization comes from `organization_members` (role), checked on every
 *   request. Account type alone grants nothing.
 */
import { z } from 'zod';

export const ACCOUNT_TYPES = ['student', 'organization'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Which market an organization serves. Behaviour differences come from `marketProfile`, never from ad-hoc checks. */
export const ORGANIZATION_MARKETS = ['training_provider', 'academy'] as const;
export type OrganizationMarket = (typeof ORGANIZATION_MARKETS)[number];

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
  market: z.enum(ORGANIZATION_MARKETS),
});

export const createOrganizationSchema = z.object({ name: organizationNameSchema, market: z.enum(ORGANIZATION_MARKETS) });
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
 * "PerMonth" counts are per calendar month on paid plans and for the WHOLE pilot on the pilot plan.
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

// ---- Plans (B2B). Billing is manual (invoice / bank transfer): nothing here charges anyone. The owner assigns
// the plan from the admin tools after the customer has agreed to it; a new organization starts on the pilot.

export const ORGANIZATION_PLANS = ['pilot', 'esencial', 'profesional', 'centro'] as const;
export type OrganizationPlan = (typeof ORGANIZATION_PLANS)[number];
export const ORGANIZATION_BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type OrganizationBillingPeriod = (typeof ORGANIZATION_BILLING_PERIODS)[number];
/** Length of the free pilot, from the organization's creation. */
export const ORGANIZATION_PILOT_DAYS = 30;

export type OrganizationPlanInfo = {
  limits: OrganizationLimits;
  /** List prices in euro cents, VAT excluded; null = free (pilot) or custom (centro). */
  prices: { monthly: number; yearly: number } | null;
};

export const ORGANIZATION_PLAN_CATALOG: Record<OrganizationPlan, OrganizationPlanInfo> = {
  pilot: { limits: { coursesPerMonth: 5, itemsPerMonth: 150, maxItemsPerRequest: 20, maxMembers: 3 }, prices: null },
  esencial: { limits: { coursesPerMonth: 10, itemsPerMonth: 500, maxItemsPerRequest: 20, maxMembers: 10 }, prices: { monthly: 14_900, yearly: 149_000 } },
  profesional: { limits: { coursesPerMonth: 100, itemsPerMonth: 2_000, maxItemsPerRequest: 20, maxMembers: 25 }, prices: { monthly: 34_900, yearly: 349_000 } },
  // Custom terms: starts from Profesional's allowances; the owner sets the agreed ones per organization.
  centro: { limits: { coursesPerMonth: 100, itemsPerMonth: 2_000, maxItemsPerRequest: 20, maxMembers: 25 }, prices: null },
};

/** Plan and pilot state of an organization (read-only for its members; the owner changes it). */
export type OrganizationPlanState = {
  plan: OrganizationPlan;
  billingPeriod: OrganizationBillingPeriod | null;
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
  /** Word for the unit staff organize questions by ("module" for training, "tema" for oposiciones). */
  unitLabel: 'module' | 'tema';
  /** Show the law / official publication / article / effective-date fields on questions. */
  legalMetadata: boolean;
  /** Generate multiple-choice questions only (oposiciones tests are MCQ). */
  mcqOnly: boolean;
  /** Number of options the generator is asked for. */
  optionCount: 4;
};

export const MARKET_PROFILES: Record<OrganizationMarket, MarketProfile> = {
  training_provider: { unitLabel: 'module', legalMetadata: false, mcqOnly: false, optionCount: 4 },
  academy: { unitLabel: 'tema', legalMetadata: true, mcqOnly: true, optionCount: 4 },
};
export const marketProfile = (market: OrganizationMarket): MarketProfile => MARKET_PROFILES[market];

// ---- Owner tooling (admin dashboard): organizations are billed by hand; the owner sets limits and status.

export const adminUpdateOrganizationSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  /** Assign a plan (after the customer agreed to it; billing is manual). Leaving the pilot clears its end date. */
  plan: z.enum(ORGANIZATION_PLANS).optional(),
  billingPeriod: z.enum(ORGANIZATION_BILLING_PERIODS).nullable().optional(),
  /** Pilot only: a new end date (ISO), e.g. to extend a pilot. */
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
