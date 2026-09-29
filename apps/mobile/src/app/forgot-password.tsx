/**
 * Forgot password: email → a 6-digit code by email → code + new password → signed in.
 * The first step always says the same thing, whether or not the email has an account.
 */
import { PASSWORD_RESET_CODE_LENGTH } from '@study/shared';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, TextInput } from 'react-native';
import { Body, Button, colors, ErrorText, Field, Screen, TextButton, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePreferences } from '@/lib/preferences';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const { resetPassword } = useAuth();
  const { appLanguage } = usePreferences();
  const params = useLocalSearchParams<{ email?: string }>();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // i18n-ignore: type annotation, not text
  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const sendCode = (again = false) =>
    run(async () => {
      await api.requestPasswordReset({ email: email.trim(), language: appLanguage });
      setStep('code');
      setResent(again);
    });
  const confirm = () =>
    run(async () => {
      // Signed in: the root navigator leaves the signed-out screens by itself.
      await resetPassword({ email: email.trim(), code: code.trim(), password });
    });

  const codeOk = new RegExp(`^\\d{${PASSWORD_RESET_CODE_LENGTH}}$`).test(code.trim());
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        {step === 'email' ? (
          <>
            <Title>{t('reset.title')}</Title>
            <Body muted>{t('reset.intro')}</Body>
            <Field
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => email.trim() && void sendCode()}
            />
            <ErrorText error={error} />
            <Button title={t('reset.sendCode')} onPress={() => void sendCode()} loading={loading} disabled={!email.trim() || loading} />
          </>
        ) : (
          <>
            <Title>{t('reset.codeTitle')}</Title>
            <Body muted>{t('reset.codeSent', { email: email.trim(), minutes: 30 })}</Body>
            {resent && <Body style={{ color: colors.success, fontWeight: '600' }}>{t('reset.resent')}</Body>}
            <Field
              label={t('reset.codeLabel')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, PASSWORD_RESET_CODE_LENGTH))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={PASSWORD_RESET_CODE_LENGTH}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label={t('reset.newPassword')}
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => codeOk && password.length >= 8 && void confirm()}
            />
            {password.length > 0 && password.length < 8 && <Body muted style={{ fontSize: 13 }}>{t('auth.moreChars', { count: 8 - password.length })}</Body>}
            <ErrorText error={error} />
            <Button title={t('reset.setPassword')} onPress={() => void confirm()} loading={loading} disabled={!codeOk || password.length < 8 || loading} />
            <TextButton title={t('reset.resend')} tone="muted" onPress={() => void sendCode(true)} disabled={loading} />
            <TextButton title={t('reset.changeEmail')} tone="muted" onPress={() => (setStep('email'), setCode(''), setError(null))} disabled={loading} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
