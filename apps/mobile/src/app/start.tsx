/**
 * /start — where the website's buttons land (see lib/start-intent.ts). Signed out: remembers where to
 * continue, then shows sign-up (or sign-in); the index screen continues there after sign-up/sign-in and
 * onboarding. Signed in: straight to the destination.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/ui';
import { APP_LANGUAGE_KEY } from '@/i18n/prefs-store';
import { useAuth } from '@/lib/auth';
import { usePreferences } from '@/lib/preferences';
import { parseStartLink, PENDING_START_KEY, startDestination } from '@/lib/start-intent';
import { kv } from '@/lib/storage';

export default function Start() {
  const params = useLocalSearchParams<Record<string, string>>();
  const { user } = useAuth();
  const { setAppLanguage } = usePreferences();
  const [link] = useState(() => parseStartLink(params));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      // The website's language, unless the student already chose one in the app.
      if (link.lang && !(await kv.get(APP_LANGUAGE_KEY))) await setAppLanguage(link.lang);
      if (link.intent && !user) await kv.set(PENDING_START_KEY, JSON.stringify(link.intent));
      else await kv.remove(PENDING_START_KEY);
      setReady(true);
    })();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <Loading />;
  if (user) return <Redirect href={link.intent ? startDestination(link.intent) : '/'} />;
  if (link.mode === 'signin') return <Redirect href="/sign-in" />;
  // ?account=organization: the sign-up form opens on the organization step (no account-type question).
  return <Redirect href={link.account ? { pathname: '/sign-up', params: { account: link.account } } : '/sign-up'} />;
}
