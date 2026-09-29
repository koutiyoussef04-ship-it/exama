import type { StudyPlan, StudyTask } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Countdown, PlanStats, TaskCard, TaskLine, useDateLocale } from '@/components/planner';
import { Body, Button, Card, colors, ErrorState, ErrorText, Loading, Screen, SectionLabel, space, TextButton, WorkingCard } from '@/components/ui';
import { platform, track } from '@/lib/analytics';
import { ReminderOffer } from '@/components/reminders';
import { api } from '@/lib/api';
import { syncReminders } from '@/lib/reminders';
import { handleLimitError } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { addDaysIso, formatIso } from '@/lib/plan-dates';
import { usePreferences } from '@/lib/preferences';

const UPCOMING_DAYS = 5;

/** The study plan: countdown, today's tasks (what to do next and why), what's coming up. */
export default function PlanScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const locale = useDateLocale();
  const [showAll, setShowAll] = useState(false);
  const plan = useQuery({ queryKey: ['study-plan', id], queryFn: () => api.getStudyPlan(id) });

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !plan.data) return;
    opened.current = true;
    track('study_plan_opened', { platform, document_id: id, days_until_exam: plan.data.daysUntilExam });
  }, [id, plan.data]);

  const setPlan = (p: StudyPlan) => {
    qc.setQueryData(['study-plan', id], p);
    void syncReminders(); // tomorrow's reminder follows the updated plan
  };
  const complete = useMutation({ mutationFn: (taskId: string) => api.completeStudyTask(id, taskId), onSuccess: setPlan });
  const skip = useMutation({ mutationFn: (taskId: string) => api.skipStudyTask(id, taskId), onSuccess: setPlan });
  const rebuild = useMutation({
    mutationFn: () => api.regenerateStudyPlan(id, aiLanguage),
    onError: (err) => handleLimitError(err),
    onSuccess: (p) => {
      setPlan(p);
      qc.invalidateQueries({ queryKey: ['entitlement'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteStudyPlan(id),
    onSuccess: () => {
      qc.setQueryData(['study-plan', id], null);
      void syncReminders();
      router.back();
    },
  });
  const start = useMutation({
    mutationFn: (task: StudyTask) => {
      track('study_plan_task_started', { platform, document_id: id, activity: task.activity });
      return api.createExam(id, {
        kind: task.activity === 'exam' ? 'standard' : 'follow_up',
        questionCount: task.questionCount ?? 5,
        studyTaskId: task.id,
        language: aiLanguage,
      });
    },
    onError: (err) => handleLimitError(err),
    onSuccess: (exam) => {
      qc.invalidateQueries({ queryKey: ['study-plan', id] });
      qc.invalidateQueries({ queryKey: ['entitlement'] });
      qc.invalidateQueries({ queryKey: ['progress', id] });
      router.push({ pathname: '/exams/[id]', params: { id: exam.id } });
    },
  });

  if (plan.isLoading) return <Loading />;
  if (plan.error) {
    return (
      <Screen>
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
      </Screen>
    );
  }
  const p = plan.data;
  if (!p) {
    // Plan deleted elsewhere: offer to create one.
    return (
      <Screen>
        <Card style={{ gap: space(3) }}>
          <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text }}>{t('planner.cardCreateTitle')}</Text>
          <Body muted>{t('planner.cardCreateBody')}</Body>
          <Button title={t('planner.create')} onPress={() => router.replace({ pathname: '/plan/setup', params: { id } })} />
        </Card>
      </Screen>
    );
  }

  const busy = complete.isPending || skip.isPending || start.isPending;
  const focusOf = (topic: string | null) => p.topics.find((x) => x.topic === topic)?.focus;
  const todays = p.tasks.filter((x) => x.date === p.today);
  const todayTotal = todays.filter((x) => x.status !== 'skipped').reduce((s, x) => s + x.minutes, 0);
  const todayDone = todays.filter((x) => x.status === 'completed').reduce((s, x) => s + x.minutes, 0);
  const allDone = todays.length > 0 && todays.every((x) => x.status !== 'pending');
  const future = groupByDate(p.tasks.filter((x) => x.date > p.today && x.status === 'pending'));
  const past = groupByDate(p.tasks.filter((x) => x.date < p.today)).reverse();
  const shownFuture = showAll ? future : future.slice(0, UPCOMING_DAYS);
  const dayLabel = (date: string) =>
    date === addDaysIso(p.today, 1) ? t('planner.tomorrow') : formatIso(date, locale, { weekday: 'long', day: 'numeric', month: 'short' });

  const askSkip = async (task: StudyTask) => {
    if (await confirm({ title: t('planner.skipTitle'), message: t('planner.skipMessage'), confirmText: t('planner.skip') })) skip.mutate(task.id);
  };
  const askRebuild = async () => {
    if (await confirm({ title: t('planner.rebuildTitle'), message: t('planner.rebuildMessage'), confirmText: t('planner.rebuildConfirm') })) rebuild.mutate();
  };
  const askDelete = async () => {
    if (await confirm({ title: t('planner.deleteTitle'), message: t('planner.deleteMessage'), confirmText: t('common.delete'), destructive: true })) remove.mutate();
  };

  return (
    <Screen onRefresh={() => plan.refetch()} refreshing={plan.isRefetching}>
      <Countdown plan={p}>
        <PlanStats plan={p} />
      </Countdown>
      {p.daysUntilExam > 0 && <ReminderOffer />}

      <Notices plan={p} />
      {p.notices.includes('new_material') && <NewMaterialNotice documentId={id} onUpdated={setPlan} />}

      {rebuild.isPending ? (
        <WorkingCard title={t('planner.generating')} detail={t('planner.generatingDetail')} />
      ) : (
        p.daysUntilExam >= 0 && (
          <View style={{ gap: space(3) }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space(2), flexWrap: 'wrap' }}>
              <SectionLabel>{t('planner.todaysFocus')}</SectionLabel>
              {todayTotal > 0 && <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}>{t('planner.todayMinutes', { done: todayDone, total: todayTotal })}</Text>}
            </View>
            {todays.length === 0 && <Body muted>{t('planner.nothingToday')}</Body>}
            {allDone && <Body style={{ color: colors.success, fontWeight: '700' }}>{t('planner.allDoneToday')}</Body>}
            {todays.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                focus={focusOf(task.topic)}
                focusLanguage={p.language}
                busy={busy}
                onStart={() => (task.examId ? router.push({ pathname: '/exams/[id]', params: { id: task.examId } }) : start.mutate(task))}
                onDone={() => complete.mutate(task.id)}
                onSkip={() => void askSkip(task)}
              />
            ))}
            <ErrorText error={complete.error ?? skip.error ?? start.error ?? rebuild.error} />
          </View>
        )
      )}

      {future.length > 0 && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('planner.upcoming')}</SectionLabel>
          {shownFuture.map(([date, tasks]) => (
            <View key={date} style={{ gap: space(1) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{dayLabel(date)}</Text>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('planner.minutes', { count: tasks.reduce((s, x) => s + x.minutes, 0) })}</Text>
              </View>
              {tasks.map((task) => (
                <TaskLine key={task.id} task={task} />
              ))}
            </View>
          ))}
          {(future.length > UPCOMING_DAYS || past.length > 0) && (
            <TextButton title={showAll ? t('planner.showLess') : t('planner.showAll')} onPress={() => setShowAll((s) => !s)} />
          )}
        </Card>
      )}

      {showAll && past.length > 0 && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('planner.earlier')}</SectionLabel>
          {past.map(([date, tasks]) => (
            <View key={date} style={{ gap: space(1) }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>{formatIso(date, locale, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
              {tasks.map((task) => (
                <View key={task.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <TaskLine task={task} />
                  </View>
                  {task.status !== 'completed' && (
                    <Text style={{ color: task.status === 'missed' ? colors.warning : colors.muted, fontSize: 12, fontWeight: '700' }}>
                      {task.status === 'missed' ? t('planner.statusMissed') : t('planner.statusSkipped')}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ))}
        </Card>
      )}

      <View style={{ gap: space(1) }}>
        <Button variant="secondary" title={t('planner.edit')} onPress={() => router.push({ pathname: '/plan/setup', params: { id, edit: '1' } })} />
        <TextButton title={t('planner.rebuild')} onPress={() => void askRebuild()} disabled={rebuild.isPending} />
        <TextButton title={t('planner.deletePlan')} tone="danger" onPress={() => void askDelete()} disabled={remove.isPending} />
        <ErrorText error={remove.error} />
      </View>
    </Screen>
  );
}

function groupByDate(tasks: StudyTask[]): [string, StudyTask[]][] {
  const map = new Map<string, StudyTask[]>();
  for (const task of tasks) map.set(task.date, [...(map.get(task.date) ?? []), task]);
  return [...map.entries()];
}

/** A lecture/PDF added topics the plan doesn't include yet: updating is the student's choice (free, no AI). */
function NewMaterialNotice({ documentId, onUpdated }: { documentId: string; onUpdated: (p: StudyPlan) => void }) {
  const { t } = useTranslation();
  const update = useMutation({ mutationFn: () => api.recalculateStudyPlan(documentId), onSuccess: onUpdated });
  return (
    <Card style={{ gap: space(3), backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }}>
      <Body style={{ fontSize: 14, lineHeight: 20 }}>{t('planner.newMaterial')}</Body>
      <Button title={t('planner.updatePlan')} onPress={() => update.mutate()} loading={update.isPending} />
      <ErrorText error={update.error} />
    </Card>
  );
}

function Notices({ plan }: { plan: StudyPlan }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  if (plan.notices.includes('exam_passed')) lines.push(t('planner.examPassedBody'));
  if (plan.notices.includes('no_study_days')) lines.push(t('planner.noStudyDays'));
  if (plan.notices.includes('not_enough_time')) {
    lines.push(plan.adaptive ? t('planner.notEnoughTime') : t('planner.notEnoughTimeEven'));
    if (plan.uncoveredTopics.length) lines.push(t('planner.notCovered', { topics: plan.uncoveredTopics.join(', ') }));
  }
  if (plan.notices.includes('no_topics')) lines.push(t('planner.noTopics'));
  if (plan.notices.includes('light_schedule')) lines.push(t('planner.lightSchedule', { minutes: plan.dailyMinutes }));
  if (!plan.adaptive) lines.push(t('planner.evenNote'));
  if (lines.length === 0) return null;
  const warn = plan.notices.some((n) => n === 'exam_passed' || n === 'no_study_days' || n === 'not_enough_time');
  return (
    <Card style={{ gap: space(2), backgroundColor: warn ? colors.warningSoft : colors.primarySoft, borderColor: warn ? colors.warningSoft : colors.primarySoft }}>
      {lines.map((line) => (
        <Body key={line} style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>
          {line}
        </Body>
      ))}
    </Card>
  );
}
