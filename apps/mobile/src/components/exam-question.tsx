/**
 * Building blocks of the exam screen (app/exams/[id].tsx): the progress header, the question map,
 * answer options and the written-answer box. Layout only — answers, drafts and submitting stay in
 * the screen. Every row uses logical (start/end) layout, so the screen mirrors in Arabic; exam
 * content keeps its own direction (ContentDirection).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, ContentDirection, space } from '@/components/ui';
import { countWords, type QuestionState } from '@/lib/exam-ui';

const ON_NAVY_MUTED = '#C3C6EC'; // ≥ 7:1 on navy
const ON_NAVY_SUCCESS = '#86EFAC';

// ------------------------------------------------------------------ header

export function ExamHero({
  label,
  index,
  states,
  answered,
  onOpenMap,
  onGoTo,
  firstUnanswered,
  isLast,
}: {
  label: string;
  index: number;
  states: QuestionState[];
  answered: number;
  onOpenMap: () => void;
  onGoTo: (i: number) => void;
  firstUnanswered: number | null;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const total = states.length;
  const all = answered === total;
  return (
    <View style={{ backgroundColor: colors.navy, borderRadius: 20, padding: space(4), gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) }}>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: space(3), paddingVertical: space(1) }}>
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>{label}</Text>
        </View>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>{t('exam.questionOf', { current: index + 1, total })}</Text>
      </View>

      {/* One segment per question: answered, current, still open. */}
      <View
        style={{ flexDirection: 'row', gap: total > 20 ? 2 : 4 }}
        accessibilityRole="progressbar"
        accessibilityLabel={t('exam.progressShort', { answered, total })}
        accessibilityValue={{ min: 0, max: total, now: answered }}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        {states.map((s, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: s === 'current' ? 8 : 6,
              alignSelf: 'center',
              borderRadius: 4,
              backgroundColor: s === 'current' ? '#FFFFFF' : s === 'answered' ? colors.violet : 'rgba(255,255,255,0.2)',
            }}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2), flexWrap: 'wrap' }}>
        <Text style={{ color: all ? ON_NAVY_SUCCESS : ON_NAVY_MUTED, fontSize: 14, fontWeight: all ? '700' : '500', flexShrink: 1 }}>
          {all ? t('exam.allAnswered') : t('exam.progressShort', { answered, total })}
        </Text>
        {total > 1 && (
          <Pressable
            onPress={onOpenMap}
            accessibilityRole="button"
            accessibilityLabel={t('exam.mapOpen')}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(1.5),
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.35)',
              paddingHorizontal: space(3),
              paddingVertical: space(1.5),
              minHeight: 36,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <MapGlyph />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{t('exam.mapOpen')}</Text>
          </Pressable>
        )}
      </View>

      {isLast && firstUnanswered !== null && (
        <Pressable onPress={() => onGoTo(firstUnanswered)} accessibilityRole="button" hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' }}>
            {t('exam.goToUnanswered', { n: firstUnanswered + 1 })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Four small squares: "all questions". Decorative. */
function MapGlyph() {
  const cell = { width: 5, height: 5, borderRadius: 1.5, backgroundColor: '#FFFFFF' };
  return (
    <View style={{ width: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no">
      <View style={cell} />
      <View style={cell} />
      <View style={cell} />
      <View style={cell} />
    </View>
  );
}

// ------------------------------------------------------------------ question map

/** Every question as a numbered tile; tap one to go there. Opens over the exam. */
export function QuestionMap({ visible, states, answered, currentAnswered, onPick, onClose }: {
  visible: boolean;
  states: QuestionState[];
  answered: number;
  currentAnswered: boolean;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: 'rgba(21,23,63,0.55)', justifyContent: 'center', padding: space(4) }}>
        <Pressable style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: space(5), gap: space(4), maxWidth: 520, width: '100%', alignSelf: 'center', maxHeight: '90%' }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }} accessibilityRole="header">
            {t('exam.mapTitle')}
          </Text>
          <View style={{ flexDirection: 'row', gap: space(4), flexWrap: 'wrap' }}>
            <Legend color={colors.primary} label={t('exam.mapCurrent')} />
            <Legend color={colors.primarySoft} border={colors.primary} label={t('exam.mapAnswered')} />
            <Legend color={colors.card} border={colors.border} label={t('exam.mapUnanswered')} />
          </View>
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) }}>
            {states.map((s, i) => {
              const answeredHere = s === 'answered' || (s === 'current' && currentAnswered);
              const stateLabel = [s === 'current' ? t('exam.mapCurrent') : null, answeredHere ? t('exam.mapAnswered') : t('exam.mapUnanswered')].filter(Boolean).join(', ');
              return (
                <Pressable
                  key={i}
                  onPress={() => onPick(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('exam.jumpTo', { n: i + 1 })}, ${stateLabel}`}
                  accessibilityState={{ selected: s === 'current' }}
                  style={({ pressed }) => ({
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: s === 'unanswered' ? 1.5 : 2,
                    borderColor: s === 'unanswered' ? colors.border : colors.primary,
                    backgroundColor: s === 'current' ? colors.primary : s === 'answered' ? colors.primarySoft : colors.card,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={{ fontSize: 16, fontWeight: '700', color: s === 'current' ? colors.primaryText : s === 'answered' ? colors.primary : colors.muted }}>{i + 1}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 14 }}>{t('exam.progressShort', { answered, total: states.length })}</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, opacity: pressed ? 0.75 : 1 })}
          >
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Legend({ color, border, label }: { color: string; border?: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, borderWidth: border ? 1.5 : 0, borderColor: border }} />
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ question

/** The question card: number, type, topic and the question itself. */
export function QuestionCard({ n, typeLabel, topic, language, children }: { n: number; typeLabel: string; topic: string; language: string; children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 20,
        padding: space(5),
        gap: space(3.5),
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.navy,
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <View
          style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Text style={{ color: colors.primaryText, fontSize: 18, fontWeight: '800' }}>{n}</Text>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), alignItems: 'center' }}>
          <Pill label={typeLabel} bg={colors.bg} fg={colors.muted} />
          <ContentDirection language={language} style={{ flexShrink: 1 }}>
            <Pill label={topic} bg={colors.primarySoft} fg={colors.primary} />
          </ContentDirection>
        </View>
      </View>
      {children}
    </View>
  );
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: space(2.5), paddingVertical: space(1), flexShrink: 1 }}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** One multiple-choice answer: a radio with its letter, the text, and a check when chosen. */
export function OptionCard({ letter, text, selected, onPress, language }: { letter: string; text: string; selected: boolean; onPress: () => void; language: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      // react-native-web does not turn accessibilityState into ARIA attributes; screen readers on the web need this.
      aria-checked={selected}
      accessibilityLabel={text}
      // Space chooses too (react-native-web only maps Space to a press for role="button"; ignored on iOS/Android).
      {...({ onKeyDown: (e: { key?: string; preventDefault?: () => void }) => (e.key === ' ' || e.key === 'Spacebar' ? (e.preventDefault?.(), onPress()) : undefined) } as object)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(3),
        minHeight: 64,
        paddingVertical: space(3.5),
        paddingHorizontal: space(4),
        borderRadius: 16,
        borderWidth: 2,
        borderColor: selected ? colors.primary : hovered ? '#C9C4FB' : colors.border,
        backgroundColor: selected ? colors.primarySoft : pressed ? '#FAFAFF' : colors.card,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? colors.primary : colors.bg,
          borderWidth: selected ? 0 : 1,
          borderColor: colors.border,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Text style={{ color: selected ? colors.primaryText : colors.navy, fontWeight: '800', fontSize: 15 }}>{letter}</Text>
      </View>
      <ContentDirection language={language} style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, lineHeight: 23, color: colors.text, fontWeight: selected ? '600' : '400' }}>{text}</Text>
      </ContentDirection>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : 'transparent',
        }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {selected && <Text style={{ color: colors.primaryText, fontSize: 13, fontWeight: '800', lineHeight: 15 }}>✓</Text>}
      </View>
    </Pressable>
  );
}

/** Written answer: a roomy box that highlights while typing, with a word count. */
export function WrittenAnswer({ value, onChange, language, placeholder, label }: { value: string; onChange: (v: string) => void; language: string; placeholder: string; label: string }) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const words = countWords(value);
  return (
    <View style={{ gap: space(1.5) }}>
      <ContentDirection language={language}>
        <TextInput
          multiline
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel={label}
          style={{
            minHeight: 160,
            textAlignVertical: 'top',
            borderWidth: 2,
            borderColor: focused ? colors.primary : colors.border,
            borderRadius: 16,
            padding: space(4),
            fontSize: 16,
            lineHeight: 24,
            backgroundColor: focused ? '#FCFCFF' : colors.card,
            color: colors.text,
          }}
        />
      </ContentDirection>
      <Text style={{ color: colors.muted, fontSize: 13, alignSelf: 'flex-end' }}>{t('exam.wordCount', { count: words })}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ motion

/** Fades and lifts each new question in (skipped when the system asks for reduced motion). */
export function QuestionEnter({ children }: { children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) progress.setValue(1);
        else Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: false }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [progress]);
  return (
    <Animated.View style={{ gap: space(4), opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
