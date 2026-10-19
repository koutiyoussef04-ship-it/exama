/**
 * Organization workspace helpers: which organization the screens show, role checks (cosmetic — the
 * server decides on every request) and the formatting of review flags and source locations.
 */
import type { BankItemStatus, OrganizationMembershipSummary, OrganizationRole, QuestionSource, ReviewFlag, Verification } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import i18n from '@/i18n';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import { kv } from './storage';

/** Device preference: the organization last chosen in the switcher. */
export const ORG_CURRENT_KEY = 'org:current';
/** Query key of the signed-in user's memberships (refetched after creating an organization). */
export const ORG_LIST_KEY = ['org', 'list'] as const;

export const canEdit = (role: OrganizationRole | null | undefined) => role === 'editor' || role === 'admin';
export const canAdmin = (role: OrganizationRole | null | undefined) => role === 'admin';

/** The server refused because of the caller's role (or a suspended organization). */
export const isForbidden = (err: unknown) => err instanceof ApiError && err.status === 403;

/**
 * Resolves the organization the workspace shows: the `orgId` route param, else the stored choice,
 * else the first membership. Memberships come from the session (`GET /auth/me`) and are refetched
 * from `/orgs` when something changed (a new organization, pull to refresh).
 */
export function useCurrentOrg() {
  const { user } = useAuth();
  const { orgId } = useLocalSearchParams<{ orgId?: string }>();
  const list = useQuery({
    queryKey: ORG_LIST_KEY,
    queryFn: api.listOrganizations,
    enabled: !!user,
    initialData: user?.organizations ?? [],
    staleTime: 5 * 60_000,
  });
  const orgs: OrganizationMembershipSummary[] = list.data ?? [];

  // undefined = not read yet; null = nothing stored.
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void kv.get(ORG_CURRENT_KEY).then((v) => live && setStored(v));
    return () => {
      live = false;
    };
  }, []);

  /** Remembers the choice and opens that organization's dashboard. */
  const setCurrent = useCallback((id: string) => {
    setStored(id);
    void kv.set(ORG_CURRENT_KEY, id);
    router.replace({ pathname: '/org', params: { orgId: id } });
  }, []);

  const org = orgs.find((o) => o.id === orgId) ?? orgs.find((o) => o.id === stored) ?? orgs[0] ?? null;
  // Wait for the stored choice unless the route or the membership list already decides it.
  const ready = !!orgId || orgs.length <= 1 || stored !== undefined;
  return { org, orgs, setCurrent, ready, refetchOrgs: list.refetch };
}

// ------------------------------------------------------------------ labels

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<BankItemStatus, BadgeTone> = { draft: 'primary', approved: 'success', rejected: 'danger', retired: 'neutral' };
export const VERDICT_TONE: Record<Verification['verdict'], BadgeTone> = { supported: 'success', partial: 'warning', unsupported: 'danger', unavailable: 'neutral' };

const t = i18n.t.bind(i18n);

export const statusLabel = (status: BankItemStatus) => t(`org.status.${status}`);
export const flagLabel = (flag: ReviewFlag) => t(`org.flags.${flag}`);
export const flagHint = (flag: ReviewFlag) => t(`org.flagHints.${flag}`);
export const verdictLabel = (verdict: Verification['verdict']) => t(`org.verdict.${verdict}`);
export const roleLabel = (role: OrganizationRole) => t(`org.roles.${role}`);

/** Seconds → mm:ss (or h:mm:ss past an hour). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Where a quote was found: "Page 12", "Pages 3–4" or "12:05–13:40". When the server could not place the
 * quote in one passage (`located === false`) it says so instead — a page is never guessed.
 */
export function sourceLabel(s: Pick<QuestionSource, 'located' | 'pageStart' | 'pageEnd' | 'startSeconds' | 'endSeconds'>): string {
  if (!s.located) return t('org.source.notConfirmed');
  if (s.pageStart != null) {
    const end = s.pageEnd ?? s.pageStart;
    return end === s.pageStart ? t('org.source.page', { page: s.pageStart }) : t('org.source.pages', { start: s.pageStart, end });
  }
  if (s.startSeconds != null) return t('org.source.time', { start: mmss(s.startSeconds), end: mmss(s.endSeconds ?? s.startSeconds) });
  return t('org.source.notConfirmed');
}
