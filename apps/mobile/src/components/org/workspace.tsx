/**
 * The organization workspace shell and its building blocks. Desktop-first: on wide screens (≥ 1024 px)
 * a fixed left sidebar (organization, sections, account) next to a wide content column; on narrower
 * screens a compact top bar with a scrollable section row and the same content in one column. Same
 * palette and type as the student app; purple only on the active section and primary actions.
 *
 * Also here: the page header, data table (cards on small screens), search field, filter menu, segmented
 * control, pagination and compact buttons the organization screens share. Nothing in `ui.tsx` changes.
 */
import type { OrganizationMembershipSummary } from '@study/shared';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/org/icons';
import { colors, space } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canAdmin, roleLabel, useCurrentOrg } from '@/lib/org';

export const WIDE_BREAKPOINT = 1024;
export const SIDEBAR_WIDTH = 248;
export const CONTENT_MAX_WIDTH = 1280;

/** True on screens wide enough for the sidebar layout. */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

export type OrgSection = 'dashboard' | 'courses' | 'review' | 'bank' | 'export' | 'members';
type SectionPath = '/org' | '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members';
const SECTIONS: { value: OrgSection; path: SectionPath; icon: IconName }[] = [
  { value: 'dashboard', path: '/org', icon: 'dashboard' },
  { value: 'courses', path: '/org/courses', icon: 'courses' },
  { value: 'review', path: '/org/review', icon: 'review' },
  { value: 'bank', path: '/org/bank', icon: 'bank' },
  { value: 'export', path: '/org/export', icon: 'export' },
  { value: 'members', path: '/org/members', icon: 'members' },
];

export type OrgContext = { org: OrganizationMembershipSummary; orgs: OrganizationMembershipSummary[]; switchOrg: (id: string) => void };

/**
 * Resolves the current organization before a screen renders (so its hooks can rely on `org.id`).
 * Without any membership the dashboard explains what to do, so other screens send the user there.
 */
export function OrgGate({ children }: { children: (ctx: OrgContext) => ReactNode }) {
  const { org, orgs, setCurrent, ready } = useCurrentOrg();
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  if (!org) return <Redirect href="/org" />;
  return <>{children({ org, orgs, switchOrg: setCurrent })}</>;
}

type ShellProps = OrgContext & {
  active: OrgSection;
  /** Page header. */
  title: string;
  subtitle?: string;
  /** Buttons on the right of the header (wide) or under it (narrow). */
  actions?: ReactNode;
  /** Detail pages: where the back control goes (narrow: top bar; wide: a link above the title). */
  back?: { label: string; onPress: () => void };
  /** Pending drafts, shown next to the Review section. */
  draftCount?: number;
  /** Fixed bar under the content (the review actions). */
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Content column width on wide screens (forms read better narrower). */
  maxWidth?: number;
  children: ReactNode;
};

export function WorkspaceShell(p: ShellProps) {
  const wide = useIsWide();
  const refresh = p.onRefresh ? <RefreshControl refreshing={!!p.refreshing} onRefresh={p.onRefresh} tintColor={colors.primary} /> : undefined;
  const header = (
    <View style={{ gap: space(3) }}>
      {p.back && wide && (
        <Pressable accessibilityRole="button" onPress={p.back.onPress} hitSlop={8} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(1), alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}>
          <Icon name="back" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>{p.back.label}</Text>
        </Pressable>
      )}
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'stretch', gap: space(3) }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: wide ? 24 : 20, fontWeight: '700', lineHeight: wide ? 30 : 26 }} accessibilityRole="header">
            {p.title}
          </Text>
          {!!p.subtitle && <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{p.subtitle}</Text>}
        </View>
        {p.actions && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>{p.actions}</View>}
      </View>
    </View>
  );

  if (wide) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom', 'left', 'right']}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Sidebar {...p} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: space(8), paddingBottom: space(12), gap: space(6), maxWidth: p.maxWidth ?? CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }}
              keyboardShouldPersistTaps="handled"
              refreshControl={refresh}
            >
              {header}
              {p.children}
            </ScrollView>
            {p.footer && <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: space(8), paddingVertical: space(3) }}>{p.footer}</View>}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom', 'left', 'right']}>
      <TopBar {...p} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space(4), paddingBottom: space(10), gap: space(4) }} keyboardShouldPersistTaps="handled" refreshControl={refresh}>
        {header}
        {p.children}
      </ScrollView>
      {p.footer && <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, padding: space(3) }}>{p.footer}</View>}
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------ sidebar (wide)

