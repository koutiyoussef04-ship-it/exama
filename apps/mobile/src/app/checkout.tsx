import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { Body, Button, Card, colors, Screen, space, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { planSummary } from '@/lib/billing';
import { hasWebSubscription } from '@/lib/store';

/** Web subscriptions (Stripe): where Checkout sends the browser back to (?status=success | cancelled). */
export default function CheckoutReturn() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  if (status === 'success') return <Activating />;
  if (status === 'cancelled') return <Cancelled />;
  return <Redirect href="/" />;
}

const POLL_MS = 2000;
/** After this long without the subscription appearing, stop polling and offer a manual re-check. */
const GIVE_UP_MS = 90_000;

/**
 * Coming back from Checkout proves nothing: a plan is only active once Stripe's webhook has reached the
 * server. So this page never grants anything. It keeps reading the server's entitlement (GET /billing/status)
 * and shows the plan once the server reports the web subscription.
 */
function Activating() {
  const { t } = useTranslation();
  const [gaveUp, setGaveUp] = useState(false);
  const entitlement = useQuery({
    queryKey: ['entitlement'],
    queryFn: api.getEntitlement,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data && hasWebSubscription(q.state.data) ? false : gaveUp ? false : POLL_MS),
  });
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);

  const e = entitlement.data;
  const ready = !!e && hasWebSubscription(e);

  return (
    <Screen>
      <Stack.Screen options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      {ready ? (
        <>
          <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
            <Title style={{ textAlign: 'center' }}>{t('checkout.readyTitle')}</Title>
            <Body style={{ textAlign: 'center', fontWeight: '600' }}>{planSummary(e)}</Body>
            <Body muted style={{ textAlign: 'center' }}>{t('checkout.readyBody')}</Body>
          </Card>
          <Button title={t('checkout.continue')} onPress={() => router.replace('/')} />
        </>
      ) : gaveUp ? (
        <>
          <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
            <Title style={{ textAlign: 'center' }}>{t('checkout.slowTitle')}</Title>
            <Body muted style={{ textAlign: 'center' }}>{t('checkout.slowBody')}</Body>
          </Card>
          <Button
            title={t('checkout.checkAgain')}
            onPress={() => {
              setGaveUp(false);
              void entitlement.refetch();
            }}
          />
          <Button variant="secondary" title={t('checkout.toCourses')} onPress={() => router.replace('/')} />
        </>
      ) : (
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
          <ActivityIndicator color={colors.primary} />
          <Title style={{ textAlign: 'center' }}>{t('checkout.activatingTitle')}</Title>
          <Body muted style={{ textAlign: 'center' }}>{t('checkout.activatingBody')}</Body>
        </Card>
      )}
    </Screen>
  );
}

/** The customer left Checkout without subscribing: nothing changed. */
function Cancelled() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Stack.Screen options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
        <Title style={{ textAlign: 'center' }}>{t('checkout.cancelledTitle')}</Title>
        <Body muted style={{ textAlign: 'center' }}>{t('checkout.cancelledBody')}</Body>
      </Card>
      <View style={{ gap: space(3) }}>
        <Button title={t('checkout.backToPlans')} onPress={() => router.replace('/paywall')} />
        <Button variant="secondary" title={t('checkout.toCourses')} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
