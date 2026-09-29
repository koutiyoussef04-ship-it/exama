import type { CreateExamInput, ExamSummary } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import {
  Badge,
  Body,
  Button,
  Card,
  colors,
  ContentDirection,
  ErrorState,
  ErrorText,
  Loading,
  pct,
  ProgressBar,
  Screen,
  scoreColor,
  scoreTone,
  SectionLabel,
  space,
  TextButton,
  WorkingCard,
} from '@/components/ui';
import i18n from '@/i18n';
import { MaterialsCard } from '@/components/materials';
import { StudyPlanCard } from '@/components/planner';
import { api } from '@/lib/api';
import { trackOnce } from '@/lib/analytics';
import { formatDate, handleLimitError, openPaywall, useEntitlement } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { documentErrorMessage, isRetryableDocumentError } from '@/lib/errors';
import { usePreferences } from '@/lib/preferences';

const EXAM_LENGTH = 8;
const PRACTICE_LENGTH = 6;
/** The API focuses a practice set on at most this many of the weakest topics. */
const MAX_FOCUS = 3;

/** Localized language name for an ISO code (falls back to the code itself). */
function languageName(code: string | null) {
  if (!code) return '';
  return i18n.exists(`languageNames.${code}`) ? i18n.t(`languageNames.${code}` as 'languageNames.en') : code.toUpperCase();
}

