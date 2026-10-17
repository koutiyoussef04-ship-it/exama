/**
 * Email verification, client side — pure (no React Native) so it is unit tested.
 * The server decides everything (who is asked, when courses and exams are blocked); the app only
 * shows the banner, the "check your email" page, and the result of opening a link.
 */
import type { EmailVerificationState } from '@study/shared';

/** 32 random bytes, base64url — anything else can't be a real link and is shown as "invalid" without asking the server. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token from the link: `#token=…` (the fragment never reaches a server, see the API) or, as a
 * fallback for app deep links, a `token` route parameter. null when there is none; '' when it's malformed.
 */
export function linkToken(hash: string | null | undefined, param?: string | string[] | null): string | null {
  const fromHash = hash ? new URLSearchParams(hash.replace(/^#/, '')).get('token') : null;
  const raw = fromHash ?? (Array.isArray(param) ? param[0] : param) ?? null;
  if (raw === null || raw === undefined) return null;
  const token = raw.trim();
  return TOKEN.test(token) ? token : '';
}

export type LinkOutcome = 'verified' | 'expired' | 'invalid' | 'used' | 'used_verified' | 'error';

/** What the page shows after checking a link (from the API's error code). */
export function linkOutcome(err: unknown): LinkOutcome {
  const e = err as { status?: number; code?: string; body?: { details?: { emailVerified?: boolean } } } | null;
  switch (e?.code) {
    case 'verification_link_expired':
      return 'expired';
    case 'verification_link_invalid':
      return 'invalid';
    case 'verification_link_used':
      return e.body?.details?.emailVerified ? 'used_verified' : 'used';
    default:
      return 'error'; // network, server, rate limit: offer "try again"
  }
}

/** The "confirm your email" banner on the course list: new accounts that haven't confirmed yet. */
export const showVerificationBanner = (s: EmailVerificationState | undefined) => !!s && s.required && !s.verified;

/** The server has paused courses and exams: send the student to the verification page. */
export const mustVerifyNow = (s: EmailVerificationState | undefined) => !!s?.restricted;

/** Whole seconds left before another link can be requested. */
export const secondsLeft = (retryAt: number, now: number) => Math.max(0, Math.ceil((retryAt - now) / 1000));
