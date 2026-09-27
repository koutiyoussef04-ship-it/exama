import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  I18nManager,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { isRtlLanguage } from '@study/shared';
import { errorMessage } from '@/lib/errors';

/** Exama palette: deep navy + violet→blue accent from the logo. */
export const colors = {
  bg: '#F6F7FB',
  card: '#FFFFFF',
  text: '#14161F',
  muted: '#646A7E',
  border: '#E3E5EE',
  primary: '#5B4CF5',
  primarySoft: '#EEEDFF',
  navy: '#15173F',
  violet: '#8B5CF6',
  blue: '#5B8DEF',
  primaryText: '#FFFFFF',
  success: '#16A34A',
  successSoft: '#E8F7EE',
  warning: '#D97706',
  warningSoft: '#FDF3E3',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
};

export const space = (n: number) => n * 4;

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  /** Include the top safe-area inset (for screens without a navigation header). */
  topInset?: boolean;
  /** Enables pull-to-refresh when provided. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function Screen({ children, scroll = true, topInset, onRefresh, refreshing = false }: ScreenProps) {
  const edges: Edge[] = topInset ? ['top', 'bottom', 'left', 'right'] : ['bottom', 'left', 'right'];
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          // First tap on a button works even while the keyboard is open.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text style={[styles.title, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: TextStyle; numberOfLines?: number }) {
  return (
    <Text style={[styles.body, muted && { color: colors.muted }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Small uppercase label used as a section/card heading. */
export function SectionLabel({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  // Letter-spacing breaks the joined letters of Arabic script.
  return <Text style={[styles.sectionLabel, isRtlLanguage(i18n.language) && { letterSpacing: 0 }]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
const badgeTones: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.bg, fg: colors.muted },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const t = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? { backgroundColor: colors.primary } : { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
        pressed && { opacity: 0.75 },
        disabled && !loading && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={[styles.buttonText, { color: isPrimary ? colors.primaryText : variant === 'danger' ? colors.danger : colors.primary }]} numberOfLines={2}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Low-emphasis text button (e.g. destructive or secondary actions at the bottom of a screen). */
export function TextButton({ title, onPress, tone = 'primary', disabled }: { title: string; onPress: () => void; tone?: 'primary' | 'danger' | 'muted'; disabled?: boolean }) {
  const color = tone === 'danger' ? colors.danger : tone === 'muted' ? colors.muted : colors.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => [styles.textButton, (pressed || disabled) && { opacity: 0.5 }]}>
      <Text style={{ color, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: space(1.5) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...rest} />
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color ?? scoreColor(value) }]} />
    </View>
  );
}

export const scoreColor = (v: number) => (v >= 0.7 ? colors.success : v >= 0.4 ? colors.warning : colors.danger);
export const scoreTone = (v: number): BadgeTone => (v >= 0.7 ? 'success' : v >= 0.4 ? 'warning' : 'danger');
export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Error message in the user's language (API errors are translated from their codes). */
export function ErrorText({ error }: { error: unknown }) {
  useTranslation(); // re-render on language change
  if (!error) return null;
  return (
    <Text style={styles.errorText} accessibilityRole="alert">
      {errorMessage(error)}
    </Text>
  );
}

/** Full-width error with a retry action, for screens whose data failed to load. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card style={{ gap: space(3) }}>
      <Body style={{ fontWeight: '600' }}>{t('common.somethingWrong')}</Body>
      <ErrorText error={error} />
      {onRetry && <Button variant="secondary" title={t('common.tryAgain')} onPress={onRetry} />}
    </Card>
  );
}

/**
 * Lays out AI-generated content in its own direction (e.g. an Arabic exam inside an English UI,
 * or English course text inside the Arabic UI). `language` is the content's ISO code.
 */
export function ContentDirection({ language, children, style }: { language: string | null | undefined; children: ReactNode; style?: ViewStyle }) {
  const rtl = isRtlLanguage(language);
  if (!language || rtl === I18nManager.isRTL) return <View style={style}>{children}</View>;
  return <View style={[{ direction: rtl ? 'rtl' : 'ltr' }, style]}>{children}</View>;
}

/** Forward chevron that points the right way in RTL layouts. */
export function Chevron({ color = colors.muted }: { color?: string }) {
  const { i18n } = useTranslation();
  return (
    <Text style={{ color, fontSize: 22 }} accessibilityElementsHidden importantForAccessibility="no">
      {I18nManager.isRTL || isRtlLanguage(i18n.language) ? '‹' : '›'}
    </Text>
  );
}

/** Tappable settings row: label, optional value, chevron. */
export function ListRow({ label, value, onPress, tone = 'default', last, accessibilityHint }: {
  label: string;
  value?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  last?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.rowLabel, tone === 'danger' && { color: colors.danger }]}>{label}</Text>
      {!!value && (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      <Chevron />
    </Pressable>
  );
}

/** Accessible checkbox row. */
export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 44 }}
    >
      <View style={[styles.checkbox, checked && { backgroundColor: colors.danger, borderColor: colors.danger }]}>
        {checked && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>✓</Text>}
      </View>
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space(8), gap: space(3) }}>
      <Text style={[styles.body, { fontWeight: '700', fontSize: 18 }]}>{title}</Text>
      {children}
    </Card>
  );
}

/** Card with a spinner for long-running work (AI processing, grading…). */
export function WorkingCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(4) }}>
      <ActivityIndicator color={colors.primary} />
      <View style={{ flex: 1, gap: space(1) }}>
        <Body style={{ fontWeight: '600' }}>{title}</Body>
        {detail && <Body muted style={{ fontSize: 14, lineHeight: 20 }}>{detail}</Body>}
      </View>
    </Card>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8), backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(8), gap: space(4), maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: 22, lineHeight: 29, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: space(4), gap: space(2), borderWidth: 1, borderColor: colors.border },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: space(2.5), paddingVertical: space(1) },
  badgeText: { fontSize: 13, fontWeight: '600' },
  button: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(4), paddingVertical: space(2) },
  buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52, paddingVertical: space(2) },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { flex: 1, fontSize: 16, color: colors.text },
  rowValue: { fontSize: 15, color: colors.muted, maxWidth: '50%' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    fontSize: 16,
    color: colors.text,
  },
  errorText: { color: colors.danger, fontSize: 15, lineHeight: 21 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
