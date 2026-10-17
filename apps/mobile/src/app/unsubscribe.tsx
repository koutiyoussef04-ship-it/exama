/**
 * /unsubscribe#token=… — the link at the bottom of every daily study-plan email. Signed in or out.
 * Asks before turning the emails off (a mail scanner opening the link changes nothing); the token is
 * read from the fragment, which browsers never send to a server, and removed from the address bar.
 * Mail apps that support it also offer one-click unsubscribe, handled by the API directly.
 */
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Body, Button, Card, ErrorText, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { unsubscribeToken } from '@/lib/reminders-core';

function useToken(): string | null {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token] = useState(() => unsubscribeToken(Platform.OS === 'web' ? globalThis.location?.hash : null, params.token));
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = setTimeout(() => {
      if (globalThis.location?.hash) globalThis.history?.replaceState(globalThis.history.state, '', globalThis.location.pathname);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return token;
}

export default function Unsubscribe() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const token = useToken();
  const stop = useMutation({ mutationFn: () => api.unsubscribeStudyReminders(token!) });
  const home = () => router.replace(user ? '/' : '/sign-in');

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
    return (
      <Screen>
        <Card>
          <Title>{t('reminders.unsubscribeDoneTitle')}</Title>
          <Body muted>{t('reminders.unsubscribeDoneBody')}</Body>
        </Card>
        <Button variant="secondary" title={t('reminders.unsubscribeHome')} onPress={home} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <Title>{t('reminders.unsubscribeTitle')}</Title>
        <Body muted>{t('reminders.unsubscribeBody')}</Body>
      </Card>
      <ErrorText error={stop.error} />
      <Button title={t('reminders.unsubscribeConfirm')} onPress={() => stop.mutate()} loading={stop.isPending} />
      <Button variant="secondary" title={t('reminders.unsubscribeKeep')} onPress={home} />
    </Screen>
  );
}
