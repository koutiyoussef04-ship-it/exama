/**
 * Email verification after sign-up. The API emails a link to <web app>/verify-email#token=…; the
 * token is random, single use, expires after 24 hours and only its keyed hash is stored.
 * Accounts created before verification existed are never asked (`required: false`).
 */
import { z } from 'zod';
import { normalizeEmail } from './email';
import { languageSchema } from './languages';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
/** Minimum time between two verification emails for the same account. */
export const EMAIL_VERIFICATION_RESEND_SECONDS = 60;

/** The token from the link. Its exact format is checked by the server (anything else is "invalid link"). */
export const verifyEmailSchema = z.object({ token: z.string().max(512) });
export type VerifyEmailInput = z.input<typeof verifyEmailSchema>;

/** Signed in: send the link again. `language` = app language, for the email. */
export const resendVerificationSchema = z.object({ language: languageSchema.optional() });
export type ResendVerificationInput = z.input<typeof resendVerificationSchema>;

/** Signed out (e.g. an expired link opened on another device): always the same answer, whatever the email. */
export const requestVerificationSchema = z.object({
  email: z.email().transform(normalizeEmail),
  language: languageSchema.optional(),
});
export type RequestVerificationInput = z.input<typeof requestVerificationSchema>;

export type EmailVerificationState = {
  verified: boolean;
  verifiedAt: string | null;
  /** This account is asked to confirm its email (new accounts, while email sending is configured). */
  required: boolean;
  /** When courses and exams stop working if the email is still unconfirmed (null: never). */
  restrictedFrom: string | null;
  /** Courses and exams are blocked right now until the email is confirmed (403 email_not_verified). */
  restricted: boolean;
};

/**
 * `auth`: present when the link completed a sign-up — the account was created just now and this is its session
 * (opening the link proves the inbox, so the person is signed in on the device that opened it).
 */
export type VerifyEmailResult = { status: 'verified'; auth?: { token: string; user: import('./index').User } };

/** Sign-up answer while the email is not confirmed yet: no account exists, nothing is signed in. */
export type SignupPending = { status: 'verification_pending'; email: string; retryAfterSeconds: number };
/** Verification emails per address and hour during sign-up (first email included). */
export const SIGNUP_EMAILS_PER_HOUR = 5;

/** `sent: false` = nothing was sent now (wait `retryAfterSeconds`, or already verified). */
export type ResendVerificationResult = { sent: boolean; retryAfterSeconds: number; alreadyVerified?: boolean };
