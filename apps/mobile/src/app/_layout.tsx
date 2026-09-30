import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Body, colors, Loading, space, Title } from '@/components/ui';
import { API_CONFIG_ERROR } from '@/lib/api';
import { platform, track } from '@/lib/analytics';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PreferencesProvider, usePreferences } from '@/lib/preferences';
import { clearReminders, syncReminders, useReminderTaps } from '@/lib/reminders';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  useAppOpenedTracking(isLoading ? null : !!user);
  useStudyReminders(isLoading ? null : !!user);

  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync().catch(() => {});
  }, [isLoading]);
  if (isLoading) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontWeight: '600' },
        // Chevron-only back button: long course titles would otherwise crowd the header.
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" options={{ title: t('nav.signIn'), headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ title: t('nav.createAccount') }} />
        <Stack.Screen name="forgot-password" options={{ title: t('nav.forgotPassword') }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="index" options={{ title: t('nav.courses') }} />
        <Stack.Screen name="documents/[id]" options={{ title: t('nav.course') }} />
        <Stack.Screen name="exams/[id]" options={{ title: '' }} />
        <Stack.Screen name="account" options={{ title: t('nav.account') }} />
        <Stack.Screen name="delete-account" options={{ title: t('nav.deleteAccount') }} />
        <Stack.Screen name="paywall" options={{ title: t('nav.upgrade'), presentation: 'modal' }} />
        <Stack.Screen name="checkout" options={{ title: t('nav.checkout') }} />
        <Stack.Screen name="plan/[id]" options={{ title: t('nav.studyPlan') }} />
        <Stack.Screen name="plan/setup" options={{ title: t('nav.planSetup') }} />
        <Stack.Screen name="materials/[id]" options={{ title: t('nav.material') }} />
        <Stack.Screen name="add-material" options={{ title: t('nav.addMaterial'), presentation: 'modal' }} />
      </Stack.Protected>
      {/* Available signed in or out (linked from sign-up and the paywall). */}
      <Stack.Screen name="language" options={{ title: t('nav.language') }} />
      <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      <Stack.Screen name="support" options={{ title: t('nav.support') }} />
    </Stack>
  );
}

/**
 * iOS/Android: tell TanStack Query when the app comes back to the foreground, so screens refetch
 * stale data (processing status of an upload, entitlement after a purchase in the store sheet or a
 * renewal) — the browser's focus events don't exist in React Native. The web keeps its default.
 */
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => sub.remove();
  });
}

/**
 * Daily study reminders (iOS/Android): rebuilt from the student's plans on launch and whenever the
 * app comes back to the foreground; removed on sign-out. Taps open the plan or course.
 */
function useStudyReminders(signedIn: boolean | null) {
  useReminderTaps(signedIn === true);
  useEffect(() => {
    if (signedIn === null) return;
    if (!signedIn) {
      void clearReminders();
      return;
    }
    void syncReminders();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void syncReminders());
    return () => sub.remove();
  }, [signedIn]);
}

/** app_opened on launch (once the session is restored) and whenever the app returns from the background. */
function useAppOpenedTracking(authenticated: boolean | null) {
  const { appLanguage, aiLanguage } = usePreferences();
  const props = useRef({ authenticated, appLanguage, aiLanguage });
  props.current = { authenticated, appLanguage, aiLanguage };
  const launched = useRef(false);

  const send = () => {
    const p = props.current;
    if (p.authenticated === null) return;
    track('app_opened', { platform, authenticated: p.authenticated, app_language: p.appLanguage, ai_language: p.aiLanguage });
  };

  useEffect(() => {
    if (authenticated === null || launched.current) return;
    launched.current = true;
    send();
  }, [authenticated]);

  useEffect(() => {
    let prev = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev === 'background' && next === 'active') send();
      prev = next;
    });
    return () => sub.remove();
  }, []);
}

/** Release builds without a valid HTTPS API URL never fall back to a developer machine. */
function ConfigError() {
  const { t } = useTranslation();
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space(6), gap: space(3), backgroundColor: colors.bg }}>
      <Title>{t('errors.configTitle')}</Title>
      <Body muted>{t('errors.config')}</Body>
      {__DEV__ && <Body muted style={{ fontSize: 13 }}>{API_CONFIG_ERROR}</Body>}
    </View>
  );
}

function Root() {
  const { ready } = usePreferences();
  if (!ready) return <Loading />; // language + layout direction first, so nothing renders in the wrong language
  if (API_CONFIG_ERROR) return <ConfigError />;
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <PreferencesProvider>
          <StatusBar style="dark" />
          <Root />
        </PreferencesProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
