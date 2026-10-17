/**
 * Flashcards UI pieces shared by the course screen and the deck screen (web, iOS, Android):
 * the two study tiles ("Start an exam" · "Flashcards"), the stacked-cards art, and the flip card.
 * Plain React Native views and the built-in Animated API — no extra dependency. Motion is skipped
 * when the system asks for reduced motion.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, Text, View, type ViewStyle } from 'react-native';
import type { Flashcard } from '@study/shared';
import { Chevron, colors, space } from '@/components/ui';

/** True when the device/browser asks for less motion (iOS/Android setting, `prefers-reduced-motion` on the web). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

const useNative = Platform.OS !== 'web';

// ---------------------------------------------------------------- art

/** Three stacked, slightly fanned cards — the Flashcards mark. */
export function StackedCardsArt({ size = 1 }: { size?: number }) {
  const w = 38 * size;
  const h = 50 * size;
  const card = (bg: string, rotate: string, dx: number, dy: number, top?: ReactNode): ReactNode => (
    <View
      style={{
        position: 'absolute',
        width: w,
        height: h,
        left: 14 * size + dx,
        top: 6 * size + dy,
        borderRadius: 9 * size,
        backgroundColor: bg,
        transform: [{ rotate }],
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: colors.navy,
        shadowOpacity: 0.16,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      {top}
    </View>
  );
  return (
    <View style={{ width: 70 * size, height: 62 * size }} accessibilityElementsHidden importantForAccessibility="no">
      {card(colors.blue, '-12deg', -6 * size, 4 * size)}
      {card(colors.violet, '6deg', 8 * size, 2 * size)}
      {card(
        colors.primary,
        '-2deg',
        1 * size,
        0,
        <>
          <Text style={{ color: colors.primaryText, fontSize: 20 * size, fontWeight: '800', lineHeight: 24 * size }}>?</Text>
          <View style={{ width: 18 * size, height: 3 * size, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)', marginTop: 4 * size }} />
        </>,
      )}
    </View>
  );
}

/** A small answer sheet with ticks — the exam mark. */
export function ExamArt({ size = 1 }: { size?: number }) {
  const row = (done: boolean, width: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 * size }}>
      <View
        style={{
          width: 10 * size,
          height: 10 * size,
          borderRadius: 5 * size,
          backgroundColor: done ? colors.success : colors.card,
          borderWidth: done ? 0 : 1.5,
          borderColor: colors.border,
        }}
      />
      <View style={{ width: width * size, height: 4 * size, borderRadius: 2, backgroundColor: done ? colors.primarySoft : colors.border }} />
    </View>
  );
  return (
    <View style={{ width: 70 * size, height: 62 * size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <View
        style={{
          width: 48 * size,
          height: 56 * size,
          borderRadius: 9 * size,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 7 * size,
          gap: 6 * size,
          justifyContent: 'center',
          shadowColor: colors.navy,
          shadowOpacity: 0.1,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }}
      >
        {row(true, 22)}
        {row(true, 16)}
        {row(false, 20)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- study tiles

type TileProps = {
  art: ReactNode;
  title: string;
  subtitle: string;
  /** Optional status line (e.g. "4 of 10 reviewed"). */
  status?: string | null;
  accent: string;
  accentSoft: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function StudyTile({ art, title, subtitle, status, accent, accentSoft, onPress, loading, disabled }: TileProps) {
  const label = [title, subtitle, status].filter(Boolean).join('. ');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => ({
        flex: 1,
        flexBasis: 150,
        minWidth: 150,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: pressed ? accent : colors.border,
        backgroundColor: colors.card,
        overflow: 'hidden',
        opacity: disabled ? 0.55 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ backgroundColor: accentSoft, paddingVertical: space(3), alignItems: 'center', justifyContent: 'center', minHeight: 86 }}>{art}</View>
      <View style={{ padding: space(3.5), gap: 2, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' }} numberOfLines={2}>
            {title}
          </Text>
          {loading ? <ActivityIndicator size="small" color={accent} /> : <Chevron color={accent} />}
        </View>
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 19 }}>{subtitle}</Text>
        {!!status && <Text style={{ color: accent, fontSize: 13, fontWeight: '700', marginTop: space(1) }}>{status}</Text>}
      </View>
    </Pressable>
  );
}

/** "Start an exam" and "Flashcards", side by side (stacked on very narrow screens). */
export function StudyTiles({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }, style]}>{children}</View>;
}

// ---------------------------------------------------------------- flip card

/**
 * One flashcard. Tapping (or the "Show answer" button / Space on the web) turns it over with a 3D flip;
 * with reduced motion the answer simply replaces the question. Both sides stay in the accessibility
 * tree only when visible.
 */
export function FlipCard({ card, revealed, onFlip, reducedMotion }: { card: Flashcard; revealed: boolean; onFlip: () => void; reducedMotion: boolean }) {
  const { t } = useTranslation();
  const turn = useRef(new Animated.Value(revealed ? 1 : 0)).current;
  const enter = useRef(new Animated.Value(1)).current;
  const [heights, setHeights] = useState<[number, number]>([0, 0]);

  // New card: start on the question side, with a short rise-in.
  useEffect(() => {
    turn.setValue(0);
    setHeights([0, 0]);
    if (reducedMotion) return;
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: useNative }).start();
  }, [card.id]);
  useEffect(() => {
    if (reducedMotion) turn.setValue(revealed ? 1 : 0);
    else Animated.spring(turn, { toValue: revealed ? 1 : 0, friction: 8, tension: 60, useNativeDriver: useNative }).start();
  }, [revealed, reducedMotion]);

  const height = Math.max(240, Math.max(heights[0], heights[1]) + space(12)); // content + the face's padding
  const front = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const back = turn.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const face: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: height,
    borderRadius: 22,
    backfaceVisibility: 'hidden',
    padding: space(6),
    justifyContent: 'center',
    gap: space(3),
  };
  const measure = (i: 0 | 1) => (e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setHeights((prev) => (prev[i] === h ? prev : ((i === 0 ? [h, prev[1]] : [prev[0], h]) as [number, number])));
  };

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {/* The deck behind the card: depth without extra cost. */}
      <View style={{ position: 'absolute', left: space(5), right: space(5), top: 14, height, borderRadius: 22, backgroundColor: colors.violet, opacity: 0.18 }} />
      <View style={{ position: 'absolute', left: space(2.5), right: space(2.5), top: 7, height, borderRadius: 22, backgroundColor: colors.primary, opacity: 0.22 }} />
      <Pressable
        onPress={onFlip}
        accessibilityRole="button"
        accessibilityLabel={revealed ? `${t('flashcards.answer')}: ${card.back}` : `${t('flashcards.question')}: ${card.front}. ${t('flashcards.tapToFlip')}`}
        style={{ height, marginBottom: 14 }}
      >
        {(reducedMotion ? !revealed : true) && (
          <Animated.View
            style={[
              face,
              { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, transform: [{ perspective: 1200 }, { rotateY: reducedMotion ? '0deg' : front }] },
              cardShadow,
            ]}
            importantForAccessibility={revealed ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={revealed}
          >
            <View onLayout={measure(0)} style={{ gap: space(3) }}>
              <Text style={{ alignSelf: 'flex-start', color: colors.primary, backgroundColor: colors.primarySoft, fontSize: 12, fontWeight: '700', paddingHorizontal: space(2.5), paddingVertical: 3, borderRadius: 999, overflow: 'hidden' }} numberOfLines={1}>
                {card.topic}
              </Text>
              <Text style={{ color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '700' }}>{card.front}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{t('flashcards.tapToFlip')}</Text>
            </View>
          </Animated.View>
        )}
        {(reducedMotion ? revealed : true) && (
          <Animated.View
            style={[face, { backgroundColor: colors.navy, transform: [{ perspective: 1200 }, { rotateY: reducedMotion ? '0deg' : back }] }, cardShadow]}
            importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!revealed}
          >
            <View onLayout={measure(1)} style={{ gap: space(3) }}>
              <Text style={{ color: '#B9B4FF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>{t('flashcards.answer')}</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 19, lineHeight: 27, fontWeight: '600' }}>{card.back}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 13, lineHeight: 18, fontStyle: 'italic' }} numberOfLines={3}>
                “{card.sourceQuote}”
              </Text>
            </View>
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const cardShadow: ViewStyle = {
  shadowColor: colors.navy,
  shadowOpacity: 0.14,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
};

/** "Needs practice" / "I knew it": large, colour-coded and labelled. */
export function AnswerButton({ title, hint, tone, onPress, disabled }: { title: string; hint?: string; tone: 'practice' | 'known'; onPress: () => void; disabled?: boolean }) {
  const fg = tone === 'known' ? colors.success : colors.warning;
  const bg = tone === 'known' ? colors.successSoft : colors.warningSoft;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: fg,
        backgroundColor: pressed ? fg : bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space(3),
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {({ pressed }) => (
        <>
          <Text style={{ color: pressed ? colors.primaryText : fg, fontSize: 16, fontWeight: '800' }}>{title}</Text>
          {!!hint && <Text style={{ color: pressed ? colors.primaryText : fg, fontSize: 12, opacity: 0.8 }}>{hint}</Text>}
        </>
      )}
    </Pressable>
  );
}
