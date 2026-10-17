/**
 * "Admin dashboard" row in Account — shown only when the server confirms an owner account
 * (GET /admin/access answers 403 for everyone else). Hiding it is cosmetic: every admin endpoint
 * checks owner access itself.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card, ListRow } from '@/components/ui';
import { api } from '@/lib/api';

export function AdminEntry() {
  const { t } = useTranslation();
  const access = useQuery({ queryKey: ['admin-access'], queryFn: api.adminAccess, retry: false, staleTime: 5 * 60_000 });
  if (!access.data?.owner) return null;
  return (
    <Card style={{ gap: 0 }}>
      <ListRow label={t('account.adminDashboard')} onPress={() => router.push('/admin')} last />
    </Card>
  );
}
