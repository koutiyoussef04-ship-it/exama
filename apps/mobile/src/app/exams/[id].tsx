import type { Exam, GradedQuestion, Question } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { ExamDatePrompt } from '@/components/planner';
import { api } from '@/lib/api';
import { trackOnce } from '@/lib/analytics';
import { handleLimitError, openPaywall, useEntitlement } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { examDrafts } from '@/lib/exam-drafts';
import { usePreferences } from '@/lib/preferences';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

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

/** One question per screen — easier to focus on a phone. Answers survive leaving and coming back. */
function TakeExam({ exam }: { exam: Exam }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Height above this screen (status bar + header). Android draws edge-to-edge, so the keyboard no
  // longer resizes the window: KeyboardAvoidingView must pad on both platforms.
  const insets = useSafeAreaInsets();
  const headerOffset = Platform.OS === 'ios' ? 100 : insets.top + 64;
  const questions = exam.questions as Question[];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => examDrafts.get(exam.id));
  const q = questions[index];
  const isLast = index === questions.length - 1;
  const unanswered = questions.filter((x) => !answers[x.id]?.trim()).length;
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

  const submit = useMutation({
    mutationFn: () =>
      api.submitExam(exam.id, { answers: questions.map((x) => ({ questionId: x.id, answer: answers[x.id] ?? '' })) }),
    onSuccess: (graded) => {
      examDrafts.clear(exam.id);
      qc.setQueryData(['exam', exam.id], graded);
      qc.invalidateQueries({ queryKey: ['progress', exam.documentId] });
      // The server adapted the study plan to these results (and completed the task, if any).
      qc.invalidateQueries({ queryKey: ['study-plan', exam.documentId] });
    },
  });

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

  if (submit.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: label, headerBackVisible: false, gestureEnabled: false }} />
        <WorkingCard title={t('exam.gradingTitle')} detail={t('exam.gradingDetail')} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerOffset}>
      <Stack.Screen options={{ title: label }} />
      {/* key: start each question scrolled to the top */}
      <Screen key={q.id}>
        <View style={{ gap: space(2) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
            <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '600' }}>
              {t('exam.questionOf', { current: index + 1, total: questions.length })}
            </Text>
            <ContentDirection language={exam.language}>
              <Badge label={q.topic} tone="primary" />
            </ContentDirection>
          </View>
          <ProgressBar value={(index + 1) / questions.length} color={colors.primary} />
        </View>

        <ContentDirection language={exam.language}>
          <Title>{q.prompt}</Title>
        </ContentDirection>

        {q.type === 'mcq' && q.options ? (
          <View style={{ gap: space(2.5) }} accessibilityRole="radiogroup">
            <Body muted style={{ fontSize: 14 }}>{t('exam.chooseOne')}</Body>
            {q.options.map((opt, i) => {
              const selected = answers[q.id] === opt;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setAnswer(opt)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: space(3),
                    alignItems: 'flex-start',
                    padding: space(4),
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primarySoft : colors.card,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? colors.primary : colors.bg,
                    }}
                  >
                    <Text style={{ color: selected ? colors.primaryText : colors.muted, fontWeight: '700', fontSize: 13 }}>{LETTERS[i]}</Text>
                  </View>
                  <ContentDirection language={exam.language} style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, lineHeight: 22, color: colors.text }}>{opt}</Text>
                  </ContentDirection>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={{ gap: space(2) }}>
            <Body muted style={{ fontSize: 14 }}>{t('exam.answerHint')}</Body>
            <TextInput
              multiline
              value={answers[q.id] ?? ''}
              onChangeText={setAnswer}
              placeholder={t('exam.placeholder')}
              placeholderTextColor={colors.muted}
              accessibilityLabel={t('exam.answerA11y')}
              style={{
                minHeight: 140,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: space(3.5),
                fontSize: 16,
                lineHeight: 22,
                backgroundColor: colors.card,
                color: colors.text,
              }}
            />
          </View>
        )}

        <ErrorText error={submit.error} />
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" title={t('common.back')} onPress={() => setIndex((i) => i - 1)} disabled={index === 0} />
          </View>
          <View style={{ flex: 1 }}>
            {isLast ? (
              <Button title={t('exam.submit')} onPress={askSubmit} />
            ) : (
              <Button title={answers[q.id]?.trim() ? t('exam.next') : t('exam.skip')} onPress={() => setIndex((i) => i + 1)} />
            )}
          </View>
        </View>
        <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
          {t('exam.progress', { answered: questions.length - unanswered, total: questions.length })}
        </Body>
      </Screen>
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
