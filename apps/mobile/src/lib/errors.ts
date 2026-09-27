/**
 * Turns any error into a message in the user's language. The API sends stable codes
 * (see apps/api/src/lib/errors.ts); the English text from the server is only a last resort.
 */
import type { BillingProviderId, LimitErrorBody } from '@study/shared';
import i18n from '@/i18n';
import { ApiError } from './api';
import { isFreeLectureLimit } from './material-options';
import { storeName } from './store/offers';

const t = i18n.t.bind(i18n);

export function limitMessage(body: LimitErrorBody): string {
  const plan = t(`plan.${body.tier}`);
  // The trial and Free's one lecture per account have their own wording (they never renew monthly).
  const key =
    body.tier === 'trial'
      ? (`limits.trial_${body.feature}` as const)
      : isFreeLectureLimit(body)
        ? (`limits.free_${body.feature as 'media_uploads' | 'media_minutes' | 'media_length'}` as const)
        : (`limits.${body.feature}` as const);
  return t(key, { count: body.limit, plan, requested: body.requested ?? 0, left: Math.max(0, body.limit - body.used) });
}

/** Translated processing-failure message for a document's errorCode. */
export function documentErrorMessage(code: string | null, fallback: string | null): string {
  if (code && i18n.exists(`errors.codes.${code}`)) return t(`errors.codes.${code}` as 'errors.codes.processing_failed');
  return fallback && i18n.language === 'en' ? fallback : t('errors.codes.processing_failed');
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'app_misconfigured') return t('errors.config');
    if (err.status === 0) return t('errors.network');
    if (err.status === 402 && err.body && typeof err.body === 'object' && 'feature' in err.body) return limitMessage(err.body as LimitErrorBody);
    if (err.code && i18n.exists(`errors.codes.${err.code}`)) {
      const details = (err.body as { details?: { maxMb?: number; maxDays?: number; max?: number; provider?: BillingProviderId } } | undefined)?.details;
      return t(`errors.codes.${err.code}` as 'errors.codes.file_too_large', {
        maxMb: details?.maxMb ?? 20,
        maxDays: details?.maxDays ?? 365,
        max: details?.max ?? 0,
        store: storeName(details?.provider), // subscribed_elsewhere: the store that bills the subscription
      });
    }
    if (err.status >= 500) return t('errors.server');
    // Unknown client error: the server's English text is better than nothing in English only.
    return i18n.language === 'en' && err.message ? err.message : t('errors.generic');
  }
  return t('errors.generic');
}
