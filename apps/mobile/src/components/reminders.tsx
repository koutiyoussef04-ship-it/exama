/**
 * Daily study reminder controls: the Account setting and the offer on the study plan screen.
 * Reminders are emails sent by the server each morning with that day's tasks (no notification
 * permission needed, same on web, iOS and Android). Shown only to accounts that would get them.
 */
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';
import { Body, Button, Card, colors, ErrorText, SectionLabel, space, TextButton } from '@/components/ui';
import { reminderState, showReminderOffer } from '@/lib/reminders-core';
import { useEmailPreferences } from '@/lib/use-email-preferences';

/** Account → Study reminders. */
export function ReminderSettingsCard() {
  const { t } = useTranslation();
  const { query, update } = useEmailPreferences();
  const state = reminderState(query.data);
  if (state === 'hidden') return null;
  return (
    <Card style={{ gap: space(3) }}>
      <SectionLabel>{t('reminders.title')}</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('reminders.daily')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('reminders.hint')}</Text>
        </View>
        <Switch
          value={state === 'on'}
          onValueChange={(on) => update.mutate(on)}
          disabled={update.isPending || state === 'verify'}
          accessibilityLabel={t('reminders.daily')}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {state === 'verify' && <VerifyHint />}
      <ErrorText error={update.error} />
    </Card>
  );
}

/** On the study plan: shown when daily emails are off, or need a confirmed address. */
export function ReminderOffer() {
  const { t } = useTranslation();
  const { query, update } = useEmailPreferences();
  const state = reminderState(query.data);
  if (!showReminderOffer(state)) return null;
  return (
    <Card style={{ gap: space(2.5) }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>{t('reminders.offerTitle')}</Text>
      {state === 'verify' ? (
        <VerifyHint />
      ) : (
        <>
          <Body muted style={{ fontSize: 14 }}>{t('reminders.offerBody')}</Body>
          <Button title={t('reminders.offerCta')} onPress={() => update.mutate(true)} loading={update.isPending} />
          <ErrorText error={update.error} />
        </>
      )}
    </Card>
  );
}

function VerifyHint() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1) }}>
      <Body muted style={{ fontSize: 14 }}>{t('reminders.verifyHint')}</Body>
      <TextButton title={t('reminders.verifyCta')} onPress={() => router.push('/verify-email')} />
    </View>
  );
}
