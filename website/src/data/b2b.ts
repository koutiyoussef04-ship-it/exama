/**
 * Product facts of the "for organizations" (B2B) pages. The words are in src/i18n/b2b/<lang>.ts.
 *
 * Source of truth is the Exama application code, NOT this file:
 *   - plans, allowances and prices ........... packages/shared/src/organizations.ts (ORGANIZATION_PLAN_CATALOG)
 *   - what the allowances count .............. apps/api/src/billing/org-limits.ts
 *       paid plans: per calendar month; "members" = admins and editors — reviewers are not counted
 *   - pilots ................................. NOT a public offer: a pilot is negotiated individually and granted by
 *       Exama by hand (B2B owner tools). The site never shows a pilot plan, price, length or sign-up button; it may
 *       only say that a pilot can be discussed, without promising one. A new organization has no plan until Exama
 *       activates one.
 *   - formats and exports .................... apps/api/src/routes/orgs.ts (PDF, PPTX), packages/shared/src/bank.ts (csv, gift)
 * `npm run check:pricing` compares the numbers below with the app's catalog. If the app changes, update here.
 *
 * Billing for organizations is manual: plans are requested (demo/contact) and assigned by Exama; there is no
 * online checkout and nothing is charged automatically. The copy must never say otherwise (until a Stripe checkout
 * really exists: docs/b2b-stripe-plan.md).
 *
 * Rules for the copy: no customer names or logos, no testimonials, no counts, no statistics, no time savings,
 * no guarantees. Only what the workspace demonstrably does.
 */
import type { Lang } from '../i18n/languages';

/** At most this many drafts per generation request, on every plan. */
export const ORG_MAX_ITEMS_PER_REQUEST = 20;

/** The publicly presented plans, in display order (the paid plans; Centro is custom-priced). */
export const ORG_PLAN_ORDER = ['esencial', 'profesional', 'centro'] as const;
export type OrgPlanId = (typeof ORG_PLAN_ORDER)[number];
export type OrgLimits = { coursesPerMonth: number; itemsPerMonth: number; maxMembers: number };

// Keep the `key: { coursesPerMonth, itemsPerMonth, maxMembers }` shape — scripts/check-pricing.mjs parses it.
// Esencial/Profesional are per calendar month. Centro is custom (set by hand).
export const ORG_LIMITS: Record<Exclude<OrgPlanId, 'centro'>, OrgLimits> = {
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
export const ORG_SECTIONS = { how: 'how-it-works', review: 'review', pricing: 'pricing', start: 'get-started', faq: 'faq' } as const;

/** Whole numbers the local way (1,000 / 1.000). */
export const formatCount = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : lang === 'en' ? 'en-IE' : lang === 'es' ? 'es-ES' : 'fr-FR', { useGrouping: 'always' }).format(n);
