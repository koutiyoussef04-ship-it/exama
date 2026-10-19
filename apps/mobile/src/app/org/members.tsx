/**
 * Members of the organization and their roles (admins only — the server answers 403 to everyone else).
 * Members are added by the email of an existing Exama account; an organization always keeps at least
 * one admin (the server refuses to demote or remove the last one).
 */
import { ORGANIZATION_ROLES, type OrganizationMember, type OrganizationRole } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Chips } from '@/components/planner';
import { Badge, Body, Button, Card, colors, EmptyState, ErrorState, ErrorText, Field, Loading, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { canAdmin, isForbidden, roleLabel } from '@/lib/org';

export default function OrgMembersScreen() {
  return <OrgGate>{(ctx) => <Members {...ctx} />}</OrgGate>;
}

function Members(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['org', org.id, 'members'];
  const admin = canAdmin(org.role);

  const members = useQuery({ queryKey: key, queryFn: () => api.orgMembers(org.id), retry: false });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('reviewer');
  const [added, setAdded] = useState(false);

  const applyList = (list: OrganizationMember[]) => {
    qc.setQueryData(key, list);
    void qc.invalidateQueries({ queryKey: ['org', org.id, 'overview'] });
    void qc.invalidateQueries({ queryKey: ['org', 'list'] });
  };
  const add = useMutation({
    mutationFn: () => api.orgAddMember(org.id, { email: email.trim(), role }),
    onSuccess: (list) => {
      applyList(list);
      setEmail('');
      setAdded(true);
    },
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role: next }: { userId: string; role: OrganizationRole }) => api.orgUpdateMember(org.id, userId, { role: next }),
    onSuccess: applyList,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api.orgRemoveMember(org.id, userId), onSuccess: applyList });

  const askRemove = async (m: OrganizationMember) => {
    if (await confirm({ title: t('org.members.removeTitle', { name: m.name }), message: t('org.members.removeMessage'), confirmText: t('org.members.remove'), destructive: true })) remove.mutate(m.userId);
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const busy = add.isPending || changeRole.isPending || remove.isPending;

  return (
    <Screen onRefresh={() => members.refetch()} refreshing={members.isRefetching}>
      <OrgNav {...ctx} active="members" />
      <Body muted style={{ fontSize: 14 }}>{t('org.members.intro')}</Body>

      {members.isLoading && <Loading />}
      {members.error && !members.data && (isForbidden(members.error) ? <EmptyState title={t('org.members.adminsOnly')} /> : <ErrorState error={members.error} onRetry={() => members.refetch()} />)}

      {members.data && admin && (
        <Card style={{ gap: space(4) }}>
          <SectionLabel>{t('org.members.add')}</SectionLabel>
          <Body muted style={{ fontSize: 13 }}>{t('org.members.addHint')}</Body>
          <Field
            label={t('org.members.email')}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setAdded(false);
            }}
            placeholder={t('org.members.emailPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
          />
          <View style={{ gap: space(2) }}>
            <SectionLabel>{t('org.members.role')}</SectionLabel>
            <Chips options={ORGANIZATION_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={role} onChange={setRole} />
            <Body muted style={{ fontSize: 13 }}>{t(`org.members.roleHints.${role}`)}</Body>
          </View>
          <Button title={t('org.members.addButton')} onPress={() => add.mutate()} loading={add.isPending} disabled={!emailOk || busy} />
          {added && <Body style={{ color: colors.success, fontSize: 14, textAlign: 'center' }}>{t('org.members.added')}</Body>}
          <ErrorText error={add.error} />
        </Card>
      )}

      {members.data && (
        <Card style={{ gap: 0 }}>
          <SectionLabel>{t('org.members.count', { count: members.data.length })}</SectionLabel>
          {members.data.map((m, i) => {
            const me = m.userId === user?.id;
            return (
              <View key={m.userId} style={{ gap: space(2), paddingVertical: space(3), borderBottomWidth: i === members.data.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }} numberOfLines={1}>
                      {me ? `${m.name} (${t('org.members.you')})` : m.name}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                      {m.email} · {t('org.members.joined', { date: formatDate(m.joinedAt) })}
                    </Text>
                  </View>
                  <Badge label={roleLabel(m.role)} tone={m.role === 'admin' ? 'primary' : 'neutral'} />
                </View>
                {admin && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
                    <Chips options={ORGANIZATION_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={m.role} onChange={(next) => !busy && next !== m.role && changeRole.mutate({ userId: m.userId, role: next })} />
                    <TextButton title={t('org.members.remove')} tone="danger" onPress={() => askRemove(m)} disabled={busy} />
                  </View>
                )}
              </View>
            );
          })}
          <ErrorText error={changeRole.error ?? remove.error} />
        </Card>
      )}
    </Screen>
  );
}
