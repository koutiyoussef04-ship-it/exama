/**
 * B2B owner dashboard helpers. Whether the dashboard link shows comes from the account (`user.b2bRole`, sent by the
 * server only for the B2B owner's organization account); hiding it is cosmetic — every /b2b-admin endpoint checks the
 * role on the server and answers 404 to anyone else.
 */
import type { User } from '@study/shared';
import i18n from '@/i18n';

export const B2B_ADMIN_ROUTE = '/b2b-admin' as const;

export const showB2BAdminEntry = (user: Pick<User, 'accountType' | 'b2bRole'> | null | undefined): boolean =>
  user?.accountType === 'organization' && user.b2bRole === 'owner';

/** AI cost in micro-USD → "$0.42" in the app language; null (some calls had no price) → "—". */
export const formatMicroUsd = (micro: number | null): string =>
  micro === null ? '—' : new Intl.NumberFormat(i18n.language || 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(micro / 1_000_000);

/** A pilot extended by `days` from its current end (or from now, if it already ended). */
export const extendedPilotEnd = (pilotEndsAt: string | null, days: number, now = Date.now()): string =>
  new Date(Math.max(now, pilotEndsAt ? Date.parse(pilotEndsAt) : now) + days * 86_400_000).toISOString();

export type PilotGrantForm = { days: string; courses: string; drafts: string; seats: string };
export type PilotGrant = { ok: true; input: { plan: 'pilot'; pilotEndsAt: string; limits?: { coursesPerMonth?: number; itemsPerMonth?: number; maxMembers?: number } } } | { ok: false; error: 'days' | 'limit' };

/**
 * The owner's "Grant a pilot" form → the PATCH body (pure; test/b2b-admin-pilot.test.ts). The pilot starts on the server
 * at the moment of the request; `days` sets its end. Empty allowance fields keep the pilot defaults. The server checks
 * every rule again (owner only, future end, at most ORGANIZATION_PILOT_MAX_DAYS).
 */
export function pilotGrantInput(f: PilotGrantForm, maxDays: number, now = Date.now()): PilotGrant {
  const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
  const days = whole(f.days);
  if (!Number.isInteger(days) || days < 1 || days > maxDays) return { ok: false, error: 'days' };
  const limits: { coursesPerMonth?: number; itemsPerMonth?: number; maxMembers?: number } = {};
  for (const [key, raw, min] of [['coursesPerMonth', f.courses, 0], ['itemsPerMonth', f.drafts, 0], ['maxMembers', f.seats, 1]] as const) {
    if (!raw.trim()) continue;
    const v = whole(raw);
    if (!Number.isInteger(v) || v < min || v > 1_000_000) return { ok: false, error: 'limit' };
    limits[key] = v;
  }
  return { ok: true, input: { plan: 'pilot', pilotEndsAt: new Date(now + days * 86_400_000).toISOString(), ...(Object.keys(limits).length ? { limits } : {}) } };
}
