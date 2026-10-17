import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Text, TextInput, View } from 'react-native';
import { SIGNUP_AGE_ANSWERS, type SignupAgeAnswer } from '@study/shared';
import { Chips } from '@/components/planner';
import { Body, Button, Card, colors, ErrorText, Field, Loading, Screen, space, Title } from '@/components/ui';
import { AGE_BLOCK_KEY, ageBlockActive, ageBlockValue, isBelowMinimumAge, MINIMUM_SIGNUP_AGE } from '@/lib/age-gate';
import { ApiError } from '@/lib/api';
import { kv } from '@/lib/storage';
import { useAuth } from '@/lib/auth';
import { usePreferences } from '@/lib/preferences';
import { usePendingStart } from '@/lib/use-pending-start';

export default function SignUp() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const { appLanguage } = usePreferences();
  const pending = usePendingStart();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ageRange, setAgeRange] = useState<SignupAgeAnswer | null>(null);
  // Sign-up declined for age on this device in the last 24 h: don't offer the form again.
  const [blocked, setBlocked] = useState<boolean | null>(null);
  useEffect(() => {
    void kv.get(AGE_BLOCK_KEY).then((v) => setBlocked(ageBlockActive(v)));
  }, []);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const canSubmit = !!name.trim() && !!email.trim() && password.length >= 8 && !!ageRange && !loading;

  /** Under the minimum age: nothing is sent or kept — the typed details are cleared too. */
  const decline = () => {
    setName('');
    setEmail('');
    setPassword('');
    setAgeRange(null);
    setBlocked(true);
    void kv.set(AGE_BLOCK_KEY, ageBlockValue());
  };

  const submit = async () => {
    if (!canSubmit || !ageRange) return;
    if (isBelowMinimumAge(ageRange)) return decline();
    setLoading(true);
    setError(null);
    try {
      // The app language is used for the verification email.
      await signUp({ name: name.trim(), email: email.trim(), password, language: appLanguage, ageRange });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'age_requirement_not_met') decline();
      else setError(e);
    } finally {
      setLoading(false);
    }
  };

  if (blocked === null) return <Loading />;
  if (blocked) {
    return (
      <Screen>
        <Card style={{ gap: space(3) }}>
          <Title>{t('auth.ageBlockedTitle', { age: MINIMUM_SIGNUP_AGE })}</Title>
          <Body>{t('auth.ageBlockedBody', { age: MINIMUM_SIGNUP_AGE })}</Body>
        </Card>
        <Button variant="secondary" title={t('auth.ageBlockedBack')} onPress={() => router.replace('/sign-in')} />
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }} style={{ alignSelf: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>{t('nav.privacy')}</Text>
        </Link>
      </Screen>
    );
  }

  const link = { color: colors.primary, fontWeight: '600' as const, fontSize: 14 };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <Body muted>{t('auth.signUpIntro')}</Body>
        {pending.intent && <Body style={{ fontWeight: '600' }}>{t('auth.continueToPlans')}</Body>}
        <Field
          label={t('auth.firstName')}
          value={name}
          onChangeText={setName}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          submitBehavior="submit"
        />
        <Field
          ref={emailRef}
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
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {password.length > 0 && password.length < 8 && (
          <Body muted style={{ fontSize: 14 }}>
            {t('auth.moreChars', { count: 8 - password.length })}
          </Body>
        )}
        <View style={{ gap: space(2) }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} accessibilityRole="header">
            {t('auth.ageQuestion')}
          </Text>
          <Chips options={SIGNUP_AGE_ANSWERS.map((value) => ({ value, label: t(`auth.age.${value}`) }))} value={ageRange as SignupAgeAnswer} onChange={setAgeRange} />
          <Body muted style={{ fontSize: 13 }}>{t('auth.ageHint')}</Body>
        </View>
        <ErrorText error={error} />
        <Button title={t('auth.createAccount')} onPress={submit} loading={loading} disabled={!canSubmit} />
        <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
          {t('auth.agreement')}
        </Body>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space(4) }}>
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }}>
            <Text style={link}>{t('nav.terms')}</Text>
          </Link>
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }}>
            <Text style={link}>{t('nav.privacy')}</Text>
          </Link>
        </View>
        {/* Came from the website with an account already: sign in instead (the destination is kept). */}
        <Link href="/sign-in" replace style={{ color: colors.primary, textAlign: 'center', fontSize: 16, fontWeight: '600', padding: space(3) }}>
          {t('auth.haveAccount')}
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
