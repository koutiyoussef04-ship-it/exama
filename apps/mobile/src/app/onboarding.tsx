/**
 * Student onboarding: five short questions, shown once to a new account right after sign-up.
 * One question per screen with a progress label, large answer cards, Back/Continue (answers are
 * kept), a way to skip, and a short "all set" screen that leads to the first useful action. The
 * step logic and what the answers change live in lib/onboarding.ts (unit tested).
 */
import { ONBOARDING_QUESTIONS, type OnboardingState } from '@study/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, Card, colors, ErrorText, Loading, ProgressBar, Screen, space, TextButton, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  canContinue,
  currentQuestion,
  doneAdvice,
  draftKey,
  flowReducer,
  initialFlow,
  isComplete,
  isLastStep,
  onboardingGate,
  parseDraft,
  progressFraction,
  progressParams,
  serializeDraft,
} from '@/lib/onboarding';
import { kv } from '@/lib/storage';
import { onboardingKey, useOnboarding } from '@/lib/use-onboarding';

/**
 * Radios are chosen with Space as well as Enter. react-native-web only maps Space to a press for
 * role="button", so the web handler is added here (the prop does not exist in the native types and
 * is ignored on iOS/Android).
 */
function spaceSelects(select: () => void) {
  return {
    onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault?.();
        select();
      }
    },
  };
}

export default function Onboarding() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const onboarding = useOnboarding();
  const [flow, dispatch] = useReducer(flowReducer, undefined, initialFlow);
  const [draftLoaded, setDraftLoaded] = useState(false);
  /** Set once the answers are saved: the "all set" screen. The shared state is only updated when the student leaves it. */
  const [saved, setSaved] = useState<OnboardingState | null>(null);
  const userId = user?.id;

  // Resume where the student left off (refresh, closed tab, interrupted session) — on this device.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void kv.get(draftKey(userId)).then((raw) => {
      if (cancelled) return;
      const draft = parseDraft(raw);
      if (draft) dispatch({ type: 'restore', state: draft });
      setDraftLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => {
    if (userId && draftLoaded && !saved) void kv.set(draftKey(userId), serializeDraft(flow));
  }, [userId, draftLoaded, saved, flow]);

  const finish = (state: OnboardingState) => {
    if (userId) {
      void kv.remove(draftKey(userId));
      qc.setQueryData(onboardingKey(userId), state);
    }
  };

  const save = useMutation({
    mutationFn: () => {
      if (!isComplete(flow.answers)) throw new Error('incomplete'); // the button is disabled until every question is answered
      return api.saveOnboarding(flow.answers);
    },
    onSuccess: (state) => {
      if (userId) void kv.remove(draftKey(userId));
      setSaved(state);
    },
  });
  const skip = useMutation({
    mutationFn: api.skipOnboarding,
    onSuccess: (state) => {
      finish(state);
      router.replace('/');
    },
  });

  const gate = onboardingGate(onboarding);
  if (gate === 'loading' || !draftLoaded) return <Loading />;
  // Only a new account that hasn't answered or skipped sees the questions (also covers typing the URL by hand).
  if (!saved && gate === 'proceed') return <Redirect href="/" />;

  if (saved?.answers) {
    const advice = doneAdvice(saved.answers);
    const leave = (addMaterial: boolean) => {
      finish(saved);
      router.replace('/');
      if (addMaterial) router.push('/add-material');
    };
    return (
      <Screen topInset>
        <Card style={{ gap: space(3), alignItems: 'flex-start' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.success, fontSize: 22, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
              ✓
            </Text>
          </View>
          <Title>{t('onboarding.doneTitle')}</Title>
          <Body muted>{t(advice.tone === 'soon' ? 'onboarding.doneSoon' : advice.tone === 'later' ? 'onboarding.doneLater' : 'onboarding.doneNoExam')}</Body>
          {advice.lecturesNote && <Body muted>{t('onboarding.doneLectures')}</Body>}
          {advice.planNote && <Body muted>{t('onboarding.donePlan')}</Body>}
        </Card>
        <Button title={t('onboarding.doneAdd')} onPress={() => leave(true)} />
        <TextButton title={t('onboarding.doneBrowse')} tone="muted" onPress={() => leave(false)} />
      </Screen>
    );
  }

  const question = currentQuestion(flow);
  const options = ONBOARDING_QUESTIONS[question];
  const answer = flow.answers[question];
  const last = isLastStep(flow);
  const busy = save.isPending || skip.isPending;
  // The question keys are fixed (shared contract); this only widens them for the typed translator.
  const tr = (key: string) => t(key as 'onboarding.skip');

  return (
    <Screen topInset>
      <View style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '700' }} accessibilityLiveRegion="polite">
            {t('onboarding.progress', progressParams(flow))}
          </Text>
          <TextButton title={t('onboarding.skip')} tone="muted" onPress={() => skip.mutate()} disabled={busy} />
        </View>
        <ProgressBar value={progressFraction(flow)} color={colors.primary} />
      </View>

      <View style={{ gap: space(1) }}>
        <Title>{tr(`onboarding.${question}.title`)}</Title>
        <Body muted>{tr(`onboarding.${question}.hint`)}</Body>
      </View>

      <View style={{ gap: space(2.5) }} accessibilityRole="radiogroup" accessibilityLabel={tr(`onboarding.${question}.title`)}>
        {options.map((option) => {
          const selected = answer === option;
          const label = tr(`onboarding.${question}.options.${option}`);
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected, disabled: busy }}
              // react-native-web does not turn accessibilityState into ARIA attributes; screen readers on the web need these.
              aria-checked={selected}
              aria-disabled={busy}
              disabled={busy}
              onPress={() => dispatch({ type: 'select', question, value: option })}
              {...spaceSelects(() => !busy && dispatch({ type: 'select', question, value: option }))}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                minHeight: 56,
                paddingHorizontal: space(4),
                paddingVertical: space(3),
                borderRadius: 14,
                borderWidth: 2,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primarySoft : colors.card,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primaryText }} />}
              </View>
              <Text style={{ flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: selected ? '700' : '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ErrorText error={save.error ?? skip.error} />
      {!!save.error && <Body muted style={{ fontSize: 14 }}>{t('onboarding.retryHint')}</Body>}

      <View style={{ flexDirection: 'row', gap: space(3) }}>
        {flow.step > 0 && (
          <View style={{ flex: 1 }}>
            <Button variant="secondary" title={t('common.back')} onPress={() => dispatch({ type: 'back' })} disabled={busy} />
          </View>
        )}
        <View style={{ flex: 2 }}>
          <Button
            title={last ? t('onboarding.finish') : t('onboarding.continue')}
            onPress={() => {
              if (!last) dispatch({ type: 'next' });
              else if (!save.isPending) save.mutate();
            }}
            loading={save.isPending}
            disabled={!canContinue(flow) || (last && !isComplete(flow.answers)) || skip.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
