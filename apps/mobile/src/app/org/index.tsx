/**
 * Organization workspace dashboard: counts (courses, drafts to review, approved…), this month's usage
 * against the organization's allowances, and the way into each section. Without any membership it
 * explains how to get one (organization accounts create one; students are added by an admin).
 */
import type { OrganizationOverview } from '@study/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Badge, Body, Button, Card, colors, EmptyState, ErrorState, Loading, ProgressBar, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/billing';
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
  const { org } = ctx;
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['org', org.id, 'overview'], queryFn: () => api.orgOverview(org.id) });
  const go = (pathname: '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members' | '/org/new') => router.push({ pathname, params: { orgId: org.id } });

  return (
    <Screen
      onRefresh={() => {
        void overview.refetch();
        void qc.invalidateQueries({ queryKey: ['org', 'list'] });
      }}
      refreshing={overview.isRefetching}
    >
      <OrgNav {...ctx} active="dashboard" />
      {overview.isLoading && <Loading />}
      {overview.error && !overview.data && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}
      {overview.data && <Overview data={overview.data} go={go} canUpload={canEdit(org.role)} />}
    </Screen>
  );
}

function Overview({ data: o, go, canUpload }: { data: OrganizationOverview; go: (p: '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members') => void; canUpload: boolean }) {
  const { t } = useTranslation();
  const c = o.counts;
  const u = o.usage;
  const l = o.limits;
  return (
    <>
      {o.status === 'suspended' && (
        <Card style={{ borderColor: colors.warning, gap: space(2) }}>
          <Badge label={t('org.dashboard.suspendedBadge')} tone="warning" />
          <Body muted>{t('org.dashboard.suspended')}</Body>
        </Card>
      )}

      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.dashboard.overview')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          <Stat label={t('org.dashboard.counts.courses')} value={c.courses} onPress={() => go('/org/courses')} />
          <Stat label={t('org.dashboard.counts.drafts')} value={c.drafts} tone="primary" onPress={() => go('/org/review')} />
          <Stat label={t('org.dashboard.counts.approved')} value={c.approved} tone="success" onPress={() => go('/org/bank')} />
          <Stat label={t('org.dashboard.counts.rejected')} value={c.rejected} tone="danger" />
          <Stat label={t('org.dashboard.counts.members')} value={c.members} onPress={() => go('/org/members')} />
        </View>
        <Body muted style={{ fontSize: 13 }}>
          {t(`org.market.${o.market}`)} · {t('org.dashboard.noAutoApproval')}
        </Body>
      </Card>

      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.dashboard.usage')}</SectionLabel>
        <UsageRow label={t('org.dashboard.usageCourses')} used={u.coursesThisMonth} limit={l.coursesPerMonth} />
        <UsageRow label={t('org.dashboard.usageItems')} used={u.itemsThisMonth} limit={l.itemsPerMonth} />
        <Body muted style={{ fontSize: 13 }}>{t('org.dashboard.perRequest', { count: l.maxItemsPerRequest })}</Body>
      </Card>

      <View style={{ gap: space(3) }}>
        <Button title={c.drafts > 0 ? t('org.dashboard.reviewDraftsCount', { count: c.drafts }) : t('org.dashboard.reviewDrafts')} onPress={() => go('/org/review')} variant={c.drafts > 0 ? 'primary' : 'secondary'} />
        {canUpload && <Button variant="secondary" title={t('org.dashboard.uploadCourse')} onPress={() => go('/org/courses')} />}
      </View>
    </>
  );
}

function Stat({ label, value, tone = 'neutral', onPress }: { label: string; value: number; tone?: 'neutral' | 'primary' | 'success' | 'danger'; onPress?: () => void }) {
  const color = tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text;
  const inner = (
    <>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontSize: 22, fontWeight: '800' }}>{formatNumber(value)}</Text>
    </>
  );
  const style = { minWidth: 120, flexGrow: 1, flexBasis: 120, padding: space(3), borderRadius: 10, backgroundColor: colors.bg, gap: space(1) } as const;
  if (!onPress) return <View style={style} accessibilityLabel={`${label}: ${value}`}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>
      {inner}
    </Pressable>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 15, fontWeight: '600' }}>{t('org.dashboard.usageOf', { used, limit })}</Text>
      </View>
      <ProgressBar value={limit > 0 ? used / limit : 1} color={used >= limit ? colors.warning : colors.primary} />
    </View>
  );
}
