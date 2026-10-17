/**
 * Product facts shared by every language of the site. The words themselves are in src/i18n/<lang>.ts.
 *
 * Source of truth for every product claim is the Exama application code, NOT this file:
 *   - prices, trial length, plan tiers ....... packages/shared/src/billing.ts
 *   - plan features and usage allowances ..... apps/api/src/billing/features.ts, limits.ts
 *   - supported formats ...................... packages/shared/src/materials.ts
 *   - how questions are grounded ............. apps/api/src/lib/grounding.ts
 *   - study planner .......................... README.md ("Study planner")
 * `npm run check:pricing` compares the prices below with billing.ts. If the app changes, update here.
 *
 * Rules for the copy: no testimonials, no user counts, no ratings, no partner/university names,
 * no statistics. Only what the product demonstrably does.
 */
import type { Lang } from '../i18n/languages';

// ---------- Pricing (keep the `key: { monthlyCents, yearlyCents }` shape — scripts/check-pricing.mjs parses it) ----------

export const TRIAL_DAYS = 7;

export const PRICES = {
  basic: { monthlyCents: 999, yearlyCents: 7999 },
  student: { monthlyCents: 1499, yearlyCents: 11999 },
  pro: { monthlyCents: 2499, yearlyCents: 19999 },
} as const;
export type PaidTier = keyof typeof PRICES;

/** Euro amounts as each language writes them: €9.99 (en), 9,99 € (es, fr), 9.99 € (ar, Western digits). */
const PRICE_LOCALE: Record<Lang, string> = { en: 'en-IE', es: 'es-ES', fr: 'fr-FR', ar: 'ar-u-nu-latn' };
export const formatEuros = (cents: number, lang: Lang = 'en') =>
  new Intl.NumberFormat(PRICE_LOCALE[lang], { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 })
    .format(cents / 100)
    .replace(/‏|؜/g, '');
/** Yearly saving vs 12 monthly payments, in whole percent — derived from PRICES, never typed by hand. */
export const yearlySavingPct = (tier: PaidTier) => {
  const { monthlyCents, yearlyCents } = PRICES[tier];
  return Math.round(((monthlyCents * 12 - yearlyCents) / (monthlyCents * 12)) * 100);
};

export const PLAN_ORDER = ['free', 'basic', 'student', 'pro'] as const;
export type PlanId = (typeof PLAN_ORDER)[number];
export const RECOMMENDED_PLAN: PlanId = 'student';

/** Section ids (anchors) — the same in every language. */
export const SECTIONS = { how: 'how-it-works', materials: 'materials', pricing: 'pricing', faq: 'faq' } as const;
