import type { MockState } from '@study/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorState, ErrorText, ListRow, Loading, ProgressBar, Screen, SectionLabel, space, TextButton, Title } from '@/components/ui';
import { appVersion, isReleaseBuild } from '@/config/app-config';
import { NATIVE_NAMES } from '@/i18n/languages';
import { ReminderSettingsCard } from '@/components/reminders';
import { ManageBillingButton } from '@/components/web-billing';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, openManageSubscriptions, openPaywall, planSummary, useCatalog, useEntitlement } from '@/lib/billing';
import { hasWebSubscription, isStoreProvider, storeName } from '@/lib/store';
import { confirm } from '@/lib/confirm';
import { usePreferences } from '@/lib/preferences';

const TEST_STATES: { state: MockState; key: `account.test${string}` }[] = [
  { state: 'free', key: 'account.testFree' },
  { state: 'trial', key: 'account.testTrial' },
  { state: 'basic_monthly', key: 'account.testBasicMonthly' },
  { state: 'basic_yearly', key: 'account.testBasicYearly' },
  { state: 'student_monthly', key: 'account.testStudentMonthly' },
  { state: 'student_yearly', key: 'account.testStudentAnnual' },
  { state: 'pro_monthly', key: 'account.testProMonthly' },
  { state: 'pro_yearly', key: 'account.testProAnnual' },
  { state: 'expired', key: 'account.testExpired' },
];

