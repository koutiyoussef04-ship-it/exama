/**
 * Account → Emails from Exama: the optional marketing-email consent (tips, news about new features, offers, invitations to come
 * back). A separate category from the daily study-plan email (Account → Study reminders): turning one on or off never changes the
 * other. The switch is off for everyone who has not said yes — accounts created before consent was asked included — and turning it
 * on is the explicit yes: the API records the version and language of the wording shown here, which is the same wording as the
 * sign-up checkbox. Turning it off withdraws the consent at once. Shown only when the server can send email.
 */
import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';
import { Card, colors, ErrorText, SectionLabel, space } from '@/components/ui';
import { useEmailPreferences } from '@/lib/use-email-preferences';

export function MarketingSettingsCard() {
  const { t } = useTranslation();
  const { query, setMarketing } = useEmailPreferences();
  const prefs = query.data;
  if (!prefs?.marketingAvailable) return null;
  return (
    <Card style={{ gap: space(3) }}>
      <SectionLabel>{t('marketing.accountTitle')}</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space(3) }}>
        <View style={{ flex: 1, gap: space(1) }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('marketing.accountLabel')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{t('marketing.statement')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>{t('marketing.hint')}</Text>
        </View>
        <Switch
          value={prefs.marketing}
          onValueChange={(on) => setMarketing.mutate(on)}
          disabled={setMarketing.isPending}
          accessibilityLabel={t('marketing.accountLabel')}
          accessibilityHint={t('marketing.statement')}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <ErrorText error={setMarketing.error} />
    </Card>
  );
}
