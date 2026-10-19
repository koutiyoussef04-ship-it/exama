/**
 * /unsubscribe#token=…[&category=marketing] — the link at the bottom of every email Exama sends that can be switched off. Signed in or out.
 * The category says what it stops: the daily study-plan email (no category — every link already sent), or marketing emails
 * (tips, news, offers, invitations to come back). The two are separate settings, so the marketing page stops marketing and offers,
 * as a second explicit choice, to stop the daily plan email too. Asks before changing anything (a mail scanner opening the link
 * changes nothing); the token is read from the fragment, which browsers never send to a server, and removed from the address bar.
 * Mail apps that support it also offer one-click unsubscribe, handled by the API directly.
 */
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import type { UnsubscribeCategory } from '@study/shared';
import { Body, Button, Card, ErrorText, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { unsubscribeCategory, unsubscribeToken } from '@/lib/reminders-core';

function useLink(): { token: string | null; category: 'marketing' | 'study_reminders' } {
  const params = useLocalSearchParams<{ token?: string; category?: string }>();
  const [link] = useState(() => {
    const hash = Platform.OS === 'web' ? globalThis.location?.hash : null;
    return { token: unsubscribeToken(hash, params.token), category: unsubscribeCategory(hash, params.category) };
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = setTimeout(() => {
      if (globalThis.location?.hash) globalThis.history?.replaceState(globalThis.history.state, '', globalThis.location.pathname);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return link;
}

export default function Unsubscribe() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { token, category } = useLink();
  const stop = useMutation({ mutationFn: (what: UnsubscribeCategory) => api.unsubscribeEmails(token!, what) });
  const home = () => router.replace(user ? '/' : '/sign-in');
  const marketing = category === 'marketing';

  if (!token) {
    return (
      <Screen>
        <Card>
          <Title>{t('reminders.unsubscribeInvalidTitle')}</Title>
          <Body muted>{t('reminders.unsubscribeInvalidBody')}</Body>
        </Card>
        <Button variant="secondary" title={t('reminders.unsubscribeHome')} onPress={home} />
      </Screen>
    );
  }
  if (stop.isSuccess) {
    const body = !marketing ? t('reminders.unsubscribeDoneBody') : stop.variables === 'all' ? t('marketing.unsubscribeDoneAllBody') : t('marketing.unsubscribeDoneBody');
    return (
      <Screen>
        <Card>
          <Title>{t(marketing ? 'marketing.unsubscribeDoneTitle' : 'reminders.unsubscribeDoneTitle')}</Title>
          <Body muted>{body}</Body>
        </Card>
        <Button variant="secondary" title={t('reminders.unsubscribeHome')} onPress={home} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <Title>{t(marketing ? 'marketing.unsubscribeTitle' : 'reminders.unsubscribeTitle')}</Title>
        <Body muted>{t(marketing ? 'marketing.unsubscribeBody' : 'reminders.unsubscribeBody')}</Body>
      </Card>
      <ErrorText error={stop.error} />
      <Button title={t(marketing ? 'marketing.unsubscribeConfirm' : 'reminders.unsubscribeConfirm')} onPress={() => stop.mutate(marketing ? 'marketing' : 'study_reminders')} loading={stop.isPending} />
      {marketing && <Button variant="secondary" title={t('marketing.unsubscribeAlso')} onPress={() => stop.mutate('all')} disabled={stop.isPending} />}
      <Button variant="secondary" title={t(marketing ? 'marketing.unsubscribeKeep' : 'reminders.unsubscribeKeep')} onPress={home} />
    </Screen>
  );
}
