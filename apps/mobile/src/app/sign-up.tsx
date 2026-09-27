import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Text, TextInput, View } from 'react-native';
import { Body, Button, colors, ErrorText, Field, Screen, space } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignUp() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const canSubmit = !!name.trim() && !!email.trim() && password.length >= 8 && !loading;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await signUp({ name: name.trim(), email: email.trim(), password });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const link = { color: colors.primary, fontWeight: '600' as const, fontSize: 14 };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <Screen>
        <Body muted>{t('auth.signUpIntro')}</Body>
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
      </Screen>
    </KeyboardAvoidingView>
  );
}
