/**
 * Sign-up form rules that don't need the server. "Confirm password" exists only on the device: it is
 * compared with the password before anything is sent, and never included in the request or stored.
 */
import type { AgeRange, Language, RegisterInput, SignupAgeAnswer } from '@study/shared';

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

/** The request body (age already checked to be 13+): the confirmation is deliberately not part of it. */
export function signupRequest(f: Omit<SignupForm, 'ageRange'> & { ageRange: AgeRange }, opts: { language: Language }): RegisterInput {
  return { name: f.name.trim(), email: f.email.trim(), password: f.password, language: opts.language, ageRange: f.ageRange };
}
