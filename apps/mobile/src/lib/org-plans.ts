/**
 * The plans an ORGANIZATION account sees on its Account screen (never the student plans): Starter, Esencial, Profesional
 * and Centro (ids; the names come from i18n, `org.plan.name.<id>`), with the list prices and allowances of
 * ORGANIZATION_PLAN_CATALOG — the same source as the website pricing
 * and the owner dashboard. There is no checkout: a plan is requested by email and the B2B owner activates it
 * (b2b-admin). Pure helpers, unit-tested (test/org-account-plans.test.ts).
 */
import {
  ORGANIZATION_PAID_PLANS,
  ORGANIZATION_PLAN_CATALOG,
  type OrganizationBillingPeriod,
  type OrganizationPaidPlan,
  type OrganizationPlanState,
} from '@study/shared';
import { SUPPORT_EMAIL } from './support';

/** The plans offered to organizations, in display order. */
export const ORG_PLAN_CHOICES: readonly OrganizationPaidPlan[] = ORGANIZATION_PAID_PLANS;

/** List price in euro cents (VAT excluded), or null for Centro (custom). */
export const orgPlanPrice = (plan: OrganizationPaidPlan, period: OrganizationBillingPeriod): number | null =>
  ORGANIZATION_PLAN_CATALOG[plan].prices?.[period] ?? null;

/** Yearly saving vs 12 monthly payments, in whole percent (same formula as the website); null without a price. */
export const orgYearlySavingPct = (plan: OrganizationPaidPlan): number | null => {
  const p = ORGANIZATION_PLAN_CATALOG[plan].prices;
  if (!p) return null;
  return Math.round(((p.monthly * 12 - p.yearly) / (p.monthly * 12)) * 100);
};

/** The best yearly saving across the priced plans (for the "Yearly · save up to …" tab). */
export const orgMaxYearlySavingPct = (): number =>
  Math.max(...ORG_PLAN_CHOICES.map((p) => orgYearlySavingPct(p) ?? 0));

/** Is `plan` the organization's current plan? (A pilot or "no plan" is never one of the offered plans.) */
export const isCurrentOrgPlan = (state: Pick<OrganizationPlanState, 'plan'> | null | undefined, plan: OrganizationPaidPlan) =>
  state?.plan === plan;

/**
 * A plan request: a mailto: link to Exama with the subject and body filled in (the same address and format as the
 * website's demo requests). Nothing is sent by the app and nothing is charged; the address is also shown on screen.
 */
export function orgPlanRequestMailto(subject: string, body: string, email: string = SUPPORT_EMAIL): string {
  return `mailto:${email}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`;
}
