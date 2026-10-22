/**
 * B2B owner dashboard: every organization (plan, pilot, usage, failures), the organization accounts and the totals.
 * Separate from the student owner's /admin. The server allows only the B2B owner (an organization account with
 * b2b_role = owner) and answers 404 to everyone else; this screen then says it is not available.
 */
import type { B2BAccountRow, B2BOrganizationRow, B2BOverview } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Badge, Body, Card, colors, EmptyState, ErrorState, ListRow, Loading, Screen, SectionLabel, space, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMicroUsd } from '@/lib/b2b-admin';
import { formatDate, formatNumber } from '@/lib/billing';

export default function B2BAdmin() {
  const { t } = useTranslation();
  const overview = useQuery({ queryKey: ['b2b-admin', 'overview'], queryFn: api.b2bOverview, retry: false });
  const orgs = useQuery({ queryKey: ['b2b-admin', 'organizations'], queryFn: api.b2bOrganizations, retry: false, enabled: overview.isSuccess });
  const accounts = useQuery({ queryKey: ['b2b-admin', 'accounts'], queryFn: api.b2bAccounts, retry: false, enabled: overview.isSuccess });
  const refresh = () => void Promise.all([overview.refetch(), orgs.refetch(), accounts.refetch()]);

  if (overview.isLoading) return <Loading />;
  if (overview.error instanceof ApiError && overview.error.status === 404) {
    return (
      <Screen>
        <EmptyState title={t('b2bAdmin.notAvailable')} />
      </Screen>
    );
  }
  if (overview.error || !overview.data) return <ErrorState error={overview.error} onRetry={refresh} />;
  return (
    <Screen onRefresh={refresh} refreshing={overview.isFetching}>
      <View style={{ gap: space(1) }}>
        <Title>{t('b2bAdmin.title')}</Title>
        <Body muted>{t('b2bAdmin.subtitle', { date: formatDate(overview.data.generatedAt) })}</Body>
      </View>
      <OverviewCards o={overview.data} />
      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('b2bAdmin.allOrganizations')}</SectionLabel>
        {orgs.isLoading && <Loading />}
        {orgs.error && <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />}
        {orgs.data?.length === 0 && <Body muted>{t('b2bAdmin.noOrganizations')}</Body>}
        {orgs.data?.map((o, i) => <OrganizationRow key={o.id} o={o} last={i === orgs.data!.length - 1} />)}
      </Card>
      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('b2bAdmin.accounts')}</SectionLabel>
        {accounts.error && <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />}
        {accounts.data?.slice(0, 100).map((a, i, all) => <AccountRow key={a.id} a={a} last={i === all.length - 1} />)}
      </Card>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 140, flexGrow: 1, gap: 2 }}>
      <Body muted style={{ fontSize: 13 }}>{label}</Body>
      <Body style={{ fontSize: 20, fontWeight: '700' }}>{value}</Body>
    </View>
  );
}

function OverviewCards({ o }: { o: B2BOverview }) {
  const { t } = useTranslation();
  const n = formatNumber;
  return (
    <View style={{ gap: space(3) }}>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('b2bAdmin.organizations')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          <Stat label={t('b2bAdmin.stats.total')} value={n(o.organizations.total)} />
          <Stat label={t('b2bAdmin.stats.active')} value={n(o.organizations.active)} />
          <Stat label={t('b2bAdmin.stats.suspended')} value={n(o.organizations.suspended)} />
          <Stat label={t('b2bAdmin.stats.pilotsActive')} value={n(o.organizations.pilotsActive)} />
          <Stat label={t('b2bAdmin.stats.pilotsEndingSoon')} value={n(o.organizations.pilotsEndingSoon)} />
          <Stat label={t('b2bAdmin.stats.pilotsExpired')} value={n(o.organizations.pilotsExpired)} />
          <Stat label={t('b2bAdmin.stats.withoutPlan')} value={n(o.organizations.withoutPlan)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {Object.entries(o.organizations.byPlan).map(([plan, count]) => (
            <Badge key={plan} label={`${t(`org.plan.name.${plan as 'pilot'}`)} · ${n(count)}`} />
          ))}
        </View>
      </Card>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('b2bAdmin.usageThisMonth')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          <Stat label={t('b2bAdmin.stats.courseUploads')} value={n(o.usageThisMonth.courses)} />
          <Stat label={t('b2bAdmin.stats.draftsGenerated')} value={n(o.usageThisMonth.drafts)} />
          <Stat label={t('b2bAdmin.stats.aiCost')} value={formatMicroUsd(o.usageThisMonth.aiCostMicroUsd)} />
        </View>
      </Card>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('b2bAdmin.contentAndOperations')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          <Stat label={t('b2bAdmin.stats.courses')} value={n(o.content.courses)} />
          <Stat label={t('b2bAdmin.stats.drafts')} value={n(o.content.drafts)} />
          <Stat label={t('b2bAdmin.stats.approved')} value={n(o.content.approved)} />
          <Stat label={t('b2bAdmin.stats.rejected')} value={n(o.content.rejected)} />
          <Stat label={t('b2bAdmin.stats.failedCourses')} value={n(o.content.failedCourses)} />
          <Stat label={t('b2bAdmin.stats.aiErrors30')} value={n(o.operations.aiErrorsLast30Days)} />
        </View>
      </Card>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('b2bAdmin.accounts')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
          <Stat label={t('b2bAdmin.stats.organizationAccounts')} value={n(o.accounts.organizationAccounts)} />
          <Stat label={t('b2bAdmin.stats.verified')} value={n(o.accounts.verified)} />
          <Stat label={t('b2bAdmin.stats.withoutOrganization')} value={n(o.accounts.withoutOrganization)} />
          <Stat label={t('b2bAdmin.stats.signups30')} value={n(o.accounts.signupsLast30Days)} />
        </View>
      </Card>
    </View>
  );
}

function OrganizationRow({ o, last }: { o: B2BOrganizationRow; last: boolean }) {
  const { t } = useTranslation();
  const plan = o.plan === 'pilot' && o.pilotExpired ? t('org.plan.pilotEndedBadge') : t(`org.plan.name.${o.plan}`);
  const status = o.status === 'suspended' ? ` · ${t('b2bAdmin.suspended')}` : '';
  const issues = o.failedCourses + o.aiErrorsLast30Days > 0 ? ` · ${t('b2bAdmin.issues', { count: o.failedCourses + o.aiErrorsLast30Days })}` : '';
  return (
    <ListRow
      label={o.name}
      value={`${plan}${status}${issues}`}
      onPress={() => router.push({ pathname: '/b2b-admin/[id]', params: { id: o.id } })}
      tone={o.status === 'suspended' ? 'danger' : 'default'}
      last={last}
    />
  );
}

function AccountRow({ a, last }: { a: B2BAccountRow; last: boolean }) {
  const { t } = useTranslation();
  const orgs = a.organizations.map((o) => `${o.name} (${t(`org.roles.${o.role}`)})`).join(', ') || t('b2bAdmin.noOrganization');
  const owner = a.b2bRole === 'owner' ? ` · ${t('b2bAdmin.ownerBadge')}` : '';
  const unverified = a.emailVerified ? '' : ` · ${t('b2bAdmin.unverified')}`;
  return (
    <View style={{ paddingVertical: space(2), gap: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Body style={{ fontWeight: '600' }}>{a.email}</Body>
      <Body muted style={{ fontSize: 13 }}>{`${orgs}${owner}${unverified}`}</Body>
    </View>
  );
}
