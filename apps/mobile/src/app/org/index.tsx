/**
 * Organization dashboard: the key numbers, this month's usage against the organization's allowances and
 * the oldest drafts waiting for review. Without any membership it explains how to get one (organization
 * accounts create one; students are added by an admin).
 */
import type { OrganizationOverview } from '@study/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { QuestionTable } from '@/components/org/question-table';
import { SmallButton, StatCard, useIsWide, WorkspaceShell, type OrgContext } from '@/components/org/workspace';
import { Badge, Body, Button, Card, colors, EmptyState, ErrorState, Loading, ProgressBar, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/billing';
import { canEdit, useCurrentOrg } from '@/lib/org';

export default function OrgDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { org, orgs, setCurrent, ready, refetchOrgs } = useCurrentOrg();
  if (!ready) return <Loading />;

  if (!org) {
    const canCreate = user?.accountType === 'organization';
    return (
      <Screen onRefresh={() => void refetchOrgs()} refreshing={false}>
        <EmptyState title={t('org.dashboard.empty')}>
          <Body muted style={{ textAlign: 'center' }}>{canCreate ? t('org.dashboard.emptyCreate') : t('org.dashboard.emptyAdded')}</Body>
          {canCreate && <Button title={t('org.dashboard.create')} onPress={() => router.push('/org/new')} />}
          <TextButton title={t('org.nav.account')} onPress={() => router.push('/account')} />
        </EmptyState>
      </Screen>
    );
  }
  return <Dashboard org={org} orgs={orgs} switchOrg={setCurrent} />;
}

function Dashboard(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['org', org.id, 'overview'], queryFn: () => api.orgOverview(org.id) });
  const drafts = useQuery({ queryKey: ['org', org.id, 'items', { status: 'draft', sort: 'oldest', limit: 8, offset: 0 }], queryFn: () => api.orgItems(org.id, { status: 'draft', sort: 'oldest', limit: 8 }) });
  const go = (pathname: '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members') => router.push({ pathname, params: { orgId: org.id } });
  const o = overview.data;

  return (
    <WorkspaceShell
      {...ctx}
      active="dashboard"
      title={org.name}
      subtitle={t('org.ws.dashboard.subtitle')}
      draftCount={o?.counts.drafts}
      actions={
        <>
          {canEdit(org.role) && <SmallButton title={t('org.dashboard.uploadCourse')} icon="upload" onPress={() => go('/org/courses')} />}
          <SmallButton title={o && o.counts.drafts > 0 ? t('org.dashboard.reviewDraftsCount', { count: o.counts.drafts }) : t('org.dashboard.reviewDrafts')} icon="review" variant="primary" onPress={() => go('/org/review')} />
        </>
      }
      onRefresh={() => {
        void overview.refetch();
        void drafts.refetch();
        void qc.invalidateQueries({ queryKey: ['org', 'list'] });
      }}
      refreshing={overview.isRefetching}
    >
      {overview.isLoading && <Loading />}
      {overview.error && !o && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}
      {o && <Overview data={o} go={go} />}
      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{t('org.ws.dashboard.needsReview')}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.ws.dashboard.needsReviewHint')}</Text>
          </View>
          {!!drafts.data?.total && <SmallButton title={t('org.ws.dashboard.viewAll')} variant="ghost" onPress={() => go('/org/review')} />}
        </View>
        <QuestionTable orgId={org.id} items={drafts.data?.items ?? []} queue={{ status: 'draft', sort: 'oldest' }} loading={drafts.isLoading} emptyTitle={t('org.ws.dashboard.needsReviewEmpty')} />
      </View>
    </WorkspaceShell>
  );
}

function Overview({ data: o, go }: { data: OrganizationOverview; go: (p: '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members') => void }) {
  const { t } = useTranslation();
  const wide = useIsWide();
  const c = o.counts;
  const u = o.usage;
  const l = o.limits;
  return (
    <>
      {o.plan === 'pilot' && o.pilotEndsAt && (
        <Card style={{ gap: space(2), ...(o.pilotExpired && { borderColor: colors.warning }) }}>
          <Badge label={t(o.pilotExpired ? 'org.plan.pilotEndedBadge' : 'org.plan.pilotBadge')} tone={o.pilotExpired ? 'warning' : 'primary'} />
          <Body muted>{o.pilotExpired ? t('org.plan.pilotEnded', { date: formatDate(o.pilotEndsAt) }) : t('org.plan.pilotActive', { date: formatDate(o.pilotEndsAt) })}</Body>
        </Card>
      )}
      {o.status === 'suspended' && (
        <Card style={{ borderColor: colors.warning, gap: space(2) }}>
          <Badge label={t('org.dashboard.suspendedBadge')} tone="warning" />
          <Body muted>{t('org.dashboard.suspended')}</Body>
        </Card>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
        <StatCard label={t('org.dashboard.counts.courses')} value={formatNumber(c.courses)} onPress={() => go('/org/courses')} />
        <StatCard label={t('org.dashboard.counts.drafts')} value={formatNumber(c.drafts)} tone="primary" onPress={() => go('/org/review')} />
        <StatCard label={t('org.dashboard.counts.approved')} value={formatNumber(c.approved)} tone="success" onPress={() => go('/org/bank')} />
        <StatCard label={t('org.dashboard.counts.rejected')} value={formatNumber(c.rejected)} />
        <StatCard label={t('org.dashboard.counts.members')} value={formatNumber(c.members)} onPress={() => go('/org/members')} />
      </View>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space(3) }}>
        <Card style={{ flex: 1, gap: space(3) }}>
          <SectionLabel>{t(u.period === 'pilot' ? 'org.plan.usagePilot' : 'org.dashboard.usage')}</SectionLabel>
          <UsageRow label={t('org.dashboard.usageCourses')} used={u.coursesThisMonth} limit={l.coursesPerMonth} />
          <UsageRow label={t('org.dashboard.usageItems')} used={u.itemsThisMonth} limit={l.itemsPerMonth} />
          <Body muted style={{ fontSize: 13 }}>{t('org.dashboard.perRequest', { count: l.maxItemsPerRequest })}</Body>
          <Body muted style={{ fontSize: 13 }}>{t('org.plan.seats', { max: l.maxMembers })}</Body>
        </Card>
        <Card style={{ flex: 1, gap: space(2), justifyContent: 'center' }}>
          <SectionLabel>{t(`org.plan.name.${o.plan}`)}</SectionLabel>
          <Body style={{ fontSize: 14 }}>{t(`org.market.${o.market}`)}</Body>
          <Body muted style={{ fontSize: 14 }}>{t('org.dashboard.noAutoApproval')}</Body>
        </Card>
      </View>
    </>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <Text style={{ color: colors.text, fontSize: 14, flexShrink: 1 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '600' }}>{t('org.dashboard.usageOf', { used, limit })}</Text>
      </View>
      <ProgressBar value={limit > 0 ? used / limit : 1} color={used >= limit ? colors.warning : colors.primary} />
    </View>
  );
}
