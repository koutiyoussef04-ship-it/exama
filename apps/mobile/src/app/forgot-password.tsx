/**
 * Forgot password: email → a 6-digit code by email → code + new password → signed in.
 * The first step always says the same thing, whether or not the email has an account.
 * A new code can be requested every 15 minutes: the API enforces that (and says how long is left,
 * the same for every email); this screen only disables "Send a new code" and shows the countdown.
 */
import { PASSWORD_RESET_CODE_LENGTH } from '@study/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
  // When "Send a new code" unlocks again (ms since epoch), as told by the API.
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
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

  // Tick once a second while the countdown runs.
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [retryAt]);
  const waitMs = Math.max(0, retryAt - now);
  const waitMinutes = Math.ceil(waitMs / 60_000);

  const sendCode = (again = false) =>
    run(async () => {
      const res = await api.requestPasswordReset({ email: email.trim(), language: appLanguage });
      const sent = Date.now();
      setNow(sent);
      setRetryAt(sent + (res.retryAfterSeconds ?? 0) * 1000);
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
            {waitMs > 0 && (
              <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
                {waitMs < 60_000 ? t('reset.resendWaitSoon') : t('reset.resendWait', { count: waitMinutes })}
              </Body>
            )}
            <TextButton title={t('reset.resend')} tone="muted" onPress={() => void sendCode(true)} disabled={loading || waitMs > 0} />
            <TextButton title={t('reset.changeEmail')} tone="muted" onPress={() => (setStep('email'), setCode(''), setError(null))} disabled={loading} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
