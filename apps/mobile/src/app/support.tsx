import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Text } from 'react-native';
import { Body, Button, Card, colors, Screen, SectionLabel, space } from '@/components/ui';
import { appVersion } from '@/config/app-config';
import { copyText, SUPPORT_EMAIL, supportMailto } from '@/lib/support';

export default function Support() {
  const { t } = useTranslation();
  const [noEmailApp, setNoEmailApp] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const faq = [
    [t('support.q1'), t('support.a1')],
    [t('support.q2'), t('support.a2')],
    [t('support.q3'), t('support.a3')],
    [t('support.q4'), t('support.a4')],
    [t('support.q5'), t('support.a5')],
  ] as const;

  const writeToSupport = () => {
    setNoEmailApp(false);
    // Only the app version is prefilled — no account or device details.
    const url = supportMailto(`${t('support.emailSubject')} (v${appVersion})`);
    // Web: hand mailto: to the browser in this tab (a new window would stay blank). The address stays on screen either way.
    const web = (globalThis as { location?: { assign?: (u: string) => void } }).location;
    if (Platform.OS === 'web' && typeof web?.assign === 'function') return web.assign(url);
    Linking.openURL(url).catch(() => setNoEmailApp(true));
  };
  const copyAddress = async () => setCopy((await copyText(SUPPORT_EMAIL)) ? 'copied' : 'failed');

  return (
    <Screen>
      <Body>{t('support.intro')}</Body>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('support.emailLabel')}</SectionLabel>
        {/* Always visible and selectable, so it can be copied when no email app is available. */}
        <Text
          selectable
          testID="support-email"
          style={{ color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center', writingDirection: 'ltr' }}
        >
          {SUPPORT_EMAIL}
        </Text>
        <Button title={t('support.emailButton')} onPress={writeToSupport} />
        {Platform.OS === 'web' ? (
          <Button variant="secondary" title={copy === 'copied' ? t('support.copied') : t('support.copyButton')} onPress={copyAddress} />
        ) : (
          <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('support.copyHintNative')}</Body>
        )}
        {copy === 'failed' && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('support.copyFailed')}</Body>}
        {noEmailApp && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('support.noEmailApp')}</Body>}
      </Card>
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
