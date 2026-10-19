import { z } from 'zod';
import { languageSchema } from './languages';
import { MARKETING_CONSENT_VERSIONS, unsubscribeCategorySchema } from './marketing-consent';

/**
 * The one rule for comparing email addresses, used by sign-up, sign-in, password reset, email
 * verification and the deleted-email restriction: lower case, nothing else. Distinct addresses stay
 * distinct (dots and "+tags" are kept). Inputs are validated as email addresses first (no spaces).
 */
export const normalizeEmail = (email: string): string => email.toLowerCase();

/**
 * Email preferences (GET/PATCH /email/preferences, signed in). Two separate categories:
 *   `studyReminders`  the daily study-plan email (on by default). `available`: the server sends these emails at all.
 *                     `emailVerified`: they only go to a confirmed address. Only Free accounts that have never had a
 *                     subscription, trial or web checkout get them (`sentToThisAccount` false otherwise).
 *   `marketing`       explicit consent to tips, news, offers and invitations to come back (marketing-consent.ts).
 *                     false unless the person ticked the box at sign-up or turned it on in Account.
 *                     `marketingAvailable`: the server can send email at all.
 */
export type EmailPreferences = {
  studyReminders: boolean;
  available: boolean;
  emailVerified: boolean;
  sentToThisAccount: boolean;
  marketing: boolean;
  marketingAvailable: boolean;
};
/**
 * Each field is optional and changes only itself: a PATCH that does not mention `marketing` can never grant or withdraw
 * consent. Granting needs the explicit version and language of the wording shown; withdrawing needs only `consent: false`.
 */
export const updateEmailPreferencesSchema = z
  .object({
    studyReminders: z.boolean().optional(),
    marketing: z
      .union([
        z.object({ consent: z.literal(true), version: z.enum(MARKETING_CONSENT_VERSIONS), language: languageSchema }).strict(),
        z.object({ consent: z.literal(false) }).strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((v) => v.studyReminders !== undefined || v.marketing !== undefined, { message: 'Nothing to update' });
export type UpdateEmailPreferencesInput = z.input<typeof updateEmailPreferencesSchema>;
/**
 * One-click / web-page unsubscribe from the link in an email. `category` says which emails stop; without it the link
 * is an old daily-study-email link (study reminders only).
 */
export const unsubscribeSchema = z.object({ token: z.string().max(200), category: unsubscribeCategorySchema.optional() });
