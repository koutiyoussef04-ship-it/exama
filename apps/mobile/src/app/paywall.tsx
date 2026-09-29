import { isRtlLanguage, PAID_TIERS, RECOMMENDED_PLAN_ID, planById, type BillingPeriod, type Entitlement, type PaidTier, type PaywallTrigger, type Plan } from '@study/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorState, ErrorText, Loading, Screen, space, TextButton, Title } from '@/components/ui';
import { isReleaseBuild, storeLinks } from '@/config/app-config';
import { platform, track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPrice, monthlyEquivalent, openManageSubscriptions, tierName, trialAllowance, trialLecture, useCatalog, useEntitlement, useStorePrices } from '@/lib/billing';
import { getStoreClient, isStoreProvider, storeName } from '@/lib/store';

const LECTURE_TRIGGERS: PaywallTrigger[] = ['free_lecture_used', 'locked_lectures'];

/** Headline + subline by what the student was doing: weak topics / lectures → Student; more usage → Pro. */
function upgradeContext(trigger: PaywallTrigger, tier: Entitlement['tier'], t: TFunction) {
  if (trigger === 'locked_weak_topics') return { headline: t('paywall.headlineWeakTopics'), subline: t('paywall.sublineWeakTopics') };
  if (trigger === 'free_lecture_used' || trigger === 'locked_lectures' || trigger === 'limit_media_length')
    return { headline: t('paywall.headlineLectures'), subline: t('paywall.sublineLectures') };
  if (tier === 'student' && trigger.startsWith('limit_')) return { headline: t('paywall.headlineMoreUsage'), subline: t('paywall.sublineMoreUsage') };
  return { headline: t('paywall.headlineDefault'), subline: t('paywall.sublineDefault') };
}

