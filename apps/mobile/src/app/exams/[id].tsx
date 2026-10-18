import type { Exam, GradedQuestion, Question } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  SectionLabel,
  space,
  TextButton,
  Title,
  WorkingCard,
} from '@/components/ui';
import { ExamHero, OptionCard, QuestionCard, QuestionEnter, QuestionMap, WrittenAnswer } from '@/components/exam-question';
import { ExamDatePrompt } from '@/components/planner';
import { api } from '@/lib/api';
import { trackOnce } from '@/lib/analytics';
import { handleLimitError, openPaywall, useEntitlement } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { examDrafts } from '@/lib/exam-drafts';
import { examTimers, formatElapsed, toDurationSeconds } from '@/lib/exam-timer';
import { isAnswered, optionLetter, questionStates } from '@/lib/exam-ui';
import { usePreferences } from '@/lib/preferences';
import { useExamClock } from '@/lib/use-exam-clock';

export default function ExamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exam = useQuery({ queryKey: ['exam', id], queryFn: () => api.getExam(id) });

  if (exam.isLoading) return <Loading />;
  if (!exam.data) {
    return (
      <Screen>
        <ErrorState error={exam.error} onRetry={() => exam.refetch()} />
      </Screen>
    );
  }
  return exam.data.status === 'graded' ? <Results exam={exam.data} /> : <TakeExam exam={exam.data} />;
}

/**
 * One question per screen — easier to focus on a phone. Answers survive leaving and coming back.
 * Layout: a progress header (segments + question map), the question card, the answers, and a footer
 * with Back / Next that stays above the keyboard. Behaviour (drafts, skip, submit, confirmation for
 * unanswered questions, grading) is unchanged.
 */
function TakeExam({ exam }: { exam: Exam }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Height above this screen (status bar + header). Android draws edge-to-edge, so the keyboard no
  // longer resizes the window: KeyboardAvoidingView must pad on both platforms.
  const insets = useSafeAreaInsets();
  const headerOffset = Platform.OS === 'ios' ? 100 : insets.top + 64;
  const questions = exam.questions as Question[];
  const [index, setIndex] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>(() => examDrafts.get(exam.id));
  const q = questions[index];
  const isLast = index === questions.length - 1;
  const ids = questions.map((x) => x.id);
  const unanswered = questions.filter((x) => !isAnswered(answers[x.id])).length;
  const states = questionStates(ids, answers, index);
  const firstUnanswered = unanswered > 0 ? ids.findIndex((id) => !isAnswered(answers[id])) : null;
  const label = exam.kind === 'follow_up' ? t('exam.practiceSet') : t('exam.exam');

  useEffect(() => {
    examDrafts.set(exam.id, answers);
  }, [exam.id, answers]);

  // exam_started / practice_started: first time the student opens this exam in this app session.
  useEffect(() => {
    trackOnce(`started:${exam.id}`, exam.kind === 'follow_up' ? 'practice_started' : 'exam_started', {
      exam_id: exam.id,
      document_id: exam.documentId,
      question_count: questions.length,
    });
  }, [exam.id, exam.kind, exam.documentId, questions.length]);

  // Screen readers: say where we are after moving to another question.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    AccessibilityInfo.announceForAccessibility?.(t('exam.questionOf', { current: index + 1, total: questions.length }));
  }, [index, questions.length, t]);

  const submit = useMutation({
    // The time is read when the student submits; the clock is paused while grading runs (and resumes if it fails).
    mutationFn: () =>
      api.submitExam(exam.id, {
        answers: questions.map((x) => ({ questionId: x.id, answer: answers[x.id] ?? '' })),
        durationSeconds: toDurationSeconds(examTimers.elapsedMs(exam.id)),
      }),
    onSuccess: (graded) => {
      examDrafts.clear(exam.id);
      examTimers.clear(exam.id);
      qc.setQueryData(['exam', exam.id], graded);
      qc.invalidateQueries({ queryKey: ['progress', exam.documentId] });
      // The server adapted the study plan to these results (and completed the task, if any).
      qc.invalidateQueries({ queryKey: ['study-plan', exam.documentId] });
    },
  });

  // Elapsed time: runs from when the student opens the exam (not when it was generated), across questions
  // and visits, and stops while the answers are being submitted.
  const elapsed = useExamClock(exam.id, !submit.isPending && !submit.isSuccess);

  const askSubmit = async () => {
    if (unanswered > 0) {
      const ok = await confirm({
        title: t('exam.unansweredTitle', { count: unanswered }),
        message: t('exam.unansweredMessage'),
        confirmText: t('exam.submit'),
      });
      if (!ok) return;
    }
    submit.mutate();
  };

  const setAnswer = (v: string) => setAnswers((a) => ({ ...a, [q.id]: v }));
  const goTo = (i: number) => {
    setMapOpen(false);
    setIndex(Math.max(0, Math.min(questions.length - 1, i)));
  };

  if (submit.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: label, headerBackVisible: false, gestureEnabled: false }} />
        <WorkingCard title={t('exam.gradingTitle')} detail={t('exam.gradingDetail')} />
      </Screen>
    );
  }

  const isMcq = q.type === 'mcq' && !!q.options;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding" keyboardVerticalOffset={headerOffset}>
      <Stack.Screen options={{ title: label }} />
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        {/* key: start each question scrolled to the top */}
        <ScrollView
          key={q.id}
          contentContainerStyle={{ padding: space(4), paddingBottom: space(6), gap: space(4), maxWidth: 680, width: '100%', alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <ExamHero
            label={label}
            index={index}
            states={states}
            answered={questions.length - unanswered}
            onOpenMap={() => setMapOpen(true)}
            onGoTo={goTo}
            firstUnanswered={firstUnanswered}
            isLast={isLast}
            elapsed={formatElapsed(elapsed)}
          />

          <QuestionEnter>
            <QuestionCard n={index + 1} typeLabel={isMcq ? t('exam.typeMcq') : t('exam.typeWritten')} topic={q.topic} language={exam.language}>
              <ContentDirection language={exam.language}>
                <Title style={{ fontSize: 21, lineHeight: 30 }}>{q.prompt}</Title>
              </ContentDirection>
              <Body muted style={{ fontSize: 14 }}>{isMcq ? t('exam.chooseOne') : t('exam.answerHint')}</Body>
            </QuestionCard>

            {isMcq ? (
              <View style={{ gap: space(2.5) }} accessibilityRole="radiogroup" accessibilityLabel={t('exam.chooseOne')}>
                {q.options!.map((opt, i) => (
                  <OptionCard
                    key={opt}
                    letter={optionLetter(i, exam.language)}
                    text={opt}
                    selected={answers[q.id] === opt}
                    onPress={() => setAnswer(opt)}
                    language={exam.language}
                  />
                ))}
              </View>
            ) : (
              <WrittenAnswer value={answers[q.id] ?? ''} onChange={setAnswer} language={exam.language} placeholder={t('exam.placeholder')} label={t('exam.answerA11y')} />
            )}

            <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
              {t('exam.progress', { answered: questions.length - unanswered, total: questions.length })}
            </Body>
          </QuestionEnter>
        </ScrollView>

        {/* Footer: always reachable, above the keyboard and the home indicator. */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ padding: space(3), gap: space(2), maxWidth: 680, width: '100%', alignSelf: 'center' }}>
            <ErrorText error={submit.error} />
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" title={t('common.back')} onPress={() => setIndex((i) => i - 1)} disabled={index === 0} />
              </View>
              <View style={{ flex: 1.4 }}>
                {isLast ? (
                  <Button title={t('exam.submit')} onPress={askSubmit} />
                ) : (
                  <Button title={isAnswered(answers[q.id]) ? t('exam.next') : t('exam.skip')} onPress={() => setIndex((i) => i + 1)} />
                )}
              </View>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaView>

      <QuestionMap visible={mapOpen} states={states} answered={questions.length - unanswered} currentAnswered={isAnswered(answers[q.id])} onPick={goTo} onClose={() => setMapOpen(false)} />
    </KeyboardAvoidingView>
  );
}

