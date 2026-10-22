/**
 * The website's "start" links: https://app.exama.app/start?…  — pure, unit-tested (test/start-intent.test.ts).
 *
 *   mode=signup | signin   which form a signed-out visitor sees first (default: sign-up)
 *   account=student | organization   which identity the link means. Sign-in opens on that account type; sign-up with
 *                          `organization` opens the organization (B2B workspace) form. Someone already signed in to
 *                          the OTHER identity is sent to the switch-account screen, never into the current session.
 *   intent=plans           after signing up or in, continue to the plans screen (paywall)
 *   plan=basic|student|pro, period=monthly|yearly   pre-select that plan there
 *   lang=en|es|fr|ar       the website's language (used when the app has no saved language yet)
 *
 * Only these known values are read, so the link can't send anyone to an arbitrary address. The
 * destination is kept on the device for one hour, so it survives sign-up, onboarding and email
 * confirmation; it is used once. Nothing here starts a trial: the plans screen shows what the
 * server offers this account (trial only if eligible and web checkout is available).
 */
import { PAID_TIERS, type AccountType, type BillingPeriod, type PaidTier } from '@study/shared';
import type { Href } from 'expo-router';
import { isLanguage, type Language } from '../i18n/languages';

export const PENDING_START_KEY = 'pending_start';
export const PENDING_START_TTL_MS = 60 * 60_000;

export type StartIntent = { kind: 'plans'; tier: PaidTier | null; period: BillingPeriod | null; at: number };
export type StartLink = { mode: 'signup' | 'signin'; account: AccountType | null; intent: StartIntent | null; lang: Language | null };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase();

export function parseStartLink(params: Record<string, string | string[] | undefined>, now = Date.now()): StartLink {
  const tier = one(params.plan);
  const period = one(params.period);
  const lang = one(params.lang);
  return {
    mode: one(params.mode) === 'signin' ? 'signin' : 'signup',
    account: one(params.account) === 'organization' ? 'organization' : one(params.account) === 'student' ? 'student' : null,
    intent:
      one(params.intent) === 'plans'
        ? {
            kind: 'plans',
            tier: (PAID_TIERS as readonly string[]).includes(tier ?? '') ? (tier as PaidTier) : null,
            period: period === 'monthly' || period === 'yearly' ? period : null,
            at: now,
          }
        : null,
    lang: isLanguage(lang) ? lang : null,
  };
}

/** A stored intent, if it is well-formed and less than an hour old. */
export function readPendingStart(raw: string | null, now = Date.now()): StartIntent | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<StartIntent>) : null;
    if (!v || v.kind !== 'plans' || typeof v.at !== 'number' || now - v.at > PENDING_START_TTL_MS || v.at > now + 60_000) return null;
    return {
      kind: 'plans',
      tier: (PAID_TIERS as readonly string[]).includes(v.tier ?? '') ? (v.tier as PaidTier) : null,
      period: v.period === 'monthly' || v.period === 'yearly' ? v.period : null,
      at: v.at,
    };
  } catch {
    return null;
  }
}

/**
 * Where /start sends the visitor, from the link and the current session (pure; test/start-intent.test.ts).
 * - Signed in to the identity the link names (or to any, when it names none): the destination, or the app.
 * - Signed in to the OTHER identity: the switch-account screen (sign out first, then sign in as that type). The link
 *   never lands in the current session, so an organization link never "defaults" to a student session.
 * - Signed out: the sign-in or sign-up form, on the named account type.
 */
export function startRedirect(link: StartLink, user: { accountType: AccountType } | null): Href {
  if (user) {
    if (link.account && link.account !== user.accountType) return { pathname: '/switch-account', params: { account: link.account } };
    return link.intent ? startDestination(link.intent) : '/';
  }
  if (link.mode === 'signin') return link.account ? { pathname: '/sign-in', params: { account: link.account } } : '/sign-in';
  // ?account=organization: the sign-up form opens on the organization step (no account-type question).
  return link.account === 'organization' ? { pathname: '/sign-up', params: { account: 'organization' } } : '/sign-up';
}

/** Where a signed-in student continues: the plans screen, with the chosen plan pre-selected. */
export function startDestination(intent: StartIntent): Href {
  return {
    pathname: '/paywall',
    params: { trigger: 'website_cta', ...(intent.tier ? { tier: intent.tier } : {}), ...(intent.period ? { period: intent.period } : {}) },
  };
}
