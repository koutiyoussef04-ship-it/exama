/**
 * Optional consent to marketing emails — tips, news about new features, offers and invitations to come back.
 *
 * Deliberately NOT covered: the daily study-plan email (its own switch in Account, a separate category) and
 * account emails such as the confirmation link or a password-reset code (they need no consent). Ticking the
 * box says "yes" to exactly the wording below and nothing else; leaving it unticked records nothing.
 *
 * The wording itself lives in the app's translations (apps/mobile/src/i18n/locales, `marketing.statement` and
 * `marketing.hint`). A consent is stored as the VERSION and the LANGUAGE of the wording the person saw, so the
 * exact text can always be shown again; a test in the app pins the four texts to this version, so changing
 * any of them without bumping the version fails the build.
 *
 * The API never trusts a flag alone: it records consent only when the request carries an explicit,
 * known version and a supported language, and it stamps the time and the source itself.
 */
import { z } from 'zod';
import { languageSchema } from './languages';

/** Bump when the wording of ANY language changes. Old versions stay valid for the consents already given. */
export const MARKETING_CONSENT_VERSION = '2026-10-v1';
/** Versions the server accepts from a client (the current one; keep earlier ones only while old app builds are in use). */
export const MARKETING_CONSENT_VERSIONS = [MARKETING_CONSENT_VERSION] as const;
export type MarketingConsentVersion = (typeof MARKETING_CONSENT_VERSIONS)[number];

/** Where a consent was given. Set by the server, never by the client. */
export const MARKETING_CONSENT_SOURCES = ['signup', 'account'] as const;
export type MarketingConsentSource = (typeof MARKETING_CONSENT_SOURCES)[number];

/**
 * What the app sends when — and only when — the box is ticked (sign-up) or the switch is turned on (Account):
 * the version and language of the wording shown. Anything else in the object is refused, so a client cannot
 * smuggle in a timestamp or a source.
 */
export const marketingConsentSchema = z
  .object({ version: z.enum(MARKETING_CONSENT_VERSIONS), language: languageSchema })
  .strict();
export type MarketingConsentInput = z.input<typeof marketingConsentSchema>;

/** Which emails an unsubscribe link or button turns off. A link without a category is the old study-reminder link. */
export const UNSUBSCRIBE_CATEGORIES = ['study_reminders', 'marketing', 'all'] as const;
export type UnsubscribeCategory = (typeof UNSUBSCRIBE_CATEGORIES)[number];
export const unsubscribeCategorySchema = z.enum(UNSUBSCRIBE_CATEGORIES);
