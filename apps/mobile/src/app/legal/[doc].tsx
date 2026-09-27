import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { Body, Card, colors, Screen, space, TextButton, Title } from '@/components/ui';
import { legalConfig } from '@/config/app-config';
import { fillLegal, LEGAL, LEGAL_IS_DRAFT, LEGAL_MISSING, LEGAL_UPDATED } from '@/i18n/legal';
import { formatDate } from '@/lib/billing';
import { usePreferences } from '@/lib/preferences';

export default function LegalScreen() {
  const { t } = useTranslation();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { appLanguage } = usePreferences();
  const which = doc === 'terms' ? 'terms' : 'privacy';
  const content = LEGAL[appLanguage][which];
  const missing = LEGAL_MISSING[appLanguage];
  const values = {
    company: legalConfig.company ?? missing.company,
    email: legalConfig.supportEmail ?? missing.email,
    address: legalConfig.address ?? missing.address,
  };
  const onlineUrl = which === 'terms' ? legalConfig.termsUrl : legalConfig.privacyUrl;

  return (
    <Screen>
      <Stack.Screen options={{ title: content.title }} />
      {LEGAL_IS_DRAFT && (
        <View style={{ backgroundColor: colors.warningSoft, borderRadius: 10, padding: space(3) }}>
          <Body style={{ color: colors.warning, fontWeight: '700', fontSize: 14 }}>{t('legal.draftBanner')}</Body>
        </View>
      )}
      <Title>{content.title}</Title>
      <Body muted style={{ fontSize: 14 }}>{t('legal.lastUpdated', { date: formatDate(`${LEGAL_UPDATED}T12:00:00Z`) })}</Body>
      {content.sections.map((s) => (
        <Card key={s.heading} style={{ gap: space(2) }}>
          <Body style={{ fontWeight: '700' }} >{s.heading}</Body>
          <Body>{fillLegal(s.body, values)}</Body>
        </Card>
      ))}
      {!!onlineUrl && <TextButton title={t('legal.openOnline')} onPress={() => void Linking.openURL(onlineUrl)} />}
    </Screen>
  );
}
