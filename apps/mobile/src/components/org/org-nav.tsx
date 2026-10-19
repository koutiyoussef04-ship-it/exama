/**
 * Top of every organization screen: the organization's name (and a switcher when the user belongs to
 * several), an Account link and the section row (Dashboard · Courses · Review · Bank · Export · Members).
 */
import type { OrganizationMembershipSummary } from '@study/shared';
import { Redirect, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Badge, Card, Chevron, colors, Loading, space } from '@/components/ui';
import { canAdmin, roleLabel, useCurrentOrg } from '@/lib/org';

export type OrgSection = 'dashboard' | 'courses' | 'review' | 'bank' | 'export' | 'members';

const SECTIONS: { value: OrgSection; path: '/org' | '/org/courses' | '/org/review' | '/org/bank' | '/org/export' | '/org/members' }[] = [
  { value: 'dashboard', path: '/org' },
  { value: 'courses', path: '/org/courses' },
  { value: 'review', path: '/org/review' },
  { value: 'bank', path: '/org/bank' },
  { value: 'export', path: '/org/export' },
  { value: 'members', path: '/org/members' },
];

type Props = OrgContext & { active: OrgSection };

export function OrgNav({ org, orgs, active, switchOrg }: Props) {
  const { t } = useTranslation();
  const [switching, setSwitching] = useState(false);
  const others = orgs.filter((o) => o.id !== org.id);
  const sections = SECTIONS.filter((s) => s.value !== 'members' || canAdmin(org.role));

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={others.length ? t('org.nav.switchOrg') : org.name}
          disabled={!others.length}
          onPress={() => setSwitching((v) => !v)}
          hitSlop={8}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space(2), opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }} numberOfLines={1} accessibilityRole="header">
              {org.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <Badge label={roleLabel(org.role)} tone="primary" />
              {others.length > 0 && <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{t('org.nav.switchOrg')}</Text>}
            </View>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>{t('org.nav.account')}</Text>
        </Pressable>
      </View>

      {switching && others.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: space(1) }}>
          {others.map((o, i) => (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityLabel={t('org.nav.switchTo', { name: o.name })}
              onPress={() => {
                setSwitching(false);
                switchOrg(o.id);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                minHeight: 48,
                borderBottomWidth: i === others.length - 1 ? 0 : 1,
                borderBottomColor: colors.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }} numberOfLines={1}>
                {o.name}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{roleLabel(o.role)}</Text>
              <Chevron />
            </Pressable>
          ))}
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }} accessibilityRole="tablist">
        {sections.map((s) => {
          const selected = s.value === active;
          return (
            <Pressable
              key={s.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => !selected && router.push({ pathname: s.path, params: { orgId: org.id } })}
              style={({ pressed }) => ({
                paddingHorizontal: space(3.5),
                paddingVertical: space(2),
                borderRadius: 999,
                backgroundColor: selected ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: selected ? colors.primaryText : colors.text, fontWeight: '600', fontSize: 14 }}>{t(`org.nav.${s.value}`)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type OrgContext = { org: OrganizationMembershipSummary; orgs: OrganizationMembershipSummary[]; switchOrg: (id: string) => void };

/**
 * Resolves the current organization before a screen renders (so its hooks can rely on `org.id`).
 * Without any membership the dashboard explains what to do, so other screens send the user there.
 */
export function OrgGate({ children }: { children: (ctx: OrgContext) => ReactNode }) {
  const { org, orgs, setCurrent, ready } = useCurrentOrg();
  if (!ready) return <Loading />;
  if (!org) return <Redirect href="/org" />;
  return <>{children({ org, orgs, switchOrg: setCurrent })}</>;
}
