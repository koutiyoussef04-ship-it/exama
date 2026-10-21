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
import { B2B_ADMIN_ROUTE, showB2BAdminEntry } from '@/lib/b2b-admin';
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
  // The B2B owner (organization account) gets its own dashboard; never the student owner's.
  if (showB2BAdminEntry(user)) {
    return (
      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('account.administration')}</SectionLabel>
        <ListRow label={t('b2bAdmin.entry')} onPress={() => router.push(B2B_ADMIN_ROUTE)} last />
      </Card>
    );
  }
  if (!user || !showAdminEntry(access.data)) return null;
  return (
    <Card style={{ gap: 0 }}>
      <SectionLabel>{t('account.administration')}</SectionLabel>
      <ListRow label={t('account.adminDashboard')} onPress={() => router.push(ADMIN_ROUTE)} last />
    </Card>
  );
}
