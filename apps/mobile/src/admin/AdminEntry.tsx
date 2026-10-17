/**
 * "Administration" section in Account with the "Admin dashboard" row — shown only when the server
 * confirms the owner account (GET /admin/access answers 403 for everyone else; see ./access.ts).
 * Hiding it is cosmetic: every admin endpoint checks owner access itself.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card, ListRow, SectionLabel } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ADMIN_ROUTE, adminAccessQueryKey, showAdminEntry } from './access';

export function AdminEntry() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const access = useQuery({
    queryKey: adminAccessQueryKey(user?.id),
    queryFn: api.adminAccess,
    enabled: !!user,
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (!user || !showAdminEntry(access.data)) return null;
  return (
    <Card style={{ gap: 0 }}>
      <SectionLabel>{t('account.administration')}</SectionLabel>
      <ListRow label={t('account.adminDashboard')} onPress={() => router.push(ADMIN_ROUTE)} last />
    </Card>
  );
}