export default function CourseScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const entitlement = useEntitlement();
  const { aiLanguage } = usePreferences();

  const doc = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });
  const progress = useQuery({
    queryKey: ['progress', id],
    queryFn: () => api.getProgress(id),
    enabled: doc.data?.status === 'ready',
  });

  // course_opened: once per visit, as soon as we know the course's status.
  const [openedAt] = useState(() => Date.now());
  const loadedStatus = doc.data?.status;
  useEffect(() => {
    if (loadedStatus) trackOnce(`course_opened:${id}:${openedAt}`, 'course_opened', { document_id: id, status: loadedStatus });
  }, [id, openedAt, loadedStatus]);

  const createExam = useMutation({
    // Questions and feedback in the student's study language (the PDF can be in any language).
    mutationFn: (input: CreateExamInput) => api.createExam(id, { ...input, language: aiLanguage }),
    onError: (err) => handleLimitError(err),
    onSuccess: (exam) => {
      qc.invalidateQueries({ queryKey: ['progress', id] });
      qc.invalidateQueries({ queryKey: ['entitlement'] });
      router.push({ pathname: '/exams/[id]', params: { id: exam.id } });
    },
  });

  const retry = useMutation({
    mutationFn: () => api.reprocessDocument(id),
    onSuccess: (updated) => {
      qc.setQueryData(['document', id], updated);
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['entitlement'] });
      router.back();
    },
  });

  const askDelete = async () => {
    const ok = await confirm({ title: t('course.deleteTitle'), message: t('course.deleteMessage'), confirmText: t('common.delete'), destructive: true });
    if (ok) remove.mutate();
  };

  if (doc.isLoading) return <Loading />;
  if (!doc.data) {
    return (
      <Screen>
        <ErrorState error={doc.error} onRetry={() => doc.refetch()} />
      </Screen>
    );
  }

  const d = doc.data;
  const p = progress.data;
  const generating = createExam.isPending;
  const kind = createExam.variables?.kind;
  const weak = p?.topics.filter((x) => p.weakTopics.includes(x.topic)) ?? [];
  const inProgress = p?.exams.find((e) => e.status === 'in_progress');
  const hasTakenExam = !!p?.exams.some((e) => e.status === 'graded');
  // Weak-topic analysis and adaptive practice are Student/Pro/trial features (decided by the server).
  const analysisLocked = !!p?.analysisLocked;
  const e = entitlement.data;
  const focus = Math.min(weak.length, MAX_FOCUS);
  // A new student (no exam yet, none in progress): the first-visit layout, one primary action.
  const firstVisit = !!p && !hasTakenExam && !inProgress;
  const retryable = isRetryableDocumentError(d.errorCode);
  const examsLeft =
    e && !e.isPremium && e.limits.examGenerationsPerMonth !== null ? (
      <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
        {t(e.usagePeriod === 'trial' ? 'course.examsLeftTrial' : 'course.examsLeftMonth', {
          left: Math.max(0, e.limits.examGenerationsPerMonth - e.usage.examGenerationsThisMonth),
          count: e.limits.examGenerationsPerMonth,
        })}
      </Body>
    ) : null;
  const languageLine =
    d.summaryLanguage && d.sourceLanguage && d.summaryLanguage !== d.sourceLanguage
      ? t('course.languages', { summary: languageName(d.summaryLanguage), source: languageName(d.sourceLanguage) })
      : d.summaryLanguage
        ? t('course.summaryIn', { language: languageName(d.summaryLanguage) })
        : null;

  return (
    <Screen
      onRefresh={() => {
        doc.refetch();
        if (d.status === 'ready') progress.refetch();
      }}
      refreshing={doc.isRefetching || progress.isRefetching}
    >
      <Stack.Screen options={{ title: d.title }} />

      {d.status === 'processing' && <WorkingCard title={t('course.readingTitle')} detail={t('course.readingDetail')} />}

      {d.status === 'failed' && (
        <Card style={{ gap: space(3) }}>
          <Badge label={t('course.failedBadge')} tone="danger" />
          <Body muted>{documentErrorMessage(d.errorCode, d.error)}</Body>
          {/* Retrying only helps with temporary problems (AI busy, server error) — not with the file itself. */}
          {retryable && <Button variant="secondary" title={t('common.tryAgain')} onPress={() => retry.mutate()} loading={retry.isPending} />}
          <Body muted style={{ fontSize: 14 }}>{retryable ? t('course.failedNextRetry') : t('course.failedNextFile')}</Body>
          <Button variant={retryable ? 'secondary' : 'primary'} title={t('course.failedDelete')} onPress={askDelete} loading={remove.isPending} />
          <ErrorText error={retry.error} />
        </Card>
      )}

      {d.status === 'ready' && !p && (progress.error ? <ErrorState error={progress.error} onRetry={() => progress.refetch()} /> : <Loading />)}

      {d.status === 'ready' && firstVisit && (
        <>
          {/* First visit: show what Exama understood, then one clear next step. */}
          <Card style={{ gap: space(3) }}>
            <SectionLabel>{t('course.understoodTitle')}</SectionLabel>
            <Body style={{ fontWeight: '600' }}>{t('course.understoodTopics', { count: d.topics.length })}</Body>
            <ContentDirection language={d.summaryLanguage} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
              {d.topics.map((x) => (
                <Badge key={x} label={x} tone="primary" />
              ))}
            </ContentDirection>
            {!!d.summary && (
              <>
                <ContentDirection language={d.summaryLanguage}>
                  <Body muted numberOfLines={summaryOpen ? undefined : 3}>{d.summary}</Body>
                </ContentDirection>
                {d.summary.length > 160 && (
                  <Pressable onPress={() => setSummaryOpen((o) => !o)} hitSlop={8} accessibilityRole="button">
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>{summaryOpen ? t('course.showLess') : t('course.readMore')}</Text>
                  </Pressable>
                )}
              </>
            )}
            {!!languageLine && <Body muted style={{ fontSize: 13 }}>{languageLine}</Body>}
          </Card>

          {generating ? (
            <WorkingCard title={t('course.writingExam')} detail={t('course.generatingDetail')} />
          ) : (
            <Button title={t('course.startFirstExam', { count: EXAM_LENGTH })} onPress={() => createExam.mutate({ kind: 'standard', questionCount: EXAM_LENGTH })} />
          )}
          <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('course.firstExamHint')}</Body>
          <ErrorText error={createExam.error} />
          {examsLeft}

          <StudyPlanCard documentId={d.id} />
          <MaterialsCard documentId={d.id} />
        </>
      )}

      {d.status === 'ready' && p && !firstVisit && (
        <>
          {/* Study plan: countdown + what to do today (or create one) */}
          <StudyPlanCard documentId={d.id} />

          {/* Primary actions */}
          {generating ? (
            <WorkingCard title={kind === 'follow_up' ? t('course.buildingPractice') : t('course.writingExam')} detail={t('course.generatingDetail')} />
          ) : (
            <View style={{ gap: space(3) }}>
              {inProgress && (
                <Button
                  title={inProgress.kind === 'follow_up' ? t('course.continuePractice') : t('course.continueExam')}
                  onPress={() => router.push({ pathname: '/exams/[id]', params: { id: inProgress.id } })}
                />
              )}
              <Button
                variant={inProgress ? 'secondary' : 'primary'}
                title={hasTakenExam ? t('course.newExam', { count: EXAM_LENGTH }) : t('course.startFirstExam', { count: EXAM_LENGTH })}
                onPress={() => createExam.mutate({ kind: 'standard', questionCount: EXAM_LENGTH })}
              />
            </View>
          )}
          <ErrorText error={createExam.error} />
          {examsLeft}

          {/* Free/Basic: practice across the course; targeting weak topics is what Student adds. */}
          {p && analysisLocked && hasTakenExam && (
            <Card style={{ gap: space(3) }}>
              <SectionLabel>{t('course.practiceTitle')}</SectionLabel>
              <Body muted>{t('course.practiseCourseHint')}</Body>
              <Button
                variant="secondary"
                title={t('course.practiseCourse')}
                onPress={() => createExam.mutate({ kind: 'follow_up', questionCount: PRACTICE_LENGTH })}
                disabled={generating}
              />
              <View style={{ backgroundColor: colors.primarySoft, borderRadius: 12, padding: space(3), gap: space(1) }}>
                <Body style={{ fontSize: 14, fontWeight: '600' }}>{t('course.upgradeTargetedTitle')}</Body>
                <Body muted style={{ fontSize: 14 }}>{t('course.upgradeTargeted')}</Body>
                <TextButton title={t('course.seeStudent')} onPress={() => openPaywall('locked_weak_topics', t('paywall.lockedWeakTopics'))} />
              </View>
            </Card>
          )}

          {/* Weak areas */}
          {p && hasTakenExam && !analysisLocked && (
            <Card style={{ gap: space(3) }}>
              <SectionLabel>{t('course.focusAreas')}</SectionLabel>
              {weak.length > 0 ? (
                <>
                  <Body muted>{t('course.weakIntro', { count: focus })}</Body>
                  <ContentDirection language={d.summaryLanguage} style={{ gap: space(3) }}>
                    {weak.map((x) => (
                      <TopicRow key={x.topic} topic={x.topic} mastery={x.mastery} />
                    ))}
                  </ContentDirection>
                  <Button
                    title={weak.length === 1 ? t('course.practiseOne') : t('course.practiseMany', { count: focus })}
                    onPress={() => createExam.mutate({ kind: 'follow_up', questionCount: PRACTICE_LENGTH })}
                    disabled={generating}
                  />
                </>
              ) : (
                <Body>{t('course.noWeak')}</Body>
              )}
            </Card>
          )}

          {/* Lectures, videos and extra PDFs feeding this course */}
          <MaterialsCard documentId={d.id} />

          {/* Summary + topics */}
          <Card style={{ gap: space(3) }}>
            <SectionLabel>{t('course.summary')}</SectionLabel>
            <ContentDirection language={d.summaryLanguage}>
              <Body numberOfLines={summaryOpen ? undefined : 4}>{d.summary}</Body>
            </ContentDirection>
            {(d.summary?.length ?? 0) > 220 && (
              <Pressable onPress={() => setSummaryOpen((o) => !o)} hitSlop={8} accessibilityRole="button">
                <Text style={{ color: colors.primary, fontWeight: '600' }}>{summaryOpen ? t('course.showLess') : t('course.readMore')}</Text>
              </Pressable>
            )}
            {!!languageLine && <Body muted style={{ fontSize: 13 }}>{languageLine}</Body>}
            <SectionLabel>{hasTakenExam && !analysisLocked ? t('course.topicMastery') : t('course.topicsCovered', { count: d.topics.length })}</SectionLabel>
            {hasTakenExam && p && !analysisLocked ? (
              <ContentDirection language={d.summaryLanguage} style={{ gap: space(3) }}>
                {d.topics.map((topic) => {
                  const m = p.topics.find((x) => x.topic === topic);
                  return <TopicRow key={topic} topic={topic} mastery={m?.mastery} />;
                })}
              </ContentDirection>
            ) : (
              <ContentDirection language={d.summaryLanguage} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                {d.topics.map((x) => (
                  <Badge key={x} label={x} tone="primary" />
                ))}
              </ContentDirection>
            )}
          </Card>

          {/* History */}
          {p && p.exams.length > 0 && (
            <Card style={{ gap: 0 }}>
              <SectionLabel>{t('course.yourExams')}</SectionLabel>
              {p.exams.map((x, i) => (
                <ExamRow key={x.id} exam={x} last={i === p.exams.length - 1} />
              ))}
            </Card>
          )}
        </>
      )}

      <TextButton title={remove.isPending ? t('course.deleting') : t('course.deleteCourse')} tone="danger" onPress={askDelete} disabled={remove.isPending} />
      <ErrorText error={remove.error} />
    </Screen>
  );
}

function TopicRow({ topic, mastery }: { topic: string; mastery?: number }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3) }}>
        <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{topic}</Text>
        <Text style={{ color: mastery == null ? colors.muted : scoreColor(mastery), fontWeight: '700', fontSize: 15 }}>
          {mastery == null ? t('course.notTested') : pct(mastery)}
        </Text>
      </View>
      <ProgressBar value={mastery ?? 0} />
    </View>
  );
}

function ExamRow({ exam, last }: { exam: ExamSummary; last: boolean }) {
  const { t } = useTranslation();
  return (
    <Link href={{ pathname: '/exams/[id]', params: { id: exam.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 52,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>{exam.kind === 'follow_up' ? t('course.practiceSet') : t('course.exam')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {t('course.rowMeta', { date: formatDate(exam.createdAt), questions: t('course.questions', { count: exam.questionCount }) })}
          </Text>
        </View>
        {exam.score == null ? (
          <Badge label={`${t('course.continueBadge')} ${t('common.chevron')}`} tone="primary" />
        ) : (
          <Badge label={pct(exam.score)} tone={scoreTone(exam.score)} />
        )}
      </Pressable>
    </Link>
  );
}
