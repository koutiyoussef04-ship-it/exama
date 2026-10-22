/**
 * Account screen of an ORGANIZATION account: the organization's plan (no plan, a pilot granted by Exama, or a paid
 * plan) with its usage, and the plans for organizations — Esencial, Profesional, Centro — instead of the student
 * plans. There is no checkout: an admin requests a plan by email and Exama activates it (b2b-admin). Prices and
 * allowances come from ORGANIZATION_PLAN_CATALOG (shared with the website and the owner dashboard).
 */
import type { OrganizationBillingPeriod, OrganizationOverview, OrganizationPaidPlan } from '@study/shared';
import { ORGANIZATION_PLAN_CATALOG } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorState, Loading, ProgressBar, SectionLabel, space } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatNumber, formatWholePrice } from '@/lib/billing';
import { canAdmin, useCurrentOrg } from '@/lib/org';
import { isCurrentOrgPlan, ORG_PLAN_CHOICES, orgMaxYearlySavingPct, orgPlanPrice, orgPlanRequestMailto, orgYearlySavingPct } from '@/lib/org-plans';
import { copyText, SUPPORT_EMAIL } from '@/lib/support';

export function OrganizationAccountPlans() {
  const { t } = useTranslation();
  const { org, orgs, ready } = useCurrentOrg();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId((id) => id ?? org?.id ?? null), [org?.id]);
  const selected = orgs.find((o) => o.id === selectedId) ?? org;
  const overview = useQuery({
    queryKey: ['org', selected?.id, 'overview'],
    queryFn: () => api.orgOverview(selected!.id),
    enabled: !!selected,
  });

  if (!ready) return <Loading />;
  return (
    <>
      {orgs.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }} accessibilityRole="tablist">
          {orgs.map((o) => (
            <Pressable
              key={o.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: o.id === selected?.id }}
              onPress={() => setSelectedId(o.id)}
              style={{
                paddingHorizontal: space(3),
                paddingVertical: space(2),
                borderRadius: 999,
                borderWidth: 1,
                borderColor: o.id === selected?.id ? colors.primary : colors.border,
                backgroundColor: o.id === selected?.id ? colors.primarySoft : colors.card,
              }}
            >
              <Text style={{ color: o.id === selected?.id ? colors.primary : colors.text, fontWeight: '600' }}>{o.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!selected ? (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('account.plan')}</SectionLabel>
          <Body muted>{t('orgAccount.noOrganization')}</Body>
          <Button title={t('org.dashboard.create')} onPress={() => router.push('/org/new')} />
        </Card>
      ) : overview.isLoading ? (
        <Loading />
      ) : overview.data ? (
        <CurrentPlanCard o={overview.data} />
      ) : (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      )}

      <OrganizationPlans
        orgName={selected?.name ?? null}
        current={overview.data ?? null}
        // A plan is chosen for the whole organization: only its admins request one (or anyone before it exists).
        canRequest={!selected || canAdmin(selected.role)}
      />
    </>
  );
}

