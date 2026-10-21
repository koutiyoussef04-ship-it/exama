/**
 * Product facts of the "for organizations" (B2B) pages. The words are in src/i18n/b2b/<lang>.ts.
 *
 * Source of truth is the Exama application code, NOT this file:
 *   - plans, allowances and prices ........... packages/shared/src/organizations.ts (ORGANIZATION_PLAN_CATALOG)
 *   - what the allowances count .............. apps/api/src/billing/org-limits.ts
 *       pilot: totals for the whole pilot (30 days from sign-up); paid plans: per calendar month;
 *       "members" = admins and editors — reviewers are not counted;
 *       after the pilot ends: no new courses or drafts, everything stays readable, reviewable and exportable
 *   - formats and exports .................... apps/api/src/routes/orgs.ts (PDF, PPTX), packages/shared/src/bank.ts (csv, gift)
 * `npm run check:pricing` compares the numbers below with the app's catalog. If the app changes, update here.
 *
 * Billing for organizations is manual: plans are requested (demo/contact) and assigned by Exama; there is no
 * online checkout and nothing is charged automatically. The copy must never say otherwise.
 *
 * Rules for the copy: no customer names or logos, no testimonials, no counts, no statistics, no time savings,
 * no guarantees. Only what the workspace demonstrably does.
 */
import type { Lang } from '../i18n/languages';

export const ORG_PILOT_DAYS = 30;
/** At most this many drafts per generation request, on every plan. */
export const ORG_MAX_ITEMS_PER_REQUEST = 20;

export const ORG_PLAN_ORDER = ['pilot', 'esencial', 'profesional', 'centro'] as const;
export type OrgPlanId = (typeof ORG_PLAN_ORDER)[number];
export type OrgLimits = { coursesPerMonth: number; itemsPerMonth: number; maxMembers: number };

// Keep the `key: { coursesPerMonth, itemsPerMonth, maxMembers }` shape — scripts/check-pricing.mjs parses it.
// Pilot numbers are totals for the 30 days; Esencial/Profesional are per calendar month. Centro is custom (set by hand).
export const ORG_LIMITS: Record<Exclude<OrgPlanId, 'centro'>, OrgLimits> = {
  pilot: { coursesPerMonth: 5, itemsPerMonth: 150, maxMembers: 3 },
  esencial: { coursesPerMonth: 10, itemsPerMonth: 500, maxMembers: 10 },
  profesional: { coursesPerMonth: 100, itemsPerMonth: 2000, maxMembers: 25 },
};

// Keep the `key: { monthlyCents, yearlyCents }` shape — scripts/check-pricing.mjs parses it. Excluding VAT.
export const ORG_PRICES = {
  esencial: { monthlyCents: 14900, yearlyCents: 149000 },
  profesional: { monthlyCents: 34900, yearlyCents: 349000 },
} as const;
export type OrgPaidPlan = keyof typeof ORG_PRICES;

/** Yearly saving vs 12 monthly payments, in whole percent — derived, never typed by hand. */
export const orgYearlySavingPct = (plan: OrgPaidPlan) => {
  const { monthlyCents, yearlyCents } = ORG_PRICES[plan];
  return Math.round(((monthlyCents * 12 - yearlyCents) / (monthlyCents * 12)) * 100);
};

/** Section ids (anchors) on the organizations page — the same in every language. */
export const ORG_SECTIONS = { how: 'how-it-works', review: 'review', pricing: 'pricing', pilot: 'pilot', faq: 'faq' } as const;

/** Whole numbers the local way (1,000 / 1.000). */
export const formatCount = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : lang === 'en' ? 'en-IE' : lang === 'es' ? 'es-ES' : 'fr-FR', { useGrouping: 'always' }).format(n);