function Sidebar({ org, orgs, switchOrg, active, draftCount }: ShellProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [switching, setSwitching] = useState(false);
  const others = orgs.filter((o) => o.id !== org.id);
  const sections = SECTIONS.filter((s) => s.value !== 'members' || canAdmin(org.role));

  return (
    <View style={{ width: SIDEBAR_WIDTH, backgroundColor: colors.card, borderRightWidth: 1, borderRightColor: colors.border, paddingVertical: space(5), paddingHorizontal: space(3), justifyContent: 'space-between' }}>
      <View style={{ gap: space(5) }}>
        <View style={{ paddingHorizontal: space(2), gap: space(1) }}>
          {/* i18n-ignore */}
          <Text style={{ color: colors.navy, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>Exama</Text>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('org.ws.workspace')}</Text>
        </View>

        <View style={{ gap: space(1) }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={others.length ? t('org.nav.switchOrg') : org.name}
            disabled={!others.length}
            onPress={() => setSwitching((v) => !v)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(2), borderRadius: 10, backgroundColor: colors.bg, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
              {/* i18n-ignore */}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{org.name.trim().charAt(0).toUpperCase() || '·'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                {org.name}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{roleLabel(org.role)}</Text>
            </View>
            {others.length > 0 && <Icon name="chevronDown" size={16} />}
          </Pressable>
          {switching &&
            others.map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                accessibilityLabel={t('org.nav.switchTo', { name: o.name })}
                onPress={() => {
                  setSwitching(false);
                  switchOrg(o.id);
                }}
                style={({ pressed }) => ({ paddingVertical: space(2), paddingHorizontal: space(3), borderRadius: 8, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>
                  {o.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{roleLabel(o.role)}</Text>
              </Pressable>
            ))}
        </View>

        <View style={{ gap: 2 }} accessibilityRole="tablist">
          {sections.map((s) => (
            <NavItem key={s.value} icon={s.icon} label={t(`org.nav.${s.value}`)} active={s.value === active} count={s.value === 'review' ? draftCount : undefined} onPress={() => s.value !== active && router.push({ pathname: s.path, params: { orgId: org.id } })} />
          ))}
        </View>
      </View>

      <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(3) }}>
        {user?.accountType === 'student' && <NavItem icon="courses" label={t('org.ws.myCourses')} onPress={() => router.push('/')} />}
        <NavItem icon="help" label={t('org.ws.support')} onPress={() => router.push('/support')} />
        <NavItem icon="account" label={t('org.nav.account')} onPress={() => router.push('/account')} />
      </View>
    </View>
  );
}

function NavItem({ icon, label, active, count, onPress }: { icon: IconName; label: string; active?: boolean; count?: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      aria-selected={!!active}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5), paddingHorizontal: space(3), borderRadius: 8, backgroundColor: active ? colors.primarySoft : pressed ? colors.bg : 'transparent' })}
    >
      <Icon name={icon} size={18} color={active ? colors.primary : colors.muted} />
      <Text style={{ flex: 1, color: active ? colors.primary : colors.text, fontSize: 14, fontWeight: active ? '600' : '500' }}>{label}</Text>
      {count != null && count > 0 && (
        <View style={{ minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: active ? colors.primary : colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: active ? colors.primaryText : colors.muted, fontSize: 12, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------------ top bar + tabs (narrow)

function TopBar({ org, orgs, switchOrg, active, back, draftCount }: ShellProps) {
  const { t } = useTranslation();
  const [switching, setSwitching] = useState(false);
  const others = orgs.filter((o) => o.id !== org.id);
  const sections = SECTIONS.filter((s) => s.value !== 'members' || canAdmin(org.role));
  return (
    <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(3), paddingVertical: space(2), minHeight: 52 }}>
        {back ? (
          <IconButton icon="back" label={back.label} onPress={back.onPress} />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
            {/* i18n-ignore */}
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{org.name.trim().charAt(0).toUpperCase() || '·'}</Text>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={others.length ? t('org.nav.switchOrg') : org.name} disabled={!others.length} onPress={() => setSwitching((v) => !v)} style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {org.name}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{roleLabel(org.role)}{others.length ? ` · ${t('org.nav.switchOrg')}` : ''}</Text>
        </Pressable>
        <IconButton icon="account" label={t('org.nav.account')} onPress={() => router.push('/account')} />
      </View>
      {switching &&
        others.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={t('org.nav.switchTo', { name: o.name })}
            onPress={() => {
              setSwitching(false);
              switchOrg(o.id);
            }}
            style={{ paddingVertical: space(2.5), paddingHorizontal: space(4), borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontSize: 15 }}>{o.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{roleLabel(o.role)}</Text>
          </Pressable>
        ))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(3), gap: space(1) }} accessibilityRole="tablist">
        {sections.map((s) => {
          const selected = s.value === active;
          return (
            <Pressable
              key={s.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => !selected && router.push({ pathname: s.path, params: { orgId: org.id } })}
              style={{ paddingHorizontal: space(3), paddingVertical: space(2.5), borderBottomWidth: 2, borderBottomColor: selected ? colors.primary : 'transparent', flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}
            >
              <Text style={{ color: selected ? colors.primary : colors.muted, fontWeight: '600', fontSize: 14 }}>{t(`org.nav.${s.value}`)}</Text>
              {s.value === 'review' && !!draftCount && (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: selected ? colors.primary : colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: selected ? colors.primaryText : colors.muted, fontSize: 11, fontWeight: '700' }}>{draftCount > 99 ? '99+' : draftCount}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ buttons

type SmallButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  /** Keyboard hint shown after the title on the web (e.g. "A"). */
  shortcut?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

/** Compact button for toolbars and action bars (36 px). The student app keeps its larger `Button`. */
export function SmallButton({ title, onPress, variant = 'secondary', icon, shortcut, loading, disabled, style }: SmallButtonProps) {
  const wide = useIsWide();
  const off = disabled || loading;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : variant === 'ghost' ? 'transparent' : colors.card;
  const fg = variant === 'primary' ? colors.primaryText : variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.primary : colors.text;
  const border = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : variant === 'ghost' ? 'transparent' : colors.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 36, paddingHorizontal: space(3.5), borderRadius: 8, borderWidth: 1, borderColor: border, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), opacity: off ? 0.5 : pressed ? 0.75 : 1 }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>{title}</Text>
      {!!shortcut && wide && Platform.OS === 'web' && (
        <View style={{ paddingHorizontal: 5, height: 18, borderRadius: 4, backgroundColor: variant === 'primary' ? 'rgba(255,255,255,0.22)' : colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{shortcut}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, disabled, color }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.bg : 'transparent', opacity: disabled ? 0.4 : 1 })}>
      <Icon name={icon} size={18} color={color ?? colors.text} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ toolbar controls

/** Search box with a short debounce; `onChange` receives the trimmed text. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(value), [value]);
  const update = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v.trim()), 300);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 38, paddingHorizontal: space(3), borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, minWidth: 220, flexGrow: 1, maxWidth: 420 }}>
      <Icon name="search" size={16} />
      <TextInput value={text} onChangeText={update} placeholder={placeholder} placeholderTextColor={colors.muted} accessibilityLabel={placeholder} autoCorrect={false} returnKeyType="search" style={{ flex: 1, fontSize: 14, color: colors.text, paddingVertical: 6, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) }} />
      {!!text && (
        <Pressable accessibilityRole="button" accessibilityLabel={'×'} onPress={() => update('')} hitSlop={8}>
          <Icon name="close" size={14} />
        </Pressable>
      )}
    </View>
  );
}

export type Option<T extends string> = { value: T; label: string };

/** A labelled drop-down: tapping opens a list in a sheet. Small enough for toolbars; works on every platform. */
export function FilterSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Option<T>[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} onPress={() => setOpen(true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(1.5), minHeight: 38, paddingLeft: space(3), paddingRight: space(2), borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, maxWidth: 320, opacity: pressed ? 0.75 : 1 })}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
          {current}
        </Text>
        <Icon name="chevronDown" size={14} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,22,31,0.35)', justifyContent: 'center', padding: space(4) }} onPress={() => setOpen(false)} accessibilityLabel={label}>
          <View style={{ alignSelf: 'center', width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
            </View>
            <ScrollView>
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    onPress={() => {
                      setOpen(false);
                      onChange(o.value);
                    }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3), backgroundColor: selected ? colors.primarySoft : pressed ? colors.bg : 'transparent' })}
                  >
                    <Text style={{ flex: 1, color: selected ? colors.primary : colors.text, fontSize: 15, fontWeight: selected ? '600' : '400' }} numberOfLines={2}>
                      {o.label}
                    </Text>
                    {selected && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Compact pill group for two or three mutually exclusive choices (e.g. all / needs attention / no issues). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden', alignSelf: 'flex-start' }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => onChange(o.value)} style={{ paddingHorizontal: space(3), minHeight: 36, justifyContent: 'center', backgroundColor: selected ? colors.primarySoft : 'transparent', borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: colors.border }}>
            <Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Row of toolbar controls that wraps on small screens. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) }}>{children}</View>;
}

// ------------------------------------------------------------------ table

export type Column<Row> = {
  key: string;
  title: string;
  /** Relative width on wide screens (default 1). */
  flex?: number;
  /** Fixed width instead of flex. */
  width?: number;
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
};

type TableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  keyOf: (row: Row) => string;
  onRowPress?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  /** Small screens: how one row renders as a card. Falls back to the first column plus the others as label/value lines. */
  renderCard?: (row: Row) => ReactNode;
  loading?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  /** Something above the rows inside the card (count, pagination…). */
  caption?: ReactNode;
  footer?: ReactNode;
};

/** Data table: header + rows on wide screens, stacked cards on small ones. Rows are pressable as a whole. */
export function DataTable<Row>({ columns, rows, keyOf, onRowPress, rowLabel, renderCard, loading, emptyTitle, emptyHint, caption, footer }: TableProps<Row>) {
  const wide = useIsWide();
  const body =
    loading && rows.length === 0 ? (
      <View style={{ padding: space(8), alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : rows.length === 0 ? (
      <View style={{ padding: space(8), alignItems: 'center', gap: space(1) }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{emptyTitle}</Text>
        {!!emptyHint && <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', maxWidth: 420 }}>{emptyHint}</Text>}
      </View>
    ) : wide ? (
      <>
        <View style={{ flexDirection: 'row', gap: space(4), paddingHorizontal: space(4), paddingVertical: space(2.5), borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}>
          {columns.map((c) => (
            <Text key={c.key} style={[{ color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }, c.width ? { width: c.width } : { flex: c.flex ?? 1 }, c.align === 'right' && { textAlign: 'right' }]} numberOfLines={1}>
              {c.title}
            </Text>
          ))}
        </View>
        {rows.map((row, i) => (
          <Pressable
            key={keyOf(row)}
            accessibilityRole={onRowPress ? 'button' : undefined}
            accessibilityLabel={rowLabel?.(row)}
            disabled={!onRowPress}
            onPress={() => onRowPress?.(row)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(4), paddingHorizontal: space(4), paddingVertical: space(3), borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.border, backgroundColor: pressed ? colors.primarySoft : 'transparent' })}
          >
            {columns.map((c) => (
              <View key={c.key} style={[c.width ? { width: c.width } : { flex: c.flex ?? 1 }, { minWidth: 0 }, c.align === 'right' && { alignItems: 'flex-end' }]}>
                {c.render(row)}
              </View>
            ))}
          </Pressable>
        ))}
      </>
    ) : (
      rows.map((row, i) => (
        <Pressable key={keyOf(row)} accessibilityRole={onRowPress ? 'button' : undefined} accessibilityLabel={rowLabel?.(row)} disabled={!onRowPress} onPress={() => onRowPress?.(row)} style={({ pressed }) => ({ padding: space(4), gap: space(2), borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 })}>
          {renderCard ? (
            renderCard(row)
          ) : (
            <>
              {columns[0]?.render(row)}
              {columns.slice(1).map((c) => (
                <View key={c.key} style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 12, width: 88 }}>{c.title}</Text>
                  <View style={{ flex: 1 }}>{c.render(row)}</View>
                </View>
              ))}
            </>
          )}
        </Pressable>
      ))
    );
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      {caption && <View style={{ paddingHorizontal: space(4), paddingVertical: space(2.5), borderBottomWidth: 1, borderBottomColor: colors.border }}>{caption}</View>}
      {body}
      {footer && <View style={{ paddingHorizontal: space(4), paddingVertical: space(2.5), borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View>}
    </View>
  );
}

/** Cell text helpers. */
export function CellText({ children, muted, bold, lines = 2 }: { children: ReactNode; muted?: boolean; bold?: boolean; lines?: number }) {
  return (
    <Text style={{ color: muted ? colors.muted : colors.text, fontSize: 14, lineHeight: 20, fontWeight: bold ? '600' : '400' }} numberOfLines={lines}>
      {children}
    </Text>
  );
}

export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.ws.pagination.range', { from, to, total })}</Text>
      <View style={{ flexDirection: 'row', gap: space(1) }}>
        <IconButton icon="chevronLeft" label={t('org.ws.pagination.previous')} onPress={() => onChange(Math.max(0, offset - limit))} disabled={offset === 0} />
        <IconButton icon="chevronRight" label={t('org.ws.pagination.next')} onPress={() => onChange(offset + limit)} disabled={to >= total} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ stats + keyboard

export function StatCard({ label, value, tone = 'neutral', onPress, hint }: { label: string; value: string | number; tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'warning'; onPress?: () => void; hint?: string }) {
  const color = tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.text;
  const style: ViewStyle = { flexGrow: 1, flexBasis: 150, minWidth: 140, padding: space(4), borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 4 };
  const inner = (
    <>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color, fontSize: 26, fontWeight: '700', lineHeight: 32 }}>{value}</Text>
      {!!hint && <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text>}
    </>
  );
  if (!onPress) return <View style={style}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: colors.primarySoft }]}>
      {inner}
    </Pressable>
  );
}

/**
 * Web only: single-key shortcuts while no text field has focus (and no modifier is held). Keys are compared
 * case-insensitively; handlers run with the latest closure.
 */
export function useKeyShortcuts(map: Record<string, (() => void) | undefined>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      const handler = ref.current[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Query params the review screen uses to know its queue (which list the item was opened from). */
export type QueueParams = { documentId?: string; q?: string; attention?: string; status?: string; sort?: string };
export const queueParams = (p: QueueParams): Record<string, string> => Object.fromEntries(Object.entries(p).filter(([, v]) => !!v)) as Record<string, string>;
