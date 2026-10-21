/**
 * Create an organization (organization accounts only — the server refuses everyone else). The creator
 * becomes its first admin; colleagues are added from the Members screen.
 */
import { ORGANIZATION_CATEGORIES, type OrganizationCategory } from '@study/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chips } from '@/components/planner';
import { Body, Button, Card, EmptyState, ErrorText, Field, Screen, SectionLabel, space, TextButton, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { kv } from '@/lib/storage';
import { ORG_CURRENT_KEY, ORG_LIST_KEY } from '@/lib/org';

export default function NewOrganization() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [market, setMarket] = useState<OrganizationCategory | null>(null);

  const create = useMutation({
    mutationFn: () => api.createOrganization({ name: name.trim(), market: market! }),
    onSuccess: async (org) => {
      await kv.set(ORG_CURRENT_KEY, org.id);
      await qc.invalidateQueries({ queryKey: ORG_LIST_KEY });
      router.replace({ pathname: '/org', params: { orgId: org.id } });
    },
  });

  if (user?.accountType !== 'organization') {
    return (
      <Screen>
        <EmptyState title={t('org.new.notAllowedTitle')}>
          <Body muted style={{ textAlign: 'center' }}>{t('org.new.notAllowed')}</Body>
          <TextButton title={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/org'))} />
        </EmptyState>
      </Screen>
    );
  }

  const valid = name.trim().length >= 2 && !!market;
  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <Title>{t('org.new.title')}</Title>
        <Body muted>{t('org.new.intro')}</Body>
      </View>
      <Card style={{ gap: space(4) }}>
        <Field label={t('auth.organizationName')} value={name} onChangeText={setName} placeholder={t('auth.organizationNamePlaceholder')} autoFocus maxLength={120} />
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('auth.marketQuestion')}</SectionLabel>
          <Chips options={ORGANIZATION_CATEGORIES.map((m) => ({ value: m, label: t(`auth.market.${m}`) }))} value={market as OrganizationCategory} onChange={setMarket} />
          <Body muted style={{ fontSize: 13 }}>{t('auth.marketHint')}</Body>
        </View>
        <Button title={t('org.new.create')} onPress={() => create.mutate()} loading={create.isPending} disabled={!valid} />
        <ErrorText error={create.error} />
      </Card>
    </Screen>
  );
}
