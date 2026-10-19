/**
 * Sign-up form rules that don't need the server. "Confirm password" exists only on the device: it is
 * compared with the password before anything is sent, and never included in the request or stored.
 */
import { MARKETING_CONSENT_VERSION, type AgeRange, type Language, type RegisterInput, type SignupAgeAnswer } from '@study/shared';

/** Same minimum as the API (registerSchema). */
export const MIN_PASSWORD_LENGTH = 8;

export type SignupForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  ageRange: SignupAgeAnswer | null;
};

/** Both password fields are filled in and identical. */
export const passwordsMatch = (f: Pick<SignupForm, 'password' | 'confirmPassword'>) => f.confirmPassword.length > 0 && f.password === f.confirmPassword;

/** Show "Passwords do not match." once the second field has something in it that differs. */
export const showPasswordMismatch = (f: Pick<SignupForm, 'password' | 'confirmPassword'>) => f.confirmPassword.length > 0 && f.password !== f.confirmPassword;

/** Every required field is complete and valid, including the two matching passwords. */
export const canSubmitSignup = (f: SignupForm) =>
  !!f.name.trim() && !!f.email.trim() && f.password.length >= MIN_PASSWORD_LENGTH && passwordsMatch(f) && !!f.ageRange;

/**
 * The request body (age already checked to be 13+): the confirmation is deliberately not part of it.
 * `marketing`: the optional box. It adds `marketingConsent` — the version and language of the wording that was shown — ONLY when it
 * is ticked; unticked, the key is absent, so nothing is recorded. It never affects whether the form can be submitted.
 */
export function signupRequest(f: Omit<SignupForm, 'ageRange'> & { ageRange: AgeRange }, opts: { language: Language; marketing?: boolean }): RegisterInput {
  return {
    name: f.name.trim(),
    email: f.email.trim(),
    password: f.password,
    language: opts.language,
    ageRange: f.ageRange,
    ...(opts.marketing === true && { marketingConsent: { version: MARKETING_CONSENT_VERSION, language: opts.language } }),
  };
}
