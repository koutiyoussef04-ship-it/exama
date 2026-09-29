import { MAX_PLAN_DAYS, type PreparedLevel, type StudyMinutes, type StudyPlan } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Calendar, Chips, examDateText, useDateLocale, WeekdayPicker } from '@/components/planner';
import { Body, Button, Card, colors, ErrorText, Loading, Screen, SectionLabel, space, TextButton, Title, WorkingCard } from '@/components/ui';
import { platform, track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { syncReminders } from '@/lib/reminders';
import { handleLimitError } from '@/lib/billing';
import { addDaysIso, deviceTimeZone, formatTime, stepTime, todayIso } from '@/lib/plan-dates';
import { usePreferences } from '@/lib/preferences';

/** Plan setup: a few quick questions. Also used to edit an existing plan (no AI call when editing). */
export default function PlanSetup() {
  const { id, edit, from } = useLocalSearchParams<{ id: string; edit?: string; from?: string }>();
  const editing = edit === '1';
  const existing = useQuery({ queryKey: ['study-plan', id], queryFn: () => api.getStudyPlan(id), enabled: editing });
  if (editing && existing.isLoading) return <Loading />;
  return <SetupForm documentId={id} plan={editing ? (existing.data ?? null) : null} fromResults={from === 'results'} />;
}

function SetupForm({ documentId, plan, fromResults = false }: { documentId: string; plan: StudyPlan | null; fromResults?: boolean }) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const today = plan?.today ?? todayIso();
  const [examDate, setExamDate] = useState<string | null>(plan && plan.daysUntilExam >= 0 ? plan.examDate : null);
  const [examTime, setExamTime] = useState<string | null>(plan?.examTime ?? null);
  const [minutes, setMinutes] = useState<StudyMinutes>(plan?.minutesPerDay ?? 60);
  const [prepared, setPrepared] = useState<PreparedLevel>(plan?.preparedLevel ?? 'familiar');
  const [studyDays, setStudyDays] = useState<number[]>(plan?.studyDays ?? [0, 1, 2, 3, 4, 5, 6]);
  const [unavailable, setUnavailable] = useState<string[]>(plan?.unavailableDates ?? []);
  const [more, setMore] = useState(!!plan && (plan.studyDays.length < 7 || plan.unavailableDates.length > 0));

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    track('study_plan_setup_started', { platform, document_id: documentId, editing: !!plan, ...(fromResults ? { entry: 'results' as const } : {}) });
  }, [documentId, plan]);

  const save = useMutation({
    mutationFn: () => {
      const prefs = {
        examDate: examDate!,
        examTime,
        minutesPerDay: minutes,
        preparedLevel: prepared,
        studyDays,
        unavailableDates: unavailable.filter((d) => d >= today && d < examDate!),
        timezone: deviceTimeZone(),
      };
      // Editing never calls the AI; creating does once (in the study language).
      return plan ? api.updateStudyPlan(documentId, prefs) : api.createStudyPlan(documentId, { ...prefs, language: aiLanguage });
    },
    onError: (err) => handleLimitError(err),
    onSuccess: (saved) => {
      qc.setQueryData(['study-plan', documentId], saved);
      qc.invalidateQueries({ queryKey: ['entitlement'] });
      void syncReminders();
      if (plan) router.back();
      else router.replace({ pathname: '/plan/[id]', params: { id: documentId } });
    },
  });

  if (save.isPending && !plan) {
    return (
      <Screen>
        <Stack.Screen options={{ headerBackVisible: false, gestureEnabled: false }} />
        <WorkingCard title={t('planner.generating')} detail={t('planner.generatingDetail')} />
      </Screen>
    );
  }

  const minuteOptions: { value: StudyMinutes; label: string }[] = [
    { value: 30, label: t('planner.perDay30') },
    { value: 60, label: t('planner.perDay60') },
    { value: 120, label: t('planner.perDay120') },
    { value: 180, label: t('planner.perDay180') },
  ];
  const preparedOptions: { value: PreparedLevel; label: string }[] = [
    { value: 'zero', label: t('planner.preparedZero') },
    { value: 'familiar', label: t('planner.preparedFamiliar') },
    { value: 'confident', label: t('planner.preparedConfident') },
  ];

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <Title>{t('planner.setupTitle')}</Title>
        <Body muted>{t('planner.setupSubtitle')}</Body>
      </View>

      <Card style={{ gap: space(3) }}>
        <Calendar mode="single" selected={examDate ? [examDate] : []} onToggle={setExamDate} minDate={today} maxDate={addDaysIso(today, MAX_PLAN_DAYS)} />
        {examDate ? (
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16, textAlign: 'center' }}>
            {examDateText(t, { examDate, examTime }, locale)}
          </Text>
        ) : (
          <Body muted style={{ textAlign: 'center', fontSize: 14 }}>{t('planner.pickDateFirst')}</Body>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3), gap: space(2) }}>
          <SectionLabel>{t('planner.examTime')}</SectionLabel>
          {examTime ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) }}>
              <TimeButton label={t('planner.earlierTime')} onPress={() => setExamTime(stepTime(examTime, -30))} />
              <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{formatTime(examTime, locale)}</Text>
              <TimeButton label={t('planner.laterTime')} onPress={() => setExamTime(stepTime(examTime, 30))} />
            </View>
          ) : null}
          <TextButton title={examTime ? t('planner.removeTime') : t('planner.addTime')} tone={examTime ? 'muted' : 'primary'} onPress={() => setExamTime(examTime ? null : '09:00')} />
        </View>
      </Card>

      <View style={{ gap: space(2) }}>
        <SectionLabel>{t('planner.timePerDay')}</SectionLabel>
        <Chips options={minuteOptions} value={minutes} onChange={setMinutes} />
      </View>

      <View style={{ gap: space(2) }}>
        <SectionLabel>{t('planner.prepared')}</SectionLabel>
        <Chips options={preparedOptions} value={prepared} onChange={setPrepared} />
      </View>

      <TextButton title={more ? t('planner.fewerOptions') : t('planner.moreOptions')} onPress={() => setMore((m) => !m)} />
      {more && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('planner.studyDays')}</SectionLabel>
          <WeekdayPicker value={studyDays} onChange={setStudyDays} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3), gap: space(2) }}>
            <SectionLabel>{t('planner.unavailable')}</SectionLabel>
            {examDate ? (
              <>
                <Body muted style={{ fontSize: 13 }}>{t('planner.unavailableHint')}</Body>
                <Calendar
                  mode="multi"
                  selected={unavailable}
                  onToggle={(d) => setUnavailable((u) => (u.includes(d) ? u.filter((x) => x !== d) : [...u, d].sort()))}
                  minDate={today}
                  maxDate={addDaysIso(examDate, -1) < today ? today : addDaysIso(examDate, -1)}
                  marked={examDate}
                />
              </>
            ) : (
              <Body muted style={{ fontSize: 13 }}>{t('planner.pickDateFirst')}</Body>
            )}
          </View>
        </Card>
      )}

      <ErrorText error={save.error} />
      <Button
        title={plan ? t('planner.saveCta') : t('planner.createCta')}
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!examDate || studyDays.length === 0}
      />
      {!plan && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('planner.usesAi')}</Body>}
    </Screen>
  );
}

function TimeButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: space(3.5),
        paddingVertical: space(2.5),
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
