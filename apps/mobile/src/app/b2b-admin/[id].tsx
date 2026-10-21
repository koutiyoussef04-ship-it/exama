/**
 * One organization in the B2B owner dashboard: plan and pilot, allowances and usage, members, courses (with processing
 * failures), recent activity and AI errors — metadata and totals only, never course material or question text.
 * Controls: assign a plan (billing is manual), extend a pilot, suspend / reactivate. The server checks the B2B owner
 * role on every request.
 */
import { ORGANIZATION_BILLING_PERIODS, ORGANIZATION_PLANS, type AdminUpdateOrganizationInput, type B2BOrganizationDetail, type OrganizationBillingPeriod, type OrganizationPlan } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chips } from '@/components/planner';
import { Badge, Body, Button, Card, colors, EmptyState, ErrorState, ErrorText, Loading, Screen, SectionLabel, space, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { extendedPilotEnd, formatMicroUsd } from '@/lib/b2b-admin';
import { formatDate, formatNumber } from '@/lib/billing';
import { confirm } from '@/lib/confirm';

export default function B2BOrganization() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['b2b-admin', 'organization', id], queryFn: () => api.b2bOrganization(id), retry: false });
  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <Screen>
        <EmptyState title={t('b2bAdmin.notAvailable')} />
      </Screen>
    );
  }
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Detail o={q.data} refreshing={q.isFetching} refresh={() => void q.refetch()} />;
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3), paddingVertical: 2 }}>
    <Body muted style={{ flexShrink: 1 }}>{label}</Body>
    <Body style={{ fontWeight: '600', textAlign: 'right', flexShrink: 1 }}>{value}</Body>
  </View>
);

