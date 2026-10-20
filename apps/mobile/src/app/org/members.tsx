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
import { CellText, DataTable, FilterSelect, OrgGate, SmallButton, useIsWide, WorkspaceShell, type Column, type OrgContext } from '@/components/org/workspace';
import { Chips } from '@/components/planner';
import { Badge, Body, Card, colors, EmptyState, ErrorState, ErrorText, Field, SectionLabel, space } from '@/components/ui';
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
  const wide = useIsWide();
  const key = ['org', org.id, 'members'];
  const admin = canAdmin(org.role);

  const members = useQuery({ queryKey: key, queryFn: () => api.orgMembers(org.id), retry: false });

  const [adding, setAdding] = useState(false);
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
  const roleOptions = ORGANIZATION_ROLES.map((r) => ({ value: r, label: roleLabel(r) }));
  const name = (m: OrganizationMember) => (m.userId === user?.id ? `${m.name} (${t('org.members.you')})` : m.name);

  const columns: Column<OrganizationMember>[] = [
    {
      key: 'member',
      title: t('org.ws.columns.member'),
      flex: 3,
      render: (m) => (
        <View style={{ gap: 2 }}>
          <CellText bold lines={1}>
            {name(m)}
          </CellText>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            {m.email}
          </Text>
        </View>
      ),
    },
    {
      key: 'role',
      title: t('org.ws.columns.role'),
      width: 190,
      render: (m) => (admin ? <FilterSelect label={t('org.ws.columns.role')} value={m.role} options={roleOptions} onChange={(next) => !busy && next !== m.role && changeRole.mutate({ userId: m.userId, role: next })} /> : <Badge label={roleLabel(m.role)} tone={m.role === 'admin' ? 'primary' : 'neutral'} />),
    },
    { key: 'joined', title: t('org.ws.columns.joined'), width: 110, render: (m) => <CellText muted lines={1}>{formatDate(m.joinedAt)}</CellText> },
    ...(admin ? [{ key: 'actions', title: '', width: 110, align: 'right' as const, render: (m: OrganizationMember) => <SmallButton title={t('org.members.remove')} variant="ghost" onPress={() => askRemove(m)} disabled={busy} /> }] : []),
  ];

  return (
    <WorkspaceShell {...ctx} active="members" title={t('org.ws.members.title')} subtitle={t('org.members.intro')} actions={admin ? <SmallButton title={t('org.members.add')} icon="plus" variant="primary" onPress={() => setAdding((v) => !v)} /> : undefined} onRefresh={() => members.refetch()} refreshing={members.isRefetching} maxWidth={1040}>
      {members.error && !members.data && (isForbidden(members.error) ? <EmptyState title={t('org.members.adminsOnly')} /> : <ErrorState error={members.error} onRetry={() => members.refetch()} />)}

      {adding && admin && (
        <Card style={{ gap: space(4), maxWidth: wide ? 640 : undefined }}>
          <View style={{ gap: space(1) }}>
            <SectionLabel>{t('org.members.add')}</SectionLabel>
            <Body muted style={{ fontSize: 13 }}>{t('org.members.addHint')}</Body>
          </View>
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
            <Chips options={roleOptions} value={role} onChange={setRole} />
            <Body muted style={{ fontSize: 13 }}>{t(`org.members.roleHints.${role}`)}</Body>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
            <SmallButton title={t('org.members.addButton')} variant="primary" onPress={() => add.mutate()} loading={add.isPending} disabled={!emailOk || busy} />
            <SmallButton title={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} disabled={busy} />
            {added && <Body style={{ color: colors.success, fontSize: 13 }}>{t('org.members.added')}</Body>}
          </View>
          <ErrorText error={add.error} />
        </Card>
      )}

      {members.data && (
        <DataTable
          columns={columns}
          rows={members.data}
          keyOf={(m) => m.userId}
          loading={members.isLoading}
          emptyTitle={t('org.members.count', { count: 0 })}
          caption={<Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.members.count', { count: members.data.length })}</Text>}
          renderCard={(m) => (
            <View style={{ gap: space(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <CellText bold lines={1}>
                    {name(m)}
                  </CellText>
                  <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                    {m.email} · {t('org.members.joined', { date: formatDate(m.joinedAt) })}
                  </Text>
                </View>
                {!admin && <Badge label={roleLabel(m.role)} tone={m.role === 'admin' ? 'primary' : 'neutral'} />}
              </View>
              {admin && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
                  <Chips options={roleOptions} value={m.role} onChange={(next) => !busy && next !== m.role && changeRole.mutate({ userId: m.userId, role: next })} />
                  <SmallButton title={t('org.members.remove')} variant="ghost" onPress={() => askRemove(m)} disabled={busy} />
                </View>
              )}
            </View>
          )}
        />
      )}
      <ErrorText error={changeRole.error ?? remove.error} />
    </WorkspaceShell>
  );
}
