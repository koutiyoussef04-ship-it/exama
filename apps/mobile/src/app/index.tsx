import { DOCUMENT_PICKER_TYPES, type DocumentSummary } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Card, Chevron, colors, EmptyState, ErrorState, ErrorText, Loading, Screen, space, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openPaywall, planSummary, remaining, useEntitlement } from '@/lib/billing';
import { courseCapReached, useCourseUpload } from '@/lib/courses';

const STATUS_TONE: Record<DocumentSummary['status'], 'primary' | 'success' | 'danger'> = {
  processing: 'primary',
  ready: 'success',
  failed: 'danger',
};

export default function Courses() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const entitlement = useEntitlement();
  const docs = useQuery({
    queryKey: ['documents'],
    queryFn: api.listDocuments,
    // Poll while anything is still being processed.
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'processing') ? 2000 : false),
  });

  const statusLabel = (s: DocumentSummary['status']) =>
    s === 'processing' ? t('home.statusProcessing') : s === 'ready' ? t('home.statusReady') : t('home.statusFailed');

  const upload = useCourseUpload();
  const hasDocs = !!docs.data?.length;
  const e = entitlement.data;
  const startUpload = () => {
    if (!courseCapReached(e)) upload.mutate(DOCUMENT_PICKER_TYPES);
  };

  const bannerDetail = () => {
    if (!e) return '';
    if (e.trialEnded) return t('banner.trialEndedDetail');
    const exams = remaining(e.limits.examGenerationsPerMonth, e.usage.examGenerationsThisMonth) ?? 0;
    if (e.usagePeriod === 'trial') {
      const practice = remaining(e.limits.practiceQuestionsPerMonth, e.usage.practiceQuestionsThisMonth) ?? 0;
      return t('banner.leftInTrial', { exams: t('banner.exams', { count: exams }), practice: t('banner.practice', { count: practice }) });
    }
    return `${t('banner.coursesUsed', { used: e.usage.courses, limit: e.limits.courses ?? '∞' })} · ${t('banner.examsLeftMonth', { count: exams })}`;
  };

  return (
    <Screen onRefresh={() => docs.refetch()} refreshing={docs.isRefetching}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/account')} hitSlop={12} accessibilityRole="button">
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{t('nav.account')}</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ gap: space(1) }}>
        <Title>{user?.name ? t('home.greeting', { name: user.name.split(' ')[0] }) : t('home.greetingNoName')}</Title>
        <Body muted>{hasDocs ? t('home.subtitleReturning') : t('home.subtitleNew')}</Body>
      </View>

      {/* One entry for everything a course learns from: PDF, PowerPoint, audio, video (the same selector as the course screen). */}
      {hasDocs ? (
        <Button title={t('home.addMaterial')} onPress={() => router.push('/add-material')} />
      ) : (
        <>
          <Button title={upload.isPending ? t('home.uploading') : t('home.upload')} onPress={startUpload} loading={upload.isPending} />
          <ErrorText error={upload.error} />
        </>
      )}

      {e && !e.isPremium && (
        <Pressable onPress={() => openPaywall(e.trialEnded ? 'trial_ended' : 'courses_banner')} accessibilityRole="button">
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{e.trialEnded ? t('banner.trialEnded') : planSummary(e)}</Text>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{bannerDetail()}</Text>
            </View>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>
              {e.trialEligible ? t('banner.tryFree') : e.tier === 'trial' || e.trialEnded ? t('banner.subscribe') : t('banner.upgrade')} {t('common.chevron')}
            </Text>
          </Card>
        </Pressable>
      )}

      {docs.isLoading ? (
        <Loading />
      ) : docs.error && !docs.data ? (
        <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
      ) : !hasDocs ? (
        <EmptyState title={t('home.howItWorks')}>
          <View style={{ gap: space(4), alignSelf: 'stretch', marginTop: space(1) }}>
            {(
              [
                ['1', t('home.step1Title'), t('home.step1Detail')],
                ['2', t('home.step2Title'), t('home.step2Detail')],
                ['3', t('home.step3Title'), t('home.step3Detail')],
              ] as const
            ).map(([n, title, detail]) => (
              <View key={n} style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start' }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{n}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Body style={{ fontWeight: '600' }}>{title}</Body>
                  <Body muted style={{ fontSize: 14, lineHeight: 20 }}>{detail}</Body>
                </View>
              </View>
            ))}
          </View>
        </EmptyState>
      ) : (
        docs.data!.map((d) => (
          <Link key={d.id} href={{ pathname: '/documents/[id]', params: { id: d.id } }} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={t('home.courseA11y', { title: d.title, status: statusLabel(d.status) })}>
              {({ pressed }) => (
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), opacity: pressed ? 0.7 : 1 }}>
                  <View style={{ flex: 1, gap: space(2) }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }} numberOfLines={2}>
                      {d.title}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
                      <Badge label={statusLabel(d.status)} tone={STATUS_TONE[d.status]} />
                      {d.status === 'processing' && <ActivityIndicator size="small" color={colors.primary} />}
                      {d.pageCount != null && <Text style={{ color: colors.muted, fontSize: 14 }}>{t(d.format === 'pptx' ? 'home.slides' : 'home.pages', { count: d.pageCount })}</Text>}
                    </View>
                  </View>
                  <Chevron />
                </Card>
              )}
            </Pressable>
          </Link>
        ))
      )}
    </Screen>
  );
}