function Detail({ o, refreshing, refresh }: { o: B2BOrganizationDetail; refreshing: boolean; refresh: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const n = formatNumber;
  const [plan, setPlan] = useState<OrganizationPlan>(o.plan);
  const [period, setPeriod] = useState<OrganizationBillingPeriod>(o.billingPeriod ?? 'monthly');
  useEffect(() => {
    setPlan(o.plan);
    setPeriod(o.billingPeriod ?? 'monthly');
  }, [o.plan, o.billingPeriod]);
  const update = useMutation({
    mutationFn: (input: AdminUpdateOrganizationInput) => api.b2bUpdateOrganization(o.id, input),
    onSuccess: (data) => {
      qc.setQueryData(['b2b-admin', 'organization', o.id], data);
      void qc.invalidateQueries({ queryKey: ['b2b-admin', 'organizations'] });
      void qc.invalidateQueries({ queryKey: ['b2b-admin', 'overview'] });
    },
  });
  const planChanged = plan !== o.plan || (plan !== 'pilot' && period !== (o.billingPeriod ?? 'monthly'));
  const savePlan = async () => {
    const ok = await confirm({ title: t('b2bAdmin.detail.confirmPlanTitle', { name: o.name, plan: t(`org.plan.name.${plan}`) }), message: t('b2bAdmin.detail.confirmPlanBody'), confirmText: t('b2bAdmin.detail.savePlan') });
    if (ok) update.mutate(plan === 'pilot' ? { plan } : { plan, billingPeriod: period });
  };
  const toggleStatus = async () => {
    const suspending = o.status === 'active';
    const ok = await confirm({
      title: suspending ? t('b2bAdmin.detail.confirmSuspendTitle', { name: o.name }) : t('b2bAdmin.detail.confirmReactivateTitle', { name: o.name }),
      message: suspending ? t('b2bAdmin.detail.confirmSuspendBody') : undefined,
      confirmText: suspending ? t('b2bAdmin.detail.suspend') : t('b2bAdmin.detail.reactivate'),
      destructive: suspending,
    });
    if (ok) update.mutate({ status: suspending ? 'suspended' : 'active' });
  };
  const periodLabel = o.usage.period === 'pilot' ? t('b2bAdmin.detail.usagePilot') : t('b2bAdmin.detail.usageMonth');

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ gap: space(1) }}>
        <Title>{o.name}</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          <Badge label={o.plan === 'pilot' && o.pilotExpired ? t('org.plan.pilotEndedBadge') : t(`org.plan.name.${o.plan}`)} tone={o.pilotExpired ? 'warning' : 'neutral'} />
          <Badge label={o.status === 'suspended' ? t('b2bAdmin.suspended') : t('b2bAdmin.active')} tone={o.status === 'suspended' ? 'danger' : 'success'} />
          <Badge label={t(`auth.market.${o.market}`)} />
        </View>
      </View>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('b2bAdmin.detail.planSection')}</SectionLabel>
        {o.plan === 'pilot' && <Line label={t('b2bAdmin.detail.pilotEnds')} value={formatDate(o.pilotEndsAt)} />}
        {o.plan !== 'pilot' && <Line label={t('b2bAdmin.detail.billingPeriod')} value={o.billingPeriod ? t(`b2bAdmin.period.${o.billingPeriod}`) : '—'} />}
        <Line label={t('b2bAdmin.detail.createdBy')} value={o.creatorEmail ?? '—'} />
        <Line label={t('b2bAdmin.detail.created')} value={formatDate(o.createdAt)} />
        <Line label={t('b2bAdmin.detail.lastActivity')} value={o.lastActivityAt ? formatDate(o.lastActivityAt) : '—'} />
        <View style={{ gap: space(2), marginTop: space(2) }}>
          <Chips options={ORGANIZATION_PLANS.map((p) => ({ value: p, label: t(`org.plan.name.${p}`) }))} value={plan} onChange={setPlan} />
          {plan !== 'pilot' && <Chips options={ORGANIZATION_BILLING_PERIODS.map((p) => ({ value: p, label: t(`b2bAdmin.period.${p}`) }))} value={period} onChange={setPeriod} />}
          <Button title={t('b2bAdmin.detail.savePlan')} onPress={() => void savePlan()} disabled={!planChanged || update.isPending} loading={update.isPending} />
          {o.plan === 'pilot' && (
            <Button variant="secondary" title={t('b2bAdmin.detail.extendPilot', { days: 14 })} onPress={() => update.mutate({ pilotEndsAt: extendedPilotEnd(o.pilotEndsAt, 14) })} disabled={update.isPending} />
          )}
          <Button variant="secondary" title={o.status === 'active' ? t('b2bAdmin.detail.suspend') : t('b2bAdmin.detail.reactivate')} onPress={() => void toggleStatus()} disabled={update.isPending} />
          <ErrorText error={update.error} />
        </View>
      </Card>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{periodLabel}</SectionLabel>
        <Line label={t('b2bAdmin.stats.courseUploads')} value={t('b2bAdmin.detail.ofLimit', { used: n(o.usage.coursesThisMonth), max: n(o.limits.coursesPerMonth) })} />
        <Line label={t('b2bAdmin.stats.draftsGenerated')} value={t('b2bAdmin.detail.ofLimit', { used: n(o.usage.itemsThisMonth), max: n(o.limits.itemsPerMonth) })} />
        <Line label={t('b2bAdmin.stats.aiCost')} value={formatMicroUsd(o.usage.aiCostMicroUsdThisMonth)} />
        <Line label={t('b2bAdmin.detail.members')} value={n(o.counts.members)} />
        <Line label={t('b2bAdmin.detail.seats')} value={n(o.limits.maxMembers)} />
        <Line label={t('b2bAdmin.stats.courses')} value={n(o.counts.courses)} />
        <Line label={t('b2bAdmin.stats.drafts')} value={n(o.counts.drafts)} />
        <Line label={t('b2bAdmin.stats.approved')} value={n(o.counts.approved)} />
        <Line label={t('b2bAdmin.stats.failedCourses')} value={n(o.failedCourses)} />
        <Line label={t('b2bAdmin.stats.aiErrors30')} value={n(o.aiErrorsLast30Days)} />
      </Card>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('b2bAdmin.detail.members')}</SectionLabel>
        {o.members.map((m) => (
          <Line key={m.userId} label={`${m.name} · ${m.email}${m.emailVerified ? '' : ` · ${t('b2bAdmin.unverified')}`}`} value={t(`org.roles.${m.role}`)} />
        ))}
      </Card>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('b2bAdmin.detail.courses')}</SectionLabel>
        {o.courses.length === 0 && <Body muted>{t('b2bAdmin.detail.noCourses')}</Body>}
        {o.courses.map((c) => (
          <Line
            key={c.id}
            label={`${c.title} · ${formatDate(c.createdAt)}${c.pageCount ? ` · ${t('b2bAdmin.detail.pages', { count: c.pageCount })}` : ''}`}
            value={c.status === 'failed' ? `${t('b2bAdmin.detail.failed')}${c.errorCode ? ` (${c.errorCode})` : ''}` : t(`b2bAdmin.courseStatus.${c.status === 'ready' ? 'ready' : 'processing'}`)}
          />
        ))}
      </Card>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('b2bAdmin.detail.activity')}</SectionLabel>
        {o.activity.length === 0 && <Body muted>{t('b2bAdmin.detail.noActivity')}</Body>}
        {o.activity.map((a, i) => (
          <Line key={`${a.at}-${i}`} label={`${formatDate(a.at)} · ${a.userEmail ?? t('b2bAdmin.detail.deletedUser')}`} value={t(`b2bAdmin.kind.${a.kind === 'course_upload' ? 'course_upload' : 'bank_items'}`, { count: a.amount })} />
        ))}
      </Card>

      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('b2bAdmin.detail.aiErrors')}</SectionLabel>
        {o.aiErrors.length === 0 && <Body muted style={{ color: colors.success }}>{t('b2bAdmin.detail.noAiErrors')}</Body>}
        {o.aiErrors.map((e, i) => (
          <Line key={`${e.at}-${i}`} label={`${formatDate(e.at)} · ${e.feature}`} value={e.errorCode ?? '—'} />
        ))}
      </Card>
    </Screen>
  );
}