function Results({ exam }: { exam: Exam }) {
  const { t } = useTranslation();
  const { aiLanguage } = usePreferences();
  const qc = useQueryClient();
  const questions = exam.questions as GradedQuestion[];
  const score = exam.score ?? 0;
  const correct = questions.filter((q) => q.isCorrect).length;
  const missedTopics = [...new Set(questions.filter((q) => !q.isCorrect).map((q) => q.topic))];

  const practice = useMutation({
    mutationFn: () => api.createExam(exam.documentId, { kind: 'follow_up', questionCount: 6, language: aiLanguage }),
    onError: (err) => handleLimitError(err),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ['progress', exam.documentId] });
      qc.invalidateQueries({ queryKey: ['entitlement'] });
      router.replace({ pathname: '/exams/[id]', params: { id: next.id } });
    },
  });

  // Practice targeted at weak topics is a Student/Pro/trial feature (decided by the server).
  const e = useEntitlement().data;
  const targeted = !!e?.features.adaptivePractice;

  const headline =
    score >= 0.85 ? t('exam.headlineExcellent') : score >= 0.7 ? t('exam.headlineGood') : score >= 0.4 ? t('exam.headlineGetting') : t('exam.headlineStart');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.results') }} />

      <Card style={{ alignItems: 'center', gap: space(1), paddingVertical: space(6) }}>
        <Text style={{ fontSize: 52, fontWeight: '800', color: scoreColor(score) }}>{pct(score)}</Text>
        <Body style={{ fontWeight: '700', fontSize: 18 }}>{headline}</Body>
        <Body muted>{t('exam.correctOf', { correct, count: questions.length })}</Body>
        {exam.durationSeconds != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }} accessible accessibilityLabel={t('exam.timeTakenA11y', { time: formatElapsed(exam.durationSeconds * 1000) })}>
            <Body muted>{t('exam.timeTaken')}</Body>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], writingDirection: 'ltr' }} testID="exam-time-taken">
              {formatElapsed(exam.durationSeconds * 1000)}
            </Text>
          </View>
        )}
      </Card>

      {practice.isPending ? (
        <WorkingCard title={t('exam.buildingTitle')} detail={t('exam.buildingDetail')} />
      ) : missedTopics.length > 0 && targeted ? (
        // Student / Pro / trial: practice built from these weak topics and the questions missed.
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('exam.workOn')}</SectionLabel>
          <ContentDirection language={exam.language} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {missedTopics.map((topic) => (
              <Badge key={topic} label={topic} tone="warning" />
            ))}
          </ContentDirection>
          <Button title={t('exam.practiseWeak')} onPress={() => practice.mutate()} />
          <ErrorText error={practice.error} />
        </Card>
      ) : missedTopics.length > 0 && e ? (
        // Free / Basic: what to revisit and what they can do now (review with sources, general
        // practice); targeting practice on these topics is what Student adds.
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('exam.revisitTitle')}</SectionLabel>
          <ContentDirection language={exam.language} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {missedTopics.map((topic) => (
              <Badge key={topic} label={topic} tone="warning" />
            ))}
          </ContentDirection>
          <Body muted style={{ fontSize: 14 }}>{t('exam.revisitHint')}</Body>
          <Button variant="secondary" title={t('exam.practiseCourse')} onPress={() => practice.mutate()} />
          <ErrorText error={practice.error} />
          <View style={{ backgroundColor: colors.primarySoft, borderRadius: 12, padding: space(3), gap: space(1) }}>
            <Body style={{ fontSize: 14, fontWeight: '600' }}>{t('course.upgradeTargetedTitle')}</Body>
            <Body muted style={{ fontSize: 14 }}>{t('exam.upgradeTargeted')}</Body>
            <TextButton title={t('course.seeStudent')} onPress={() => openPaywall('locked_weak_topics', t('paywall.lockedWeakTopics'))} />
          </View>
        </Card>
      ) : null}

      {/* After a real exam: when is the student's actual exam? (optional, once per course) */}
      {exam.kind === 'standard' && <ExamDatePrompt documentId={exam.documentId} />}

      <Button
        variant={missedTopics.length > 0 ? 'secondary' : 'primary'}
        title={t('exam.backToCourse')}
        onPress={() => router.dismissTo({ pathname: '/documents/[id]', params: { id: exam.documentId } })}
        disabled={practice.isPending}
      />

      <SectionLabel>{t('exam.review')}</SectionLabel>
      <Body muted style={{ fontSize: 13 }}>{t('exam.aiDisclaimer')}</Body>
      {questions.map((q, i) => (
        <ReviewCard key={q.id} q={q} n={i + 1} language={exam.language} />
      ))}
    </Screen>
  );
}

