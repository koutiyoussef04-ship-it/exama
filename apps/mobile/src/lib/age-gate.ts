/**
 * Minimum sign-up age (13), client side — pure, unit tested. The age question is neutral (every age
 * can be chosen); "Under 13" ends sign-up on the device without contacting the server, and the app
 * remembers only that sign-up was declined (a timestamp, no answer, no details) for 24 hours so the
 * question can't simply be answered again by going back (FTC COPPA FAQ H.3). The API enforces the
 * same rule for every client (403 age_requirement_not_met).
 */
import { MINIMUM_SIGNUP_AGE, type SignupAgeAnswer } from '@study/shared';

export { MINIMUM_SIGNUP_AGE };
export const AGE_BLOCK_KEY = 'signup_age_block_until';
export const AGE_BLOCK_MS = 24 * 3_600_000;

export const isBelowMinimumAge = (answer: SignupAgeAnswer | null | undefined) => answer === 'under_13';

/** Value stored when sign-up is declined: only when the block ends. */
export const ageBlockValue = (now = Date.now()) => String(now + AGE_BLOCK_MS);

/** Is a stored block still running? Anything unreadable counts as no block. */
export function ageBlockActive(stored: string | null | undefined, now = Date.now()): boolean {
  const until = Number(stored);
  return Number.isFinite(until) && until > now && until - now <= AGE_BLOCK_MS;
}
