import { Link, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native';
import type { AccountType } from '@study/shared';
import { Chips } from '@/components/planner';
import { Body, Button, colors, ErrorText, Field, Screen, space, Title } from '@/components/ui';
import { isReleaseBuild } from '@/config/app-config';
import { NATIVE_NAMES } from '@/i18n/languages';
import { API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePreferences } from '@/lib/preferences';
import { usePendingStart } from '@/lib/use-pending-start';

const logo = require('../../assets/images/logo-mark.png');

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn, sessionExpired } = useAuth();
  const { appLanguage } = usePreferences();
  const pending = usePendingStart();
  // Student and organization accounts are separate (one email can have both): the sign-in says which one.
  // Pre-selected by /start?mode=signin&account=organization (the website's "for organizations" pages).
  const params = useLocalSearchParams<{ account?: string }>();
  const [accountType, setAccountType] = useState<AccountType>(() => (params.account === 'organization' ? 'organization' : 'student'));
  const accountParams = accountType === 'organization' ? { account: 'organization' } : {};
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const canSubmit = !!email.trim() && !!password && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password, accountType });
    } catch (e) {
      // A sign-up that was never confirmed: there is no account yet, only the emailed link.
      if (e instanceof ApiError && e.code === 'signup_pending') return router.push({ pathname: '/verify-email', params: { email: email.trim(), pending: '1', ...accountParams } });
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen topInset>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => router.push('/language')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('nav.language')}
            style={{ paddingVertical: space(1), paddingHorizontal: space(2) }}
          >
            <Text style={{ color: colors.primary, fontWeight: '600' }}>🌐 {NATIVE_NAMES[appLanguage]}</Text>
          </Pressable>
        </View>
        <View style={{ marginTop: space(4), marginBottom: space(2), gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Image source={logo} style={{ width: 52, height: 52 }} accessibilityIgnoresInvertColors accessible={false} />
            <Text style={{ fontSize: 34, fontWeight: '800', color: colors.navy, letterSpacing: -0.5 }} accessibilityRole="header">
              {/* i18n-ignore: brand wordmark */}
              E<Text style={{ color: colors.primary }}>x</Text>ama
            </Text>
          </View>
          <Title style={{ fontSize: 26, lineHeight: 33 }}>{t('app.tagline')}</Title>
          <Body muted>{t('auth.subtitle')}</Body>
          {pending.intent && <Body style={{ fontWeight: '600' }}>{t('auth.continueToPlans')}</Body>}
        </View>
        {sessionExpired && !error && (
          <Body style={{ color: colors.warning, fontWeight: '600' }}>
            {t('errors.codes.session_expired')}
          </Body>
        )}
        <View style={{ gap: space(2) }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} accessibilityRole="header">
            {t('auth.signInAs.question')}
          </Text>
          <Chips
            options={[
              { value: 'student' as const, label: t('auth.signInAs.student') },
              { value: 'organization' as const, label: t('auth.signInAs.organization') },
            ]}
            value={accountType}
            onChange={setAccountType}
          />
          {accountType === 'organization' && <Body muted style={{ fontSize: 13 }}>{t('auth.signInAs.organizationHint')}</Body>}
        </View>
        <Field
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
        />
        <Field
          ref={passwordRef}
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Link
          href={{ pathname: '/forgot-password', params: { ...(email.trim() ? { email: email.trim() } : {}), ...accountParams } }}
          style={{ color: colors.primary, fontSize: 14, fontWeight: '600', alignSelf: 'flex-end', paddingVertical: space(1) }}
        >
          {t('auth.forgotPassword')}
        </Link>
        <ErrorText error={error} />
        <Button title={t('auth.signIn')} onPress={submit} loading={loading} disabled={!canSubmit} />
        <Link href={{ pathname: '/sign-up', params: accountParams }} style={{ color: colors.primary, textAlign: 'center', fontSize: 16, fontWeight: '600', padding: space(3) }}>
          {t('auth.noAccount')}
        </Link>
        {/* Development only: which API the app calls, to debug phone ↔ PC connectivity. */}
        {!isReleaseBuild && <Body muted style={{ textAlign: 'center', fontSize: 13 }}>{t('auth.devServer', { url: API_URL })}</Body>}
      </Screen>
    </KeyboardAvoidingView>
  );
}