/** The organization's plan today: what Exama has activated, and this month's (or the pilot's) usage. */
function CurrentPlanCard({ o }: { o: OrganizationOverview }) {
  const { t } = useTranslation();
  const u = o.usage;
  const l = o.limits;
  return (
    <Card style={{ gap: space(3), ...(o.plan === 'none' || o.pilotExpired ? { borderColor: colors.warning } : {}) }}>
      <SectionLabel>{t('orgAccount.planFor', { name: o.name })}</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>
          {o.plan === 'none' ? t('org.plan.noPlanBadge') : t(`org.plan.name.${o.plan}`)}
        </Text>
        {o.plan === 'pilot' && o.pilotExpired && <Badge label={t('org.plan.pilotEndedBadge')} tone="warning" />}
        {o.status === 'suspended' && <Badge label={t('org.dashboard.suspendedBadge')} tone="warning" />}
      </View>
      {o.plan === 'none' && <Body muted>{t('org.plan.noPlan')}</Body>}
      {o.plan === 'pilot' && o.pilotEndsAt && (
        <Body muted>{o.pilotExpired ? t('org.plan.pilotEnded', { date: formatDate(o.pilotEndsAt) }) : t('org.plan.pilotActive', { date: formatDate(o.pilotEndsAt) })}</Body>
      )}
      {(o.plan === 'esencial' || o.plan === 'profesional' || o.plan === 'centro') && (
        <Body muted>{o.billingPeriod ? t(`orgAccount.billed.${o.billingPeriod}`) : t('orgAccount.activatedByExama')}</Body>
      )}
      {o.plan !== 'none' && (
        <>
          <SectionLabel>{t(u.period === 'pilot' ? 'org.plan.usagePilot' : 'org.dashboard.usage')}</SectionLabel>
          <Usage label={t('org.dashboard.usageCourses')} used={u.coursesThisMonth} limit={l.coursesPerMonth} />
          <Usage label={t('org.dashboard.usageItems')} used={u.itemsThisMonth} limit={l.itemsPerMonth} />
          <Body muted style={{ fontSize: 13 }}>{t('org.dashboard.perRequest', { count: l.maxItemsPerRequest })}</Body>
          <Body muted style={{ fontSize: 13 }}>{t('org.plan.seats', { max: l.maxMembers })}</Body>
        </>
      )}
      <Button variant="secondary" title={t('orgAccount.openWorkspace')} onPress={() => router.push({ pathname: '/org', params: { orgId: o.id } })} />
    </Card>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 15, fontWeight: '600' }}>{t('org.dashboard.usageOf', { used: formatNumber(used), limit: formatNumber(limit) })}</Text>
      </View>
      <ProgressBar value={limit > 0 ? used / limit : 1} color={used >= limit ? colors.warning : colors.primary} />
    </View>
  );
}

