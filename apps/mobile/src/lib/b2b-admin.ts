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
