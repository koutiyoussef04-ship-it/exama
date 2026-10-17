import { z } from 'zod';

/**
 * The one rule for comparing email addresses, used by sign-up, sign-in, password reset, email
 * verification and the deleted-email restriction: lower case, nothing else. Distinct addresses stay
 * distinct (dots and "+tags" are kept). Inputs are validated as email addresses first (no spaces).
 */
export const normalizeEmail = (email: string): string => email.toLowerCase();

/**
 * Email preferences (GET/PATCH /email/preferences, signed in). `studyReminders`: the daily study-plan email
 * (on by default). `available`: the server sends these emails at all. `emailVerified`: they only go to a
 * confirmed address. Students with an active subscription or trial don't get them (`sentToThisAccount` false).
 */
export type EmailPreferences = { studyReminders: boolean; available: boolean; emailVerified: boolean; sentToThisAccount: boolean };
export const updateEmailPreferencesSchema = z.object({ studyReminders: z.boolean() }).strict();
export type UpdateEmailPreferencesInput = z.input<typeof updateEmailPreferencesSchema>;
/** One-click / web-page unsubscribe from the link in a reminder email. */
export const unsubscribeSchema = z.object({ token: z.string().max(200) });