export default function Account() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { appLanguage, aiLanguagePref } = usePreferences();
  const qc = useQueryClient();
  const entitlement = useEntitlement();
  const catalog = useCatalog();
  const onEntitlement = { onSuccess: (next: Awaited<ReturnType<typeof api.getEntitlement>>) => qc.setQueryData(['entitlement'], next) };

  const cancel = useMutation({ mutationFn: api.cancelSubscription, ...onEntitlement });
  const resume = useMutation({ mutationFn: api.restorePurchases, ...onEntitlement });
  const setState = useMutation({ mutationFn: api.setMockBillingState, ...onEntitlement });

  const askSignOut = async () => {
    if (await confirm({ title: t('account.signOutTitle'), message: t('account.signOutMessage'), confirmText: t('account.signOut') })) await signOut();
  };
  const askCancel = async () => {
    if (await confirm({ title: t('account.cancelTitle'), message: t('account.cancelMessage'), confirmText: t('account.cancelSubscription'), destructive: true })) {
      cancel.mutate();
    }
  };

  if (entitlement.isLoading) return <Loading />;
  const e = entitlement.data;
  if (!e) {
    return (
      <Screen>
        <ErrorState error={entitlement.error} onRetry={() => entitlement.refetch()} />
      </Screen>
    );
  }
  // Development tools only exist when the server runs the mock provider AND this is a dev build.
  const devTools = !!catalog.data?.testMode && !isReleaseBuild;
  const mock = e.provider === 'mock';
  const u = e.usage;
  const l = e.limits;
  const freeLecture = e.lectureAllowance === 'once';
  const aiLabel =
    aiLanguagePref === 'app'
      ? t('language.currentSameAsApp', { language: NATIVE_NAMES[appLanguage] })
      : aiLanguagePref === 'source'
        ? t('language.sameAsMaterial')
        : NATIVE_NAMES[aiLanguagePref];

  return (
    <Screen onRefresh={() => entitlement.refetch()} refreshing={entitlement.isRefetching}>
      <View style={{ gap: space(1) }}>
        <Title>{user?.name}</Title>
        <Body muted>{user?.email}</Body>
      </View>

      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('account.plan')}</SectionLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{planSummary(e)}</Text>
          {e.status === 'trialing' && <Badge label={t('account.badgeTrial')} tone="success" />}
          {e.status === 'cancelled' && <Badge label={t('account.badgeWontRenew')} tone="warning" />}
          {e.status === 'expired' && <Badge label={t('account.badgeExpired')} tone="danger" />}
        </View>
        {e.status === 'cancelled' && (
          <Body muted>{t(e.tier === 'trial' ? 'account.cancelledTrial' : 'account.cancelledPlan', { date: formatDate(e.currentPeriodEndsAt) })}</Body>
        )}
        {e.trialEnded && <Body muted>{t('account.trialEnded')}</Body>}
        {/* A web subscription converts by itself and is changed in the Customer Portal (below), so no plan button here. */}
        {e.status !== 'complimentary' && !hasWebSubscription(e) && (
          <Button
            variant={e.isPremium ? 'secondary' : 'primary'}
            title={
              e.isPremium
                ? t('account.changePlan')
                : e.tier === 'trial'
                  ? t('account.subscribeNow')
                  : e.trialEligible
                    ? t('account.startTrial', { days: catalog.data?.trialDays ?? 7 })
                    : t('account.upgrade')
            }
            onPress={() => openPaywall(e.trialEnded ? 'trial_ended' : 'account')}
          />
        )}
        {/* Store subscriptions are cancelled/changed in the App Store or Google Play, never inside the app. */}
        {isStoreProvider(e.provider) && (
          <>
            <TextButton title={t('account.manageSubscription')} onPress={() => openManageSubscriptions(e.provider, e.planId)} />
            <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('account.manageHint', { store: storeName(e.provider) })}</Body>
          </>
        )}
        {/* Web subscriptions (Stripe): managed in Stripe's Customer Portal, reachable on the web only. The iOS/Android apps just say where it is managed. */}
        {e.provider === 'stripe' &&
          (Platform.OS === 'web' ? (
            <>
              <ManageBillingButton />
              <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('account.manageBillingHint')}</Body>
            </>
          ) : (
            <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('account.managedOnWebHint')}</Body>
          ))}
        {devTools && mock && e.willRenew && e.status !== 'complimentary' && (
          <TextButton title={e.tier === 'trial' ? t('account.cancelTrial') : t('account.cancelSubscription')} tone="danger" onPress={askCancel} disabled={cancel.isPending} />
        )}
        {devTools && mock && e.status === 'cancelled' && <TextButton title={t('account.resume')} onPress={() => resume.mutate()} disabled={resume.isPending} />}
        <ErrorText error={cancel.error ?? resume.error} />
      </Card>

      <Card style={{ gap: space(3) }}>
        <SectionLabel>{e.usagePeriod === 'trial' ? t('account.usageTrial') : t('account.usageMonth')}</SectionLabel>
        <UsageRow label={t('account.usageCourses')} used={u.courses} limit={l.courses} />
        <UsageRow label={t('account.usageExams')} used={u.examGenerationsThisMonth} limit={l.examGenerationsPerMonth} />
        {e.usagePeriod === 'trial' && <Body muted style={{ fontSize: 13, marginTop: -space(1.5) }}>{t('account.usagePerExam', { count: l.maxQuestionsPerExam })}</Body>}
        <UsageRow label={t('account.usagePractice')} used={u.practiceQuestionsThisMonth} limit={l.practiceQuestionsPerMonth} />
        <UsageRow label={t('account.usageUploads')} used={u.courseUploadsThisMonth} limit={l.courseUploadsPerMonth} />
        <UsageRow label={t('account.usagePlans')} used={u.studyPlansThisMonth} limit={l.studyPlansPerMonth} />
        {/* Free: one lecture per account (counted over the account's whole history, never renewed). */}
        <UsageRow label={freeLecture ? t('account.usageFreeLecture') : t('account.usageLectures')} used={u.mediaUploadsThisMonth} limit={l.mediaUploadsPerMonth} />
        <UsageRow label={freeLecture ? t('account.usageFreeLectureMinutes') : t('account.usageLectureMinutes')} used={u.mediaMinutesThisMonth} limit={l.mediaMinutesPerMonth} />
        {freeLecture && <Body muted style={{ fontSize: 13, marginTop: -space(1.5) }}>{t('account.freeLectureNote')}</Body>}
        <Body muted style={{ fontSize: 13 }}>
          {e.usagePeriod === 'trial' ? t('account.trialTotals', { date: formatDate(e.usageResetsAt) }) : t('account.resetsOn', { date: formatDate(e.usageResetsAt) })}
        </Body>
      </Card>

      <ReminderSettingsCard />

      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('account.settings')}</SectionLabel>
        <ListRow label={t('account.appLanguage')} value={NATIVE_NAMES[appLanguage]} onPress={() => router.push('/language')} />
        <ListRow label={t('account.studyLanguage')} value={aiLabel} onPress={() => router.push('/language')} last />
      </Card>

      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('account.helpLegal')}</SectionLabel>
        <ListRow label={t('nav.support')} onPress={() => router.push('/support')} />
        <ListRow label={t('nav.privacy')} onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} />
        <ListRow label={t('nav.terms')} onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} last />
      </Card>

      {devTools && (
        <Card style={{ gap: space(3), borderColor: colors.warning }}>
          <SectionLabel>{t('account.testTitle')}</SectionLabel>
          <Body muted style={{ fontSize: 14 }}>{t('account.testBody')}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {TEST_STATES.map(({ state, key }) => (
              <Pressable
                key={state}
                onPress={() => setState.mutate(state)}
                disabled={setState.isPending}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: space(3),
                  paddingVertical: space(2),
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{t(key as 'account.testFree')}</Text>
              </Pressable>
            ))}
          </View>
          <ErrorText error={setState.error} />
        </Card>
      )}

      <Button variant="secondary" title={t('account.signOut')} onPress={askSignOut} />
      <TextButton title={t('account.deleteAccount')} tone="danger" onPress={() => router.push('/delete-account')} />
      <Body muted style={{ fontSize: 12, textAlign: 'center' }}>{t('account.version', { version: appVersion })}</Body>
    </Screen>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 15, fontWeight: '600' }}>
          {limit === null ? t('account.usageUnlimited', { used }) : limit === 0 ? t('account.notIncluded') : t('account.usageOf', { used, limit })}
        </Text>
      </View>
      {limit !== null && limit > 0 && <ProgressBar value={limit === 0 ? 1 : used / limit} color={used >= limit ? colors.warning : colors.primary} />}
    </View>
  );
}
