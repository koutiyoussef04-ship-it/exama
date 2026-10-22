/**
 * Sign-up form rules that don't need the server. "Confirm password" exists only on the device: it is
 * compared with the password before anything is sent, and never included in the request or stored.
 *
 * Account type: a student (the study app) or an organization (a university, school, training center, company or
 * exam-preparation center, which opens the organization workspace). The choice is sent with the request; the server stores
 * it and decides which experience applies — the app only asks the question.
 *
 * An organization account either creates a new organization (name + market) or joins an existing one: then it is
 * created without an organization, and that organization's admin adds it by email. Student and organization accounts are
 * separate identities: the same email can have one of each.
 */
import { MARKETING_CONSENT_VERSION, type AccountType, type AgeRange, type Language, type OrganizationCategory, type RegisterInput, type SignupAgeAnswer } from '@study/shared';

/** Same minimum as the API (registerSchema). */
export const MIN_PASSWORD_LENGTH = 8;
/** Same as the API (organizationNameSchema). */
export const MIN_ORGANIZATION_NAME_LENGTH = 2;

export type SignupForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  ageRange: SignupAgeAnswer | null;
  /** null until the first step ("How will you use Exama?") is answered. */
  accountType?: AccountType | null;
  organizationName?: string;
  market?: OrganizationCategory | null;
  /** Organization accounts: join an existing organization (an admin adds you) instead of creating one. */
  joinExisting?: boolean;
};

/** Both password fields are filled in and identical. */
export const passwordsMatch = (f: Pick<SignupForm, 'password' | 'confirmPassword'>) => f.confirmPassword.length > 0 && f.password === f.confirmPassword;

/** Show "Passwords do not match." once the second field has something in it that differs. */
export const showPasswordMismatch = (f: Pick<SignupForm, 'password' | 'confirmPassword'>) => f.confirmPassword.length > 0 && f.password !== f.confirmPassword;

/** An organization sign-up also needs the organization's name and kind. */
export const organizationFieldsComplete = (f: Pick<SignupForm, 'accountType' | 'organizationName' | 'market' | 'joinExisting'>) =>
  (f.accountType ?? 'student') !== 'organization' || !!f.joinExisting || ((f.organizationName ?? '').trim().length >= MIN_ORGANIZATION_NAME_LENGTH && !!f.market);

/** Every required field is complete and valid, including the two matching passwords. */
export const canSubmitSignup = (f: SignupForm) =>
  !!f.name.trim() && !!f.email.trim() && f.password.length >= MIN_PASSWORD_LENGTH && passwordsMatch(f) && (isOrganizationSignup(f) || !!f.ageRange) && organizationFieldsComplete(f);

/** Organization (staff) sign-ups are not asked the age-group question. */
export const isOrganizationSignup = (f: Pick<SignupForm, 'accountType'>) => (f.accountType ?? 'student') === 'organization';

/**
 * The request body (age already checked to be 13+): the confirmation is deliberately not part of it.
 * `marketing`: the optional box. It adds `marketingConsent` — the version and language of the wording that was shown — ONLY when it
 * is ticked; unticked, the key is absent, so nothing is recorded. It never affects whether the form can be submitted.
 * Organization sign-ups add the account type, the organization's name and its market.
 */
export function signupRequest(f: Omit<SignupForm, 'ageRange'> & { ageRange: AgeRange | null }, opts: { language: Language; marketing?: boolean }): RegisterInput {
  const base = { name: f.name.trim(), email: f.email.trim(), password: f.password, language: opts.language };
  // Organizations: no age group. (The marketing box is a student-app consent; it is not recorded for staff.)
  if (isOrganizationSignup(f)) {
    if (f.joinExisting) return { ...base, accountType: 'organization' };
    return { ...base, accountType: 'organization', organizationName: (f.organizationName ?? '').trim(), market: f.market ?? undefined };
  }
  return {
    ...base,
    ageRange: f.ageRange ?? undefined,
    ...(opts.marketing === true && { marketingConsent: { version: MARKETING_CONSENT_VERSION, language: opts.language } }),
  };
}
