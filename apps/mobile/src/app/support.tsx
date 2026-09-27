import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { Body, Button, Card, Screen, SectionLabel, space } from '@/components/ui';
import { appVersion, legalConfig } from '@/config/app-config';

export default function Support() {
  const { t } = useTranslation();
  const email = legalConfig.supportEmail;
  const faq = [
    [t('support.q1'), t('support.a1')],
    [t('support.q2'), t('support.a2')],
    [t('support.q3'), t('support.a3')],
    [t('support.q4'), t('support.a4')],
    [t('support.q5'), t('support.a5')],
  ] as const;

  const writeToSupport = () => {
    if (!email) return;
    // Only the app version is prefilled — no account or device details.
    const subject = encodeURIComponent(`${t('support.emailSubject')} (v${appVersion})`);
    void Linking.openURL(`mailto:${email}?subject=${subject}`);
  };

  return (
    <Screen>
      <Body>{t('support.intro')}</Body>
      {email ? <Button title={t('support.emailButton')} onPress={writeToSupport} /> : <Body muted>{t('support.emailMissing')}</Body>}
      {!!email && <Body muted style={{ textAlign: 'center', fontSize: 14 }}>{email}</Body>}
      <SectionLabel>{t('support.faqTitle')}</SectionLabel>
      {faq.map(([q, a]) => (
        <Card key={q} style={{ gap: space(1.5) }}>
          <Body style={{ fontWeight: '700' }}>{q}</Body>
          <Body muted>{a}</Body>
        </Card>
      ))}
    </Screen>
  );
}