function ReviewCard({ q, n, language }: { q: GradedQuestion; n: number; language: string }) {
  const { t } = useTranslation();
  const partial = !q.isCorrect && q.score > 0;
  const status = q.isCorrect
    ? { label: t('exam.correct'), tone: 'success' as const }
    : partial
      ? { label: t('exam.partly', { score: pct(q.score) }), tone: 'warning' as const }
      : { label: t('exam.incorrect'), tone: 'danger' as const };
  return (
    <Card style={{ gap: space(2.5), borderLeftWidth: 4, borderLeftColor: scoreColor(q.score) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>
          {n}. {q.topic}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <ContentDirection language={language}>
        <Body style={{ fontWeight: '600' }}>{q.prompt}</Body>
      </ContentDirection>
      <View style={{ gap: space(1) }}>
        <SectionLabel>{t('exam.yourAnswer')}</SectionLabel>
        <Body>{q.userAnswer || t('exam.noAnswer')}</Body>
      </View>
      {!q.isCorrect && (
        <View style={{ gap: space(1) }}>
          <SectionLabel>{q.type === 'mcq' ? t('exam.correctAnswer') : t('exam.modelAnswer')}</SectionLabel>
          <ContentDirection language={language}>
            <Body>{q.correctAnswer}</Body>
          </ContentDirection>
        </View>
      )}
      {!!q.feedback && !(q.type === 'mcq' && q.isCorrect) && (
        <ContentDirection language={language}>
          <Body muted>{q.feedback}</Body>
        </ContentDirection>
      )}
      {!!q.sourceQuote && (
        <View style={{ backgroundColor: colors.bg, borderRadius: 10, padding: space(3), gap: 4 }}>
          <SectionLabel>{t('exam.fromMaterial')}</SectionLabel>
          {/* The quote stays in the material's original language (never translated). */}
          <Text style={{ color: colors.text, fontStyle: 'italic', fontSize: 15, lineHeight: 21 }}>“{q.sourceQuote}”</Text>
        </View>
      )}
    </Card>
  );
}