export default function Paywall() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ trigger?: PaywallTrigger; message?: string }>();
  const trigger: PaywallTrigger = params.trigger ?? 'account';
  const qc = useQueryClient();
  const catalog = useCatalog();
  const entitlement = useEntitlement();
  // Pre-selected: the recommended plan (Student monthly), unless the user already has a paid plan.
  const current = planById(entitlement.data?.isPremium && entitlement.data.planId ? entitlement.data.planId : (catalog.data?.recommendedPlanId ?? RECOMMENDED_PLAN_ID));
  // Asked for lectures (free lecture used, or audio/video on Basic): Student, the first plan with them.
  const initial =
    current.tier === 'basic' && (LECTURE_TRIGGERS.includes(trigger) || trigger === 'locked_weak_topics' || trigger.startsWith('limit_'))
      ? planById(`student_${current.period}`) // Basic asking for more: Student is the next step
      : entitlement.data?.tier === 'student' && trigger.startsWith('limit_')
        ? planById(`pro_${current.period}`) // a Student at a limit: Pro is what gives more
        : current;
  const [period, setPeriod] = useState<BillingPeriod>(initial.period);
  const [tier, setTier] = useState<PaidTier>(initial.tier);

  useEffect(() => {
    track('paywall_viewed', { platform, trigger });
  }, [trigger]);

  const plan = useMemo(() => catalog.data?.plans.find((p) => p.tier === tier && p.period === period), [catalog.data, tier, period]);
  const store = getStoreClient(catalog.data?.provider ?? null);
  const storePrices = useStorePrices(store, catalog.data?.plans).data;

  const select = (tr: PaidTier, p: BillingPeriod) => {
    setTier(tr);
    setPeriod(p);
    track('plan_selected', { platform, plan_id: planById(`${tr}_${p}`).id, tier: tr, period: p, trigger });
  };

  const e = entitlement.data;
  const withTrial = !!e?.trialEligible && !e?.isPremium;

  const buy = useMutation({
    mutationFn: async () => {
      track('upgrade_started', { platform, plan_id: plan!.id, tier: plan!.tier, period: plan!.period, with_trial: withTrial, trigger });
      return store!.purchase(plan!, { withTrial, userId: user!.id });
    },
    onSuccess: (next) => {
      qc.setQueryData(['entitlement'], next);
      router.back();
    },
  });
  const restore = useMutation({
    mutationFn: () => store!.restore(),
    onSuccess: (next) => {
      qc.setQueryData(['entitlement'], next);
      router.back();
    },
  });
  // Closing the store sheet isn't an error; a pending payment is shown but refreshes access later.
  const shownError = [buy.error, restore.error].find((err) => err && (err as { code?: string }).code !== 'purchase_cancelled') ?? null;
  useEffect(() => {
    const code = (buy.error as { code?: string } | null)?.code;
    if (code === 'purchase_pending' || code === 'subscribed_elsewhere') void qc.invalidateQueries({ queryKey: ['entitlement'] });
  }, [buy.error, qc]);

  if (catalog.isLoading || entitlement.isLoading) return <Loading />;
  if (!catalog.data || !e) {
    return (
      <Screen>
        <ErrorState error={catalog.error ?? entitlement.error} onRetry={() => (catalog.refetch(), entitlement.refetch())} />
      </Screen>
    );
  }

  if (e.status === 'complimentary') {
    return (
      <Screen>
        <Title>{t('paywall.fullAccessTitle')}</Title>
        <Body muted>{t('paywall.fullAccessBody')}</Body>
        <Button title={t('common.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const { plans, trialDays, testMode, limits, provider } = catalog.data;
  const purchasesAvailable = catalog.data.purchasesAvailable && !!store;
  // Store name for the renewal fine print: the store selling here (mock: this device's store).
  const sellingStore = storeName(provider, Platform.OS);
  // A live subscription billed by the OTHER store (e.g. bought on iPhone, now on Android or web):
  // it already works here; buying again would charge twice, so point to where it's managed.
  const managedElsewhere = e.isPremium && isStoreProvider(e.provider) && e.provider !== provider;
  /** The store's localized price when available (required by the stores), else the list price. */
  const price = (p: Plan) => storePrices?.[p.id] ?? formatPrice(p.priceCents);
  const find = (tr: PaidTier, p: BillingPeriod) => plans.find((x) => x.tier === tr && x.period === p)!;
  // Yearly saving from the catalog's reference prices (store prices keep the same ratio closely enough).
  const saving = (tr: PaidTier) => {
    const m = find(tr, 'monthly').priceCents * 12;
    return Math.round(((m - find(tr, 'yearly').priceCents) / m) * 100);
  };
  const isCurrent = e.isPremium && e.planId === plan?.id && e.status !== 'cancelled';
  const onTrial = e.tier === 'trial';
  const per = (p: Plan) => (p.period === 'yearly' ? t('paywall.perYear') : t('paywall.perMonth'));

  // What the student gains, for what they just tried to do (never just "locked").
  const context = upgradeContext(trigger, e.tier, t);

  // Never promise "unlimited": plans have generous but finite AI allowances.
  const headline = onTrial
    ? params.message
      ? t('paywall.headlineTrialLimit')
      : t('paywall.headlineKeepStudying')
    : e.trialEnded
      ? t('paywall.headlineTrialEnded')
      : context.headline;
  const subline = onTrial
    ? params.message
      ? t('paywall.sublineKept', { message: params.message })
      : t('paywall.sublineTrialEnds', { date: formatDate(e.trialEndsAt) })
    : e.trialEnded
      ? [params.message, t('paywall.sublineTrialEnded')].filter(Boolean).join(' ')
      : (params.message ?? context.subline);

  const cta = !plan
    ? ''
    : isCurrent
      ? t('paywall.ctaCurrent')
      : withTrial
        ? t('paywall.ctaTrial', { days: trialDays })
        : e.isPremium
          ? t(plan.period === 'yearly' ? 'paywall.ctaSwitchYearly' : 'paywall.ctaSwitchMonthly', { plan: tierName(plan.tier) })
          : t('paywall.ctaSubscribe', { price: price(plan), per: per(plan) });

  /**
   * What each plan includes — built from the server's features and limits for the tier, so the
   * comparison can never promise more than the API allows. `off` lines are shown struck/muted.
   */
  const features = (tr: PaidTier): { text: string; off?: boolean }[] => {
    const l = limits[tr];
    const f = catalog.data.features[tr];
    return [
      { text: tr === 'basic' ? t('paywall.featureDocs') : tr === 'student' ? t('paywall.featureEverythingBasic') : t('paywall.featureEverythingStudent') },
      f.lectures
        ? { text: t('paywall.featureLectures', { minutes: l.mediaMinutesPerMonth ?? 0, length: l.maxMediaMinutesPerFile }) }
        : { text: t('paywall.featureNoLectures'), off: true },
      ...(f.adaptivePlanner ? [{ text: t('paywall.featureAdaptivePlanner') }] : tr === 'basic' ? [{ text: t('paywall.featureBasicPlanner') }] : []),
      ...(f.weakTopicAnalysis && tr === 'student' ? [{ text: t('paywall.featureWeakTopics') }] : []),
      { text: t('paywall.featureCourses', { count: l.courses ?? 0 }) },
      { text: t('paywall.featureExams', { count: l.examGenerationsPerMonth ?? 0 }) },
      { text: t('paywall.featurePracticeCount', { count: l.practiceQuestionsPerMonth ?? 0 }) },
      ...(tr === 'pro' ? [{ text: t('paywall.featureHighestAi') }] : []),
    ];
  };
  const tierCopy: Record<PaidTier, { title: string; tagline: string }> = {
    basic: { title: t('paywall.basicTitle'), tagline: t('paywall.basicTagline') },
    student: { title: t('paywall.studentTitle'), tagline: t('paywall.studentTagline') },
    pro: { title: t('paywall.proTitle'), tagline: t('paywall.proTagline') },
  };
  const recommendedTier = planById(catalog.data.recommendedPlanId).tier;
  const tl = limits.trial;

  return (
    <Screen>
      {/* Mock purchases exist only in development; release builds never show this. */}
      {testMode && !isReleaseBuild && (
        <View style={{ backgroundColor: colors.warningSoft, borderRadius: 10, padding: space(3) }}>
          <Text style={{ color: colors.warning, fontWeight: '700' }}>{t('paywall.testMode')}</Text>
        </View>
      )}

      {withTrial ? (
        <View style={{ gap: space(2.5) }}>
          {!!params.message && <Body muted>{params.message}</Body>}
          <Title style={{ fontSize: 26, lineHeight: 32 }}>{t('paywall.trialTitle', { days: trialDays })}</Title>
          <Body>{t('paywall.trialSubtitle', { days: trialDays })}</Body>
          <View style={{ backgroundColor: colors.successSoft, borderRadius: 12, padding: space(3.5), gap: 2 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{t('paywall.trialIncluded', { allowance: trialAllowance(tl) })}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{t('paywall.subscribeAnytime')}</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: space(2) }}>
          <Title style={{ fontSize: 26, lineHeight: 32 }}>{headline}</Title>
          <Body muted>{subline}</Body>
        </View>
      )}

      {/* Monthly / yearly */}
      <View style={{ flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, padding: 4 }} accessibilityRole="tablist">
        {(['monthly', 'yearly'] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="tab"
            accessibilityState={{ selected: period === p }}
            onPress={() => select(tier, p)}
            style={{ flex: 1, paddingVertical: space(2.5), paddingHorizontal: space(1), borderRadius: 9, alignItems: 'center', backgroundColor: period === p ? colors.card : 'transparent' }}
          >
            <Text style={{ fontWeight: '700', color: period === p ? colors.text : colors.muted, textAlign: 'center' }}>
              {p === 'yearly' ? t('paywall.yearlySave', { pct: Math.max(...PAID_TIERS.map(saving)) }) : t('paywall.monthly')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Three paid choices: Basic (PDFs + PowerPoints) · Student (recommended) · Pro (maximum AI usage). */}
      {PAID_TIERS.map((tr) => {
        const p = find(tr, period);
        const selected = tier === tr;
        const recommended = tr === recommendedTier;
        return (
          <Pressable key={tr} onPress={() => select(tr, period)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${tierCopy[tr].title}, ${tierCopy[tr].tagline}, ${price(p)}${per(p)}`}>
            <Card
              style={{
                borderWidth: 2,
                borderColor: selected ? colors.primary : recommended ? colors.primarySoft : colors.border,
                gap: space(2),
                ...(selected ? {} : { paddingVertical: space(3.5) }),
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space(2) }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text }}>{tierCopy[tr].title}</Text>
                  <Text style={{ color: recommended ? colors.primary : colors.muted, fontWeight: recommended ? '600' : '400' }}>{tierCopy[tr].tagline}</Text>
                </View>
                {recommended ? (
                  <Badge label={t('paywall.recommended')} tone="primary" />
                ) : tr === 'pro' ? (
                  <Badge label={t('paywall.mostAi')} tone="neutral" />
                ) : period === 'yearly' ? (
                  <Badge label={t('paywall.save', { pct: saving(tr) })} tone="success" />
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(1.5), flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{price(p)}</Text>
                <Text style={{ color: colors.muted }}>{per(p)}</Text>
                {period === 'yearly' && !storePrices?.[p.id] && <Text style={{ color: colors.muted }}>· {t('paywall.perMonthShort', { price: formatPrice(monthlyEquivalent(p)) })}</Text>}
              </View>
              {/* The selected plan shows everything; the others a short summary, so the three fit on a phone. */}
              {(selected ? features(tr) : features(tr).slice(0, 3)).map((f) => (
                <Text key={f.text} style={{ color: f.off ? colors.muted : colors.text, fontSize: 15 }}>
                  {f.off ? '✕' : '✓'} {f.text}
                </Text>
              ))}
              {e.isPremium && e.planId === p.id && <Badge label={e.status === 'cancelled' ? t('paywall.currentPlanCancelled') : t('paywall.currentPlan')} tone="neutral" />}
            </Card>
          </Pressable>
        );
      })}
      {withTrial && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('paywall.trialAllPlans')}</Body>}

      {managedElsewhere ? (
        <Card style={{ gap: space(2) }}>
          <Body style={{ fontWeight: '600' }}>{t('paywall.managedElsewhereTitle', { store: storeName(e.provider) })}</Body>
          <Body muted>{t('paywall.managedElsewhereBody', { store: storeName(e.provider) })}</Body>
          {Platform.OS !== 'web' && <TextButton title={t('account.manageSubscription')} onPress={() => openManageSubscriptions(e.provider, e.planId)} />}
        </Card>
      ) : purchasesAvailable ? (
        <>
          <Button title={cta} onPress={() => buy.mutate()} loading={buy.isPending} disabled={!plan || isCurrent} />
          {plan && withTrial && (
            <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
              {t('paywall.finePrintTrial', {
                days: trialDays,
                price: price(plan),
                per: per(plan),
                date: formatDate(new Date(Date.now() + trialDays * 86_400_000).toISOString()),
                courses: t('paywall.courses', { count: tl.courses ?? 0 }),
                exams: t('paywall.exams', { count: tl.examGenerationsPerMonth ?? 0 }),
                length: tl.maxQuestionsPerExam,
                practice: t('paywall.practice', { count: tl.practiceQuestionsPerMonth ?? 0 }),
                lecture: trialLecture(tl),
              })}
            </Body>
          )}
          {plan && onTrial && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('paywall.finePrintConvert', { plan: tierName(plan.tier) })}</Body>}
          <Body muted style={{ fontSize: 12, textAlign: 'center' }}>{t('paywall.finePrintRenew', { store: sellingStore })}</Body>
          <ErrorText error={shownError} />
          <TextButton title={restore.isPending ? t('paywall.restoring') : t('paywall.restore')} tone="muted" onPress={() => restore.mutate()} disabled={restore.isPending} />
        </>
      ) : (
        <Card>
          {Platform.OS === 'web' ? (
            // No purchases on the web: subscriptions are bought in the iOS/Android app and work here too.
            <WebStorePath />
          ) : catalog.data.purchasesAvailable ? (
            // The server sells here but this build can't reach the store (Expo Go / no native module).
            <>
              <Body style={{ fontWeight: '600' }}>{t('paywall.storeUnavailableTitle')}</Body>
              <Body muted>{t('paywall.storeUnavailableBody')}</Body>
            </>
          ) : (
            <>
              <Body style={{ fontWeight: '600' }}>{t('paywall.comingSoonTitle')}</Body>
              <Body muted>{t('paywall.comingSoonBody')}</Body>
            </>
          )}
        </Card>
      )}

      {/* Required for auto-renewing subscriptions (App Store Review Guideline 3.1.2; Google Play subscriptions policy). */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space(4), flexWrap: 'wrap' }}>
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }}>
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline' }}>{t('nav.terms')}</Text>
        </Link>
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }}>
          <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: 'underline' }}>{t('nav.privacy')}</Text>
        </Link>
      </View>
      <TextButton title={t('common.notNow')} tone="muted" onPress={() => router.back()} />
    </Screen>
  );
}

/**
 * Web: no purchases here (no fake web checkout). Explain the path through the stores and link to
 * the listings: Google Play's URL follows from the package name; the App Store's needs the app's id
 * (EXPO_PUBLIC_APP_STORE_URL) — without it, the student is told what to search for.
 */
function WebStorePath() {
  const { t, i18n } = useTranslation();
  const link = { color: colors.primary, fontWeight: '700' as const, fontSize: 15 };
  return (
    <View style={{ gap: space(2) }}>
      <Body style={{ fontWeight: '600' }}>{t('paywall.webTitle')}</Body>
      <Body muted>{t('paywall.webBody')}</Body>
      <Body muted style={{ fontSize: 14 }}>{t('paywall.webSteps', { path: [t('nav.account'), t('account.upgrade')].join(isRtlLanguage(i18n.language) ? ' ← ' : ' → ') })}</Body>
      {storeLinks.appStore ? (
        <Text accessibilityRole="link" style={link} onPress={() => void Linking.openURL(storeLinks.appStore!)}>
          {t('paywall.webIphone')} {t('common.chevron')}
        </Text>
      ) : (
        <Body muted style={{ fontSize: 14 }}>{t('paywall.webSearchApple')}</Body>
      )}
      {storeLinks.googlePlay ? (
        <Text accessibilityRole="link" style={link} onPress={() => void Linking.openURL(storeLinks.googlePlay!)}>
          {t('paywall.webAndroid')} {t('common.chevron')}
        </Text>
      ) : (
        <Body muted style={{ fontSize: 14 }}>{t('paywall.webSearchGoogle')}</Body>
      )}
    </View>
  );
}