/** Esencial · Profesional · Centro, monthly or yearly, with "Request …" by email (admins only). */
function OrganizationPlans({ orgName, current, canRequest }: { orgName: string | null; current: OrganizationOverview | null; canRequest: boolean }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<OrganizationBillingPeriod>(current?.billingPeriod ?? 'monthly');
  const [noEmailApp, setNoEmailApp] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (current?.billingPeriod) setPeriod(current.billingPeriod);
  }, [current?.billingPeriod]);

  const request = (plan: OrganizationPaidPlan) => {
    setNoEmailApp(false);
    const name = t(`org.plan.name.${plan}`);
    const url = orgPlanRequestMailto(
      t('orgAccount.mail.subject', { plan: name }),
      t('orgAccount.mail.body', {
        plan: name,
        period: t(plan === 'centro' ? 'orgAccount.mail.periodCustom' : `orgAccount.mail.period.${period}`),
        org: orgName ?? t('orgAccount.mail.noOrganization'),
      }),
    );
    // Web: hand mailto: to the browser in this tab (as on the Support screen). The address stays on screen either way.
    const web = (globalThis as { location?: { assign?: (u: string) => void } }).location;
    if (Platform.OS === 'web' && typeof web?.assign === 'function') return web.assign(url);
    Linking.openURL(url).catch(() => setNoEmailApp(true));
  };
  const copyAddress = async () => setCopy((await copyText(SUPPORT_EMAIL)) ? 'copied' : 'failed');

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ gap: space(1) }}>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{t('orgAccount.plansTitle')}</Text>
        <Body muted>{t('orgAccount.plansLead')}</Body>
      </View>

      {/* Monthly / yearly */}
      <View style={{ flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, padding: 4 }} accessibilityRole="tablist">
        {(['monthly', 'yearly'] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === p }}
            onPress={() => setPeriod(p)}
            style={{ flex: 1, paddingVertical: space(2.5), paddingHorizontal: space(1), borderRadius: 9, alignItems: 'center', backgroundColor: period === p ? colors.card : 'transparent' }}
          >
            <Text style={{ fontWeight: '700', color: period === p ? colors.text : colors.muted, textAlign: 'center' }}>
              {p === 'yearly' ? t('orgAccount.yearly', { pct: orgMaxYearlySavingPct() }) : t('orgAccount.monthly')}
            </Text>
          </Pressable>
        ))}
      </View>

      {ORG_PLAN_CHOICES.map((plan) => {
        const price = orgPlanPrice(plan, period);
        const saving = orgYearlySavingPct(plan);
        const isCurrent = isCurrentOrgPlan(current, plan);
        const l = ORGANIZATION_PLAN_CATALOG[plan].limits;
        const features =
          plan === 'centro'
            ? [t('orgAccount.feature.customAllowances'), t('orgAccount.feature.customSeats'), t('orgAccount.feature.reviewers'), t('orgAccount.feature.export')]
            : [
                t('orgAccount.feature.courses', { count: l.coursesPerMonth, n: formatNumber(l.coursesPerMonth) }),
                t('orgAccount.feature.drafts', { count: l.itemsPerMonth, n: formatNumber(l.itemsPerMonth) }),
                t('orgAccount.feature.seats', { count: l.maxMembers, n: formatNumber(l.maxMembers) }),
                t('orgAccount.feature.reviewers'),
                t('orgAccount.feature.perRequest', { count: l.maxItemsPerRequest, n: formatNumber(l.maxItemsPerRequest) }),
                t('orgAccount.feature.export'),
              ];
        return (
          <Card key={plan} style={{ gap: space(2), borderWidth: 2, borderColor: isCurrent ? colors.primary : plan === 'profesional' ? colors.primarySoft : colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space(2) }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text }}>{t(`org.plan.name.${plan}`)}</Text>
                <Text style={{ color: colors.muted }}>{t(`orgAccount.tagline.${plan}`)}</Text>
              </View>
              {isCurrent ? (
                <Badge label={t('orgAccount.current')} tone="primary" />
              ) : period === 'yearly' && saving ? (
                <Badge label={t('orgAccount.save', { pct: saving })} tone="success" />
              ) : null}
            </View>
            {price !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(1.5), flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{formatWholePrice(price)}</Text>
                <Text style={{ color: colors.muted }}>{t(period === 'yearly' ? 'orgAccount.perYear' : 'orgAccount.perMonth')} {t('orgAccount.plusVat')}</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(1.5), flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{t('orgAccount.custom')}</Text>
                <Text style={{ color: colors.muted }}>{t('orgAccount.customSub')}</Text>
              </View>
            )}
            {features.map((f) => (
              <Text key={f} style={{ color: colors.text, fontSize: 15 }}>
                ✓ {f}
              </Text>
            ))}
            {!isCurrent && canRequest && (
              <Button variant={plan === 'profesional' ? 'primary' : 'secondary'} title={t(`orgAccount.request.${plan}`)} onPress={() => request(plan)} />
            )}
          </Card>
        );
      })}

      {!canRequest && <Body muted style={{ fontSize: 13 }}>{t('orgAccount.adminOnly')}</Body>}
      <Card style={{ gap: space(2) }}>
        <Body muted style={{ fontSize: 13 }}>{t('orgAccount.billingNote')}</Body>
        <Body muted style={{ fontSize: 13 }}>{t('orgAccount.vatNote')}</Body>
        <Body muted style={{ fontSize: 13 }}>{t('orgAccount.emailLead')}</Body>
        <Text selectable testID="org-plans-email" style={{ color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center', writingDirection: 'ltr' }}>
          {SUPPORT_EMAIL}
        </Text>
        {Platform.OS === 'web' && <Button variant="secondary" title={copy === 'copied' ? t('support.copied') : t('support.copyButton')} onPress={copyAddress} />}
        {copy === 'failed' && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('support.copyFailed')}</Body>}
        {noEmailApp && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('support.noEmailApp')}</Body>}
      </Card>
    </View>
  );
}
