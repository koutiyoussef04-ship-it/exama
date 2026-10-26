/**
 * Product facts of the "for organizations" (B2B) pages. The words are in src/i18n/b2b/<lang>.ts.
 *
 * Source of truth is the Exama application code, NOT this file:
 *   - plans, allowances and prices ........... packages/shared/src/organizations.ts (ORGANIZATION_PLAN_CATALOG)
 *   - what the allowances count .............. apps/api/src/billing/org-limits.ts
 *       paid plans: per calendar month; "members" = admins and editors — reviewers are not counted
 *   - pilots ................................. ORGANIZATION_PILOT_DAYS (packages/shared): a pilot is granted by Exama by
 *       hand (B2B owner tools), never started from the site. The French page offers the free 2-week pilot openly
 *       (opened in the organization's name, activated by Exama, no commitment, no card); the other languages only say
 *       a pilot can be discussed. A new organization has no plan until Exama activates one. No pilot plan card anywhere.
 *   - formats and exports .................... apps/api/src/routes/orgs.ts (PDF for trainees and trainers, Excel),
 *       packages/shared/src/bank.ts (CSV, Moodle GIFT)
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

/**
 * The publicly presented plans, in display order (the paid plans; Centro is custom-priced). Ids are internal: the
 * names shown come from src/i18n/b2b/<lang>.ts and follow the page's language (en Starter · Essential · Professional ·
 * Institution, fr Indépendant · Essentiel · Professionnel · Établissement, …), the same names as the app
 * (apps/mobile/src/i18n/locales/<lang>.ts, org.plan.name). check-pricing.mjs fails when the two drift.
 */
export const ORG_PLAN_ORDER = ['starter', 'esencial', 'profesional', 'centro'] as const;
/** The plan highlighted as "most chosen" (ORGANIZATION_RECOMMENDED_PLAN in the app). */
export const ORG_RECOMMENDED_PLAN: OrgPlanId = 'esencial';
/** Length of the pilot granted to an organization, in days (ORGANIZATION_PILOT_DAYS in the app). */
export const ORG_PILOT_DAYS = 14;
export type OrgPlanId = (typeof ORG_PLAN_ORDER)[number];
export type OrgLimits = { coursesPerMonth: number; itemsPerMonth: number; maxMembers: number };

// Keep the `key: { coursesPerMonth, itemsPerMonth, maxMembers }` shape — scripts/check-pricing.mjs parses it.
// Starter/Esencial/Profesional are per calendar month. Centro is custom (set by hand).
export const ORG_LIMITS: Record<Exclude<OrgPlanId, 'centro'>, OrgLimits> = {
  starter: { coursesPerMonth: 3, itemsPerMonth: 150, maxMembers: 2 },
  esencial: { coursesPerMonth: 10, itemsPerMonth: 500, maxMembers: 10 },
  profesional: { coursesPerMonth: 100, itemsPerMonth: 2000, maxMembers: 25 },
};

// Keep the `key: { monthlyCents, yearlyCents }` shape — scripts/check-pricing.mjs parses it. Excluding VAT.
export const ORG_PRICES = {
  starter: { monthlyCents: 5900, yearlyCents: 59000 },
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
export const ORG_SECTIONS = { how: 'how-it-works', qualiopi: 'qualiopi', review: 'review', exports: 'exports', pricing: 'pricing', start: 'get-started', faq: 'faq' } as const;

/** Whole numbers the local way (1,000 / 1.000). */
export const formatCount = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : lang === 'en' ? 'en-IE' : lang === 'es' ? 'es-ES' : 'fr-FR', { useGrouping: 'always' }).format(n);
