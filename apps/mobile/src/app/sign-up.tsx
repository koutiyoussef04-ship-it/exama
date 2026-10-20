import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native';
import { ORGANIZATION_MARKETS, SIGNUP_AGE_ANSWERS, type AccountType, type OrganizationMarket, type SignupAgeAnswer } from '@study/shared';
import { AccountTypeChoice } from '@/components/account-type-choice';
import { Chips } from '@/components/planner';
import { Body, Button, Card, CheckRow, colors, ErrorText, Field, Loading, Screen, space, Title } from '@/components/ui';
import { AGE_BLOCK_KEY, ageBlockActive, ageBlockValue, isBelowMinimumAge, MINIMUM_SIGNUP_AGE } from '@/lib/age-gate';
import { ApiError } from '@/lib/api';
import { canSubmitSignup, MIN_PASSWORD_LENGTH, passwordsMatch, showPasswordMismatch, signupRequest } from '@/lib/signup-form';
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
  // Only compared with the password on the device: never sent or stored.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [ageRange, setAgeRange] = useState<SignupAgeAnswer | null>(null);
  // Optional marketing-email consent: unticked by default, never required, separate from the terms below the button.
  const [marketing, setMarketing] = useState(false);
  // First step: "How will you use Exama?" — student (the study app) or organization (the workspace).
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [market, setMarket] = useState<OrganizationMarket | null>(null);
  // Sign-up declined for age on this device in the last 24 h: don't offer the form again.
  const [blocked, setBlocked] = useState<boolean | null>(null);
  useEffect(() => {
    void kv.get(AGE_BLOCK_KEY).then((v) => setBlocked(ageBlockActive(v)));
  }, []);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const form = { name, email, password, confirmPassword, ageRange, accountType, organizationName, market };
  const canSubmit = canSubmitSignup(form) && !loading;
  const showMismatch = mismatch || showPasswordMismatch(form);

  /** Under the minimum age: nothing is sent or kept — the typed details are cleared too. */
  const decline = () => {
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setAgeRange(null);
    setMarketing(false);
    setOrganizationName('');
    setMarket(null);
    setBlocked(true);
    void kv.set(AGE_BLOCK_KEY, ageBlockValue());
  };

  const submit = async () => {
    // The two passwords must match before anything is sent.
    if (!passwordsMatch(form)) return setMismatch(true);
    if (!canSubmit || !ageRange) return;
    if (isBelowMinimumAge(ageRange)) return decline();
    setLoading(true);
    setError(null);
    try {
      // The app language is used for the verification email, and is the language of the consent wording the person saw.
      await signUp(signupRequest({ ...form, ageRange }, { language: appLanguage, marketing }));
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
  if (!accountType) {
    return (
      <Screen>
        <AccountTypeChoice onChoose={setAccountType} />
        <Link href="/sign-in" replace style={{ color: colors.primary, textAlign: 'center', fontSize: 16, fontWeight: '600', padding: space(3) }}>
          {t('auth.haveAccount')}
        </Link>
      </Screen>
    );
  }
  const isOrganization = accountType === 'organization';
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
          <Body style={{ fontWeight: '600', flex: 1 }}>{isOrganization ? t('auth.accountType.organizationChosen') : t('auth.accountType.studentChosen')}</Body>
          <Pressable onPress={() => setAccountType(null)} hitSlop={12} accessibilityRole="button">
            <Text style={link}>{t('auth.accountType.change')}</Text>
          </Pressable>
        </View>
        <Body muted>{isOrganization ? t('auth.signUpIntroOrganization') : t('auth.signUpIntro')}</Body>
        {pending.intent && !isOrganization && <Body style={{ fontWeight: '600' }}>{t('auth.continueToPlans')}</Body>}
        {isOrganization && (
          <View style={{ gap: space(3) }}>
            <Field label={t('auth.organizationName')} placeholder={t('auth.organizationNamePlaceholder')} value={organizationName} onChangeText={setOrganizationName} autoCapitalize="words" returnKeyType="next" />
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} accessibilityRole="header">
              {t('auth.marketQuestion')}
            </Text>
            <Chips options={ORGANIZATION_MARKETS.map((value) => ({ value, label: t(`auth.market.${value}`) }))} value={market as OrganizationMarket} onChange={setMarket} />
            <Body muted style={{ fontSize: 13 }}>{t('auth.marketHint')}</Body>
          </View>
        )}
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
          onChangeText={(v) => {
            setPassword(v);
            setMismatch(false);
          }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          submitBehavior="submit"
        />
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
          <Body muted style={{ fontSize: 14 }}>
            {t('auth.moreChars', { count: MIN_PASSWORD_LENGTH - password.length })}
          </Body>
        )}
        <Field
          ref={confirmRef}
          label={t('auth.confirmPassword')}
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            setMismatch(false);
          }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {showMismatch && (
          <Text style={{ color: colors.danger, fontSize: 14 }} accessibilityRole="alert">
            {t('auth.passwordsDontMatch')}
          </Text>
        )}
        <View style={{ gap: space(2) }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} accessibilityRole="header">
            {t('auth.ageQuestion')}
          </Text>
          <Chips options={SIGNUP_AGE_ANSWERS.map((value) => ({ value, label: t(`auth.age.${value}`) }))} value={ageRange as SignupAgeAnswer} onChange={setAgeRange} />
          <Body muted style={{ fontSize: 13 }}>{t('auth.ageHint')}</Body>
        </View>
        {/* Optional and unticked: ticking it is the only thing that records marketing consent; signing up works the same without it. */}
        <CheckRow tone="primary" checked={marketing} onChange={setMarketing} label={t('marketing.statement')} hint={t('marketing.hint')} />
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
