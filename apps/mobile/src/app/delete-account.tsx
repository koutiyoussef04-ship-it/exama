import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { DELETED_EMAIL_HOLD_DAYS } from '@study/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, KeyboardAvoidingView, View } from 'react-native';
import { useDateLocale } from '@/components/planner';
import { Body, Button, Card, CheckRow, colors, ErrorText, Field, Screen, space, TextButton, Title } from '@/components/ui';
import { api, setAuthToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openManageSubscriptions, useEntitlement } from '@/lib/billing';
import { hasWebSubscription, isStoreProvider, storeName } from '@/lib/store';
import { confirm } from '@/lib/confirm';

/**
 * Account → Delete account. Three guards against accidents: an explicit "I understand" checkbox,
 * the account password (verified by the server), and a final destructive confirmation dialog.
 * Before deleting, it says the email can't sign up again for 30 days (services/email-hold.ts on the API);
 * afterwards, the exact date and time it can (shown only to the person who deleted the account).
 */
/** "16 November 2026, 14:32" in the app language and the device's time zone. */
const formatMoment = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export default function DeleteAccount() {
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const qc = useQueryClient();
  const entitlement = useEntitlement();
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [done, setDone] = useState<{ emailReusableAt: string } | null>(null);
  const locale = useDateLocale();

  const e = entitlement.data;
  // A store subscription keeps billing the Apple ID / Google account even after the Exama account is gone.
  const storeSubscription = !!e && isStoreProvider(e.provider) && e.willRenew && (e.status === 'active' || e.status === 'trialing');
  // A web (Stripe) subscription, by contrast, is cancelled by Exama itself when the account is deleted.
  const webSubscription = !!e && hasWebSubscription(e);

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: async (result) => {
      // The session is now invalid: stop all requests before showing the confirmation.
      await qc.cancelQueries();
      setAuthToken(null);
      setDone({ emailReusableAt: result.emailReusableAt });
    },
  });

  // Android back button on the confirmation: the session no longer exists, so leave by signing out.
  useEffect(() => {
    if (!done) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void signOut();
      return true;
    });
    return () => sub.remove();
  }, [done, signOut]);

  const submit = async () => {
    const ok = await confirm({
      title: t('deleteAccount.confirmTitle'),
      message: t('deleteAccount.confirmMessage'),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (ok) remove.mutate();
  };

  if (done) {
    return (
      <Screen>
        <Stack.Screen options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
          <Title style={{ textAlign: 'center' }}>{t('deleteAccount.successTitle')}</Title>
          <Body muted style={{ textAlign: 'center' }}>{t('deleteAccount.successBody')}</Body>
          {done.emailReusableAt ? (
            <Body muted style={{ textAlign: 'center' }}>{t('deleteAccount.successEmailHold', { date: formatMoment(done.emailReusableAt, locale) })}</Body>
          ) : null}
        </Card>
        <Button title={t('common.done')} onPress={() => void signOut()} />
      </Screen>
    );
  }

  const items = [t('deleteAccount.itemCourses'), t('deleteAccount.itemExams'), t('deleteAccount.itemPlan'), t('deleteAccount.itemLogin')];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <Title>{t('deleteAccount.title')}</Title>
        <Card style={{ gap: space(2), borderColor: colors.danger }}>
          <Body>{t('deleteAccount.intro')}</Body>
          {items.map((item) => (
            <Body key={item}>• {item}</Body>
          ))}
          <Body style={{ fontWeight: '700', color: colors.danger }}>{t('deleteAccount.irreversible')}</Body>
        </Card>

        <Card style={{ gap: space(2), backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }}>
          <Body style={{ color: colors.text }}>
            {t('deleteAccount.emailHold', { days: DELETED_EMAIL_HOLD_DAYS, email: user?.email ?? '' })}
          </Body>
        </Card>

        {storeSubscription && (
          <Card style={{ gap: space(2), backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }}>
            <Body style={{ color: colors.text }}>{t('deleteAccount.subscriptionWarning', { store: storeName(e.provider) })}</Body>
            <TextButton title={t('account.manageSubscription')} onPress={() => openManageSubscriptions(e.provider, e.planId)} />
          </Card>
        )}

        {webSubscription && (
          <Card style={{ gap: space(2) }}>
            <Body>{t('deleteAccount.webSubscriptionNote')}</Body>
          </Card>
        )}

        <View style={{ gap: space(3) }}>
          <Field
            label={t('deleteAccount.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
          />
          <CheckRow label={t('deleteAccount.understand')} checked={understood} onChange={setUnderstood} />
        </View>
        <ErrorText error={remove.error} />
        <Button
          variant="danger"
          title={remove.isPending ? t('deleteAccount.deleting') : t('deleteAccount.submit')}
          onPress={submit}
          loading={remove.isPending}
          disabled={!understood || !password}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
