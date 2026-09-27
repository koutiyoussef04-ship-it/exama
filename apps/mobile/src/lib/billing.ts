/**
 * Billing helpers for the app. Access decisions are made by the API (GET /billing/status);
 * nothing here grants access — it only reads and displays server state.
 */
import { PLANS, type BillingCatalog, type BillingProviderId, type Entitlement, type LimitErrorBody, type Limits, type PaywallTrigger, type Plan, type PlanId } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';
import i18n from '@/i18n';
import { formattingLocale, isLanguage } from '@/i18n/languages';
import { api, ApiError } from './api';
import { limitMessage } from './errors';
import { isFreeLectureLimit } from './material-options';
import type { StoreClient } from './store';

export const useEntitlement = () => useQuery({ queryKey: ['entitlement'], queryFn: api.getEntitlement, staleTime: 30_000 });
export const useCatalog = () => useQuery<BillingCatalog>({ queryKey: ['billing-catalog'], queryFn: api.getCatalog, staleTime: 5 * 60_000 });

const TRIGGER_BY_FEATURE: Record<LimitErrorBody['feature'], PaywallTrigger> = {
  lectures: 'locked_lectures',
  courses: 'limit_courses',
  course_uploads: 'limit_course_uploads',
  exam_generations: 'limit_exam_generations',
  practice_questions: 'limit_practice_questions',
  exam_length: 'premium_feature',
  study_plans: 'limit_study_plans',
  media_uploads: 'limit_media_uploads',
  media_minutes: 'limit_media_minutes',
  media_length: 'limit_media_length',
};

export function limitError(err: unknown): LimitErrorBody | null {
  return err instanceof ApiError && err.status === 402 ? (err.body as LimitErrorBody) : null;
}

export function openPaywall(trigger: PaywallTrigger, message?: string) {
  router.push({ pathname: '/paywall', params: { trigger, ...(message ? { message } : {}) } });
}

/** If the error is a plan limit (402), open the paywall with a translated explanation and return true. */
export function handleLimitError(err: unknown): boolean {
  const body = limitError(err);
  if (!body) return false;
  // Free's one lecture used up (or too long for it) → the Student upgrade, not a monthly-limit paywall.
  const trigger = isFreeLectureLimit(body) ? 'free_lecture_used' : (TRIGGER_BY_FEATURE[body.feature] ?? 'premium_feature');
  openPaywall(trigger, limitMessage(body));
  return true;
}

const locale = () => formattingLocale(isLanguage(i18n.language) ? i18n.language : 'en');

/**
 * List price for display (web, development). In the iOS/Android apps the paywall shows the
 * localized price the store returns instead (useStorePrices) as soon as it is available.
 */
export const formatPrice = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(cents / 100);
export const monthlyEquivalent = (plan: Plan) => (plan.period === 'yearly' ? Math.round(plan.priceCents / 12) : plan.priceCents);
export const tierName = (tier: Entitlement['tier']) => i18n.t(`plan.${tier}`);
export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const formatNumber = (n: number) => new Intl.NumberFormat(locale()).format(n);

/** "1 course • 1 exam • 5 practice questions" — built from the server's trial limits. */
export function trialAllowance(l: Limits): string {
  const t = i18n.t.bind(i18n);
  return [
    t('paywall.courses', { count: l.courses ?? 0 }),
    t('paywall.exams', { count: l.examGenerationsPerMonth ?? 0 }),
    t('paywall.practice', { count: l.practiceQuestionsPerMonth ?? 0 }),
  ].join(' • ');
}

/** Allowance left before the paywall, or null when unlimited. */
export const remaining = (limit: number | null, used: number) => (limit === null ? null : Math.max(0, limit - used));

/** One-line plan description for headers/banners. */
export function planSummary(e: Entitlement): string {
  const t = i18n.t.bind(i18n);
  switch (e.status) {
    case 'complimentary':
      return t('plan.complimentary');
    case 'trialing':
      return t('plan.trialing', { date: formatDate(e.trialEndsAt) });
    case 'active':
      return t('plan.active', { plan: tierName(e.tier), date: formatDate(e.currentPeriodEndsAt) });
    case 'cancelled':
      return e.tier === 'trial'
        ? t('plan.trialing', { date: formatDate(e.trialEndsAt) })
        : t('plan.cancelled', { plan: tierName(e.tier), date: formatDate(e.currentPeriodEndsAt) });
    case 'expired':
      return e.trialEnded ? t('plan.expiredTrial') : t('plan.expired');
    default:
      return t('plan.freePlan');
  }
}

/**
 * Opens the subscription management page of the store that bills it (cancel, change plan, billing).
 * Apple/Google handle this for store subscriptions; the app never cancels them itself. Uses the
 * store that SOLD the subscription, which may differ from this device's store.
 */
export function openManageSubscriptions(provider: BillingProviderId | null = Platform.OS === 'android' ? 'google' : 'apple', planId?: PlanId | null) {
  let url = 'https://apps.apple.com/account/subscriptions';
  if (provider === 'google') {
    const plan = PLANS.find((p) => p.id === planId);
    const pkg = Constants.expoConfig?.android?.package;
    url = plan && pkg ? `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(plan.googleProductId)}&package=${encodeURIComponent(pkg)}` : 'https://play.google.com/store/account/subscriptions';
  }
  void Linking.openURL(url);
}

/** Localized store prices for the plans (empty until the store answers, or on web / mock). */
export function useStorePrices(store: StoreClient | null, plans: readonly Plan[] | undefined) {
  return useQuery({
    queryKey: ['store-prices', store?.provider ?? null],
    queryFn: () => store!.prices!(plans!),
    enabled: !!store?.prices && !!plans?.length,
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
