/**
 * /switch-account?account=student|organization — a person signed in to one identity wants the other one (the same
 * email can have a student account and an organization account, with their own passwords). The only path between
 * the two is: sign out of this one, then sign in to the other with its password. Nothing is merged, no session is
 * carried over, and the choice is explicit: the current session stays until the person confirms.
 *
 * Reached from /start links that name the other account type (website "Log in as…" while signed in) and from the
 * Account screen. Signed out, it simply opens the sign-in on the requested type.
 */
import type { AccountType } from '@study/shared';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, Button, Card, Screen, space, TextButton, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SwitchAccount() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const params = useLocalSearchParams<{ account?: string }>();
  const target: AccountType = params.account === 'organization' ? 'organization' : 'student';
  const [leaving, setLeaving] = useState(false);

  // Signed out (or the session ended while here): the sign-in form on the requested type.
  if (!user) return <Redirect href={{ pathname: '/sign-in', params: target === 'organization' ? { account: 'organization' } : { account: 'student' } }} />;
  // Already the requested identity: nothing to switch.
  if (user.accountType === target) return <Redirect href="/" />;

  const stay = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const proceed = async () => {
    setLeaving(true);
    await signOut();
    router.replace({ pathname: '/sign-in', params: { account: target } });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('switchAccount.title') }} />
      <View style={{ gap: space(1) }}>
        <Title>{t(`switchAccount.heading.${target}`)}</Title>
        <Body muted>{t(`switchAccount.current.${user.accountType}`, { email: user.email })}</Body>
      </View>
      <Card style={{ gap: space(3) }}>
        <Body>{t(`switchAccount.explain.${target}`)}</Body>
        <Body muted style={{ fontSize: 14 }}>{t('switchAccount.separate')}</Body>
        <Button title={t(`switchAccount.proceed.${target}`)} onPress={() => void proceed()} loading={leaving} />
        <TextButton title={t(`switchAccount.stay.${user.accountType}`)} onPress={stay} disabled={leaving} />
      </Card>
    </Screen>
  );
}
