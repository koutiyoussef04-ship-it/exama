/**
 * Study-planner building blocks: calendar, choice chips, countdown, task card and the course card.
 * All text comes from i18n (planner.*); layouts mirror automatically in Arabic.
 */
import type { StudyPlan, StudyTask, TaskActivity } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { isRtlLanguage } from '@study/shared';
import { Badge, Body, Button, Card, Chevron, colors, ContentDirection, pct, ProgressBar, SectionLabel, space, TextButton } from '@/components/ui';
import { formattingLocale, isLanguage } from '@/i18n/languages';
import { api } from '@/lib/api';
import { remaining, useEntitlement } from '@/lib/billing';
import { kv } from '@/lib/storage';
import { formatIso, formatTime, monthGrid, monthTitle, weekdayNames, weekOrder } from '@/lib/plan-dates';

/** Locale for dates in the current UI language (Arabic with Western digits). */
export function useDateLocale() {
  const { i18n } = useTranslation();
  return isLanguage(i18n.language) ? formattingLocale(i18n.language) : 'en';
}

/** First day of the week the way students in each language expect it. */
const WEEK_START: Record<string, number> = { en: 0, es: 1, fr: 1, ar: 6 };

// ------------------------------------------------------------------ chips

export function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => ({
              paddingHorizontal: space(3.5),
              paddingVertical: space(2.5),
              borderRadius: 999,
              borderWidth: 2,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primarySoft : colors.card,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: selected ? colors.primary : colors.text, fontWeight: '600', fontSize: 15 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Weekday toggles (multi-select). */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const { i18n } = useTranslation();
  const locale = useDateLocale();
  const names = weekdayNames(locale, 'short');
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
      {weekOrder(WEEK_START[i18n.language] ?? 1).map((d) => {
        const on = value.includes(d);
        return (
          <Pressable
            key={d}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={names[d]}
            onPress={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            style={{
              minWidth: 48,
              paddingHorizontal: space(2),
              paddingVertical: space(2.5),
              borderRadius: 12,
              alignItems: 'center',
              borderWidth: 2,
              borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primarySoft : colors.card,
            }}
          >
            <Text style={{ color: on ? colors.primary : colors.muted, fontWeight: '700' }}>{names[d]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ calendar

type CalendarProps = {
  /** single: the exam date; multi: dates the student can't study. */
  mode: 'single' | 'multi';
  selected: string[];
  onToggle: (date: string) => void;
  minDate: string;
  maxDate: string;
  /** Highlighted (e.g. the exam date while picking unavailable days). */
  marked?: string | null;
};

export function Calendar({ mode, selected, onToggle, minDate, maxDate, marked }: CalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = useDateLocale();
  const start = selected[0] ?? minDate;
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) }));
  const weekStart = WEEK_START[i18n.language] ?? 1;
  const weeks = useMemo(() => monthGrid(ym.y, ym.m, weekStart), [ym, weekStart]);
  const names = weekdayNames(locale, 'narrow');
  const rtl = isRtlLanguage(i18n.language);
  const monthKey = (y: number, m: number) => y * 12 + m;
  const canPrev = monthKey(ym.y, ym.m) > monthKey(Number(minDate.slice(0, 4)), Number(minDate.slice(5, 7)));
  const canNext = monthKey(ym.y, ym.m) < monthKey(Number(maxDate.slice(0, 4)), Number(maxDate.slice(5, 7)));
  const shift = (d: number) => setYm(({ y, m }) => ({ y: m + d > 12 ? y + 1 : m + d < 1 ? y - 1 : y, m: ((m + d + 11) % 12) + 1 }));

  const Arrow = ({ dir }: { dir: -1 | 1 }) => {
    const enabled = dir < 0 ? canPrev : canNext;
    // Arrows point "backward/forward in time", mirrored in right-to-left languages.
    const glyph = (dir < 0) !== rtl ? '‹' : '›';
    return (
      <Pressable
        onPress={() => enabled && shift(dir)}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={dir < 0 ? t('planner.prevMonth') : t('planner.nextMonth')}
        hitSlop={8}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.25 }}
      >
        <Text style={{ fontSize: 28, color: colors.primary, fontWeight: '600' }}>{glyph}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Arrow dir={-1} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }} accessibilityRole="header">
          {monthTitle(ym.y, ym.m, locale)}
        </Text>
        <Arrow dir={1} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {weekOrder(weekStart).map((d) => (
          <Text key={d} style={{ flex: 1, textAlign: 'center', color: colors.muted, fontWeight: '600', fontSize: 13 }}>
            {names[d]}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((date, di) => {
            if (!date) return <View key={di} style={{ flex: 1, height: 44 }} />;
            const disabled = date < minDate || date > maxDate;
            const isSelected = selected.includes(date);
            const isMarked = marked === date;
            const bg = isSelected ? (mode === 'single' ? colors.primary : colors.dangerSoft) : 'transparent';
            const fg = disabled ? colors.border : isSelected ? (mode === 'single' ? colors.primaryText : colors.danger) : colors.text;
            const state = isMarked ? t('planner.dayExam') : isSelected && mode === 'multi' ? t('planner.dayBlocked') : '';
            return (
              <Pressable
                key={date}
                disabled={disabled}
                onPress={() => onToggle(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled }}
                accessibilityLabel={[formatIso(date, locale, { weekday: 'long', day: 'numeric', month: 'long' }), state].filter(Boolean).join(', ')}
                style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: bg,
                    borderWidth: isMarked ? 2 : 0,
                    borderColor: colors.primary,
                  }}
                >
                  <Text
                    style={{
                      color: fg,
                      fontWeight: isSelected || isMarked ? '800' : '500',
                      fontSize: 15,
                      textDecorationLine: isSelected && mode === 'multi' ? 'line-through' : 'none',
                    }}
                  >
                    {Number(date.slice(8, 10))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ countdown

type TFn = TFunction;

export function countdownText(t: TFn, plan: Pick<StudyPlan, 'daysUntilExam'>) {
  if (plan.daysUntilExam < 0) return t('planner.examPassed');
  if (plan.daysUntilExam === 0) return t('planner.examToday');
  return t('planner.daysLeft', { count: plan.daysUntilExam });
}

export function examDateText(t: TFn, plan: Pick<StudyPlan, 'examDate' | 'examTime'>, locale: string) {
  const date = formatIso(plan.examDate, locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return plan.examTime ? t('planner.examOnAt', { date, time: formatTime(plan.examTime, locale) }) : t('planner.examOn', { date });
}

/** Big, visually important exam countdown. */
export function Countdown({ plan, children }: { plan: StudyPlan; children?: ReactNode }) {
  const { t } = useTranslation();
  const locale = useDateLocale();
  return (
    <View style={{ backgroundColor: colors.navy, borderRadius: 20, padding: space(5), gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
        {plan.daysUntilExam > 0 && (
          <Text style={{ color: '#fff', fontSize: 52, fontWeight: '800', lineHeight: 58 }} accessibilityElementsHidden importantForAccessibility="no">
            {plan.daysUntilExam}
          </Text>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: '#fff', fontSize: 19, fontWeight: '700', lineHeight: 25 }} accessibilityRole="header">
            {countdownText(t, plan)}
          </Text>
          <Text style={{ color: '#C9CCF5', fontSize: 14, lineHeight: 20 }}>{examDateText(t, plan, locale)}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

/** Progress (+ readiness when there are results) on the dark countdown card. */
export function PlanStats({ plan }: { plan: StudyPlan }) {
  const { t } = useTranslation();
  const Row = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: '#E6E7FB', fontSize: 14, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{pct(value)}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
  return (
    <View style={{ gap: space(3) }}>
      <Row label={t('planner.progress')} value={plan.progress} color={colors.blue} />
      {plan.readiness !== null ? (
        <>
          <Row label={t('planner.readiness')} value={plan.readiness} color={colors.violet} />
          <Text style={{ color: '#C9CCF5', fontSize: 12, lineHeight: 17 }}>{t('planner.readinessHint')}</Text>
        </>
      ) : (
        // Basic/Free: an even plan without mastery-based readiness (the adaptive plan is Student/Pro).
        <Text style={{ color: '#C9CCF5', fontSize: 13, lineHeight: 18 }}>{plan.adaptive ? t('planner.readinessNone') : t('planner.readinessLocked')}</Text>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ tasks

const ACTIVITY_TONE: Record<TaskActivity, 'primary' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  learn: 'primary',
  practice: 'success',
  exam: 'warning',
  weak_review: 'danger',
  review: 'neutral',
};

export function TaskLine({ task }: { task: StudyTask }) {
  const { t } = useTranslation();
  const done = task.status === 'completed';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 28 }}>
      <Text style={{ color: done ? colors.success : colors.muted, width: 16, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
        {done ? '✓' : '•'}
      </Text>
      <Text style={{ flex: 1, color: done ? colors.muted : colors.text, fontSize: 15, textDecorationLine: done ? 'line-through' : 'none' }} numberOfLines={1}>
        {task.topic ?? t('planner.wholeCourse')} — {t(`planner.activity.${task.activity}`)}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '600' }}>{t('planner.minutes', { count: task.minutes })}</Text>
    </View>
  );
}

type TaskCardProps = {
  task: StudyTask;
  focus?: string;
  focusLanguage: string;
  busy: boolean;
  onStart: () => void;
  onDone: () => void;
  onSkip: () => void;
};

export function TaskCard({ task, focus, focusLanguage, busy, onStart, onDone, onSkip }: TaskCardProps) {
  const { t } = useTranslation();
  const withQuestions = task.activity === 'practice' || task.activity === 'exam';
  const open = task.status === 'pending' || task.status === 'missed';
  const statusBadge =
    task.status === 'completed' ? (
      <Badge label={`✓ ${t('planner.statusDone')}`} tone="success" />
    ) : task.status === 'skipped' ? (
      <Badge label={t('planner.statusSkipped')} tone="neutral" />
    ) : task.status === 'missed' ? (
      <Badge label={t('planner.statusMissed')} tone="warning" />
    ) : null;
  const hint = task.activity === 'learn' ? t('planner.learnHint') : task.activity === 'exam' ? t('planner.examHint') : withQuestions ? null : t('planner.reviewHint');

  return (
    <Card style={{ gap: space(2.5), opacity: task.status === 'completed' || task.status === 'skipped' ? 0.75 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) }}>
        <Badge label={t(`planner.activity.${task.activity}`)} tone={ACTIVITY_TONE[task.activity]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          {statusBadge}
          <Text style={{ color: colors.muted, fontWeight: '700' }}>{t('planner.minutes', { count: task.minutes })}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, lineHeight: 24 }}>{task.topic ?? t('planner.wholeCourse')}</Text>
      <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
        {t(`planner.reason.${task.reason}`)}
        {task.mastery !== null && task.reason !== 'new_material' ? ` · ${t('planner.masteryNow', { pct: pct(task.mastery) })}` : ''}
        {withQuestions && task.questionCount ? ` · ${t('course.questions', { count: task.questionCount })}` : ''}
      </Body>
      {open && !!focus && task.topic && (
        <View style={{ backgroundColor: colors.bg, borderRadius: 10, padding: space(3), gap: space(1) }}>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>{t('planner.focusLabel')}</Text>
          <ContentDirection language={focusLanguage}>
            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{focus}</Text>
          </ContentDirection>
        </View>
      )}
      {open && !!hint && <Body muted style={{ fontSize: 13, lineHeight: 18 }}>{hint}</Body>}
      {open && (
        <View style={{ gap: space(1) }}>
          {withQuestions ? (
            <Button title={task.examId ? t('planner.resume') : task.activity === 'exam' ? t('planner.startExam') : t('planner.startPractice')} onPress={onStart} disabled={busy} />
          ) : (
            <Button variant="secondary" title={t('planner.markDone')} onPress={onDone} disabled={busy} />
          )}
          {!task.examId && <TextButton title={t('planner.skip')} tone="muted" onPress={onSkip} disabled={busy} />}
        </View>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ course card

/** Study-plan entry on the course screen: create one, or see today's focus and the countdown. */
export function StudyPlanCard({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const plan = useQuery({ queryKey: ['study-plan', documentId], queryFn: () => api.getStudyPlan(documentId) });
  const adaptive = useEntitlement().data?.features.adaptivePlanner ?? true;
  if (plan.isLoading || plan.error) return null;
  const open = () => router.push({ pathname: '/plan/[id]', params: { id: documentId } });

  if (!plan.data) {
    return (
      <Card style={{ gap: space(3), borderColor: colors.primarySoft, borderWidth: 2 }}>
        <SectionLabel>{t('nav.studyPlan')}</SectionLabel>
        <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text, lineHeight: 25 }}>{t('planner.cardCreateTitle')}</Text>
        <Body muted style={{ fontSize: 15, lineHeight: 21 }}>{adaptive ? t('planner.cardCreateBody') : t('planner.cardCreateBodyEven')}</Body>
        <Button title={t('planner.create')} onPress={() => router.push({ pathname: '/plan/setup', params: { id: documentId } })} />
      </Card>
    );
  }

  const p = plan.data;
  const today = p.tasks.filter((x) => x.date === p.today && x.status !== 'skipped');
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${t('nav.studyPlan')}, ${countdownText(t, p)}`}>
      <Countdown plan={p}>
        {p.daysUntilExam >= 0 && (
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: space(3.5), gap: space(1.5) }}>
            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>{t('planner.todaysFocus')}</Text>
            {today.length === 0 ? (
              <Body muted style={{ fontSize: 14 }}>{t('planner.nothingToday')}</Body>
            ) : (
              today.slice(0, 3).map((x) => <TaskLine key={x.id} task={x} />)
            )}
            <View style={{ marginTop: space(1) }}>
              <ProgressBar value={p.progress} color={colors.primary} />
            </View>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space(1) }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('planner.open')}</Text>
          <Chevron color="#fff" />
        </View>
      </Countdown>
    </Pressable>
  );
}

/**
 * After an exam: asks — once per course, optionally — when the student's real exam is, and opens
 * the plan setup with it. Hidden when the course already has a plan, when the plan allowance is used
 * up (no paywall ambush), or after "Not now".
 */
export function ExamDatePrompt({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const plan = useQuery({ queryKey: ['study-plan', documentId], queryFn: () => api.getStudyPlan(documentId) });
  const e = useEntitlement().data;
  const key = `exam_date_prompt_${documentId}`;
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void kv.get(key).then((v) => live && setDismissed(v === 'dismissed'));
    return () => {
      live = false;
    };
  }, [key]);
  if (dismissed !== false || plan.isLoading || plan.error || plan.data || !e) return null;
  if (remaining(e.limits.studyPlansPerMonth, e.usage.studyPlansThisMonth) === 0) return null;

  return (
    <Card style={{ gap: space(2.5), borderColor: colors.primarySoft, borderWidth: 2 }}>
      <SectionLabel>{t('nav.studyPlan')}</SectionLabel>
      <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text, lineHeight: 25 }}>{t('planner.promptTitle')}</Text>
      <Body muted style={{ fontSize: 15, lineHeight: 21 }}>{e.features.adaptivePlanner ? t('planner.promptBody') : t('planner.promptBodyEven')}</Body>
      <Button title={t('planner.promptCta')} onPress={() => router.push({ pathname: '/plan/setup', params: { id: documentId, from: 'results' } })} />
      <TextButton
        title={t('common.notNow')}
        tone="muted"
        onPress={() => {
          setDismissed(true);
          void kv.set(key, 'dismissed');
        }}
      />
    </Card>
  );
}
