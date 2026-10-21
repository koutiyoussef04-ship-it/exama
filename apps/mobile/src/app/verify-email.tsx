/**
 * Email verification page, signed in or out (the link may be opened on another device).
 *
 *   /verify-email#token=…  → checks the link: confirmed / already used / expired / invalid (+ new link). A sign-up
 *                            link creates the account and signs it in here.
 *   /verify-email          → "Check your email": resend (with the server's cooldown), "I've confirmed it",
 *                            or, signed out, ask for a new link by email (same answer for every address).
 *   ?email=…&pending=1     → right after sign-up (or signing in before confirming): the address is filled in.
 *
 * The server decides who must confirm and enforces it; this page only reflects it.
 */
import type { EmailVerificationState } from '@study/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Text, View } from 'react-native';
import { Body, Button, Card, colors, ErrorText, Field, Screen, space, TextButton, Title, WorkingCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { linkOutcome, linkToken, secondsLeft, type LinkOutcome } from '@/lib/email-verification';
import { usePreferences } from '@/lib/preferences';
import { emailVerificationKey, useEmailVerification } from '@/lib/use-email-verification';

/**
 * The link's token. On the web it is read from the fragment (also when only the fragment changes,
 * e.g. a link pasted into a tab already on this page) and then removed from the address bar, so it
 * doesn't stay in the history, screenshots or shared URLs.
 */
function useLinkToken(): string | null {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(() => linkToken(Platform.OS === 'web' ? globalThis.location?.hash : null, params.token));
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const clear = () => {
      if (globalThis.location?.hash) globalThis.history?.replaceState(globalThis.history.state, '', globalThis.location.pathname + globalThis.location.search);
    };
    const onHash = () => {
      const next = linkToken(globalThis.location?.hash);
      if (next !== null) {
        setToken(next);
        clear();
      }
    };
    // After the router has written its own history entry for this page.
    const id = setTimeout(clear, 0);
    globalThis.addEventListener?.('hashchange', onHash);
    return () => {
      clearTimeout(id);
      globalThis.removeEventListener?.('hashchange', onHash);
    };
  }, []);
  return token;
}

/**
 * Confirmed: update the cached state right away (the course list must not bounce back here on stale
 * data while it refetches), then refetch the server's version.
 */
function markVerified(qc: QueryClient, userId: string) {
  const key = emailVerificationKey(userId);
  qc.setQueryData<EmailVerificationState>(key, (s) => (s ? { ...s, verified: true, verifiedAt: s.verifiedAt ?? new Date().toISOString(), restricted: false, restrictedFrom: null } : s));
  void qc.invalidateQueries({ queryKey: key });
}

export default function VerifyEmail() {
  const token = useLinkToken();
  // Keyed by token: a second link opened in the same tab is checked too.
  return token === null ? <CheckYourEmail /> : <OpenedLink key={token} token={token} />;
}

function Done({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <>
      <Card style={{ gap: space(3), alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.success, fontSize: 22, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
            ✓
          </Text>
        </View>
        <Title>{title}</Title>
        <Body muted>{body}</Body>
        {/* Opened from the email on a phone while the app holds the session: the app picks the change up by itself. */}
        {!user && Platform.OS === 'web' && <Body muted>{t('verify.backToApp')}</Body>}
      </Card>
      {user ? <Button title={t('verify.continue')} onPress={() => router.replace('/')} /> : <Button title={t('verify.signInToContinue')} onPress={() => router.replace('/sign-in')} />}
    </>
  );
}

function OpenedLink({ token }: { token: string }) {
  const { t } = useTranslation();
  const { user, signInWith } = useAuth();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<LinkOutcome | 'checking'>(token ? 'checking' : 'invalid');
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  const check = async () => {
    setOutcome('checking');
    setError(null);
    try {
      const r = await api.verifyEmail(token);
      // A sign-up link: the account now exists and this is its first session.
      if (r.auth) await signInWith(r.auth);
      else if (user) markVerified(qc, user.id);
      setOutcome('verified');
    } catch (e) {
      setError(e);
      setOutcome(linkOutcome(e));
    }
  };
  useEffect(() => {
    if (!token || started.current) return; // a link is checked once per visit (it works only once)
    started.current = true;
    void check();
  }, [token]);

  return (
    <Screen>
      {outcome === 'checking' && <WorkingCard title={t('verify.checking')} />}
      {outcome === 'verified' && <Done title={t('verify.successTitle')} body={t('verify.successBody')} />}
      {outcome === 'used_verified' && <Done title={t('verify.usedTitle')} body={t('verify.usedVerifiedBody')} />}
      {(outcome === 'expired' || outcome === 'invalid' || outcome === 'used') && (
        <>
          <View style={{ gap: space(1) }}>
            <Title>{t(outcome === 'expired' ? 'verify.expiredTitle' : outcome === 'used' ? 'verify.usedTitle' : 'verify.invalidTitle')}</Title>
            <Body muted>{t(outcome === 'expired' ? 'verify.expiredBody' : outcome === 'used' ? 'verify.usedBody' : 'verify.invalidBody')}</Body>
          </View>
          <NewLink />
        </>
      )}
      {outcome === 'error' && (
        <Card style={{ gap: space(3) }}>
          <Body style={{ fontWeight: '600' }}>{t('verify.errorTitle')}</Body>
          <ErrorText error={error} />
          <Button variant="secondary" title={t('common.tryAgain')} onPress={() => void check()} />
        </Card>
      )}
    </Screen>
  );
}

/** "Check your email" (no link opened). */
function CheckYourEmail() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const state = useEmailVerification();
  const params = useLocalSearchParams<{ email?: string; pending?: string }>();
  if (!user) {
    const pendingEmail = params.pending === '1' && typeof params.email === 'string' ? params.email : '';
    return (
      <Screen>
        <View style={{ gap: space(1) }}>
          <Title>{t('verify.checkTitle')}</Title>
          <Body muted>{pendingEmail ? t('verify.pendingBody', { email: pendingEmail }) : t('verify.signedOutBody')}</Body>
        </View>
        <NewLink initialEmail={pendingEmail} sentJustNow={!!pendingEmail} />
      </Screen>
    );
  }
  if (state.data?.verified) {
    return (
      <Screen>
        <Done title={t('verify.alreadyTitle')} body={t('verify.alreadyBody')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <Title>{t('verify.checkTitle')}</Title>
        <Body muted>{t('verify.checkBody', { email: user.email })}</Body>
      </View>
      {state.data?.restricted && (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }}>
          <Body>{t('verify.restrictedBody')}</Body>
        </Card>
      )}
      <NewLink checkAgain />
    </Screen>
  );
}

/**
 * "Send a new link": signed in → for this account (with the cooldown the server reports);
 * signed out → by email address (the answer is the same whatever the address).
 */
function NewLink({ checkAgain = false, initialEmail = '', sentJustNow = false }: { checkAgain?: boolean; initialEmail?: string; sentJustNow?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { appLanguage } = usePreferences();
  const qc = useQueryClient();
  const state = useEmailVerification();
  // Signed out: which of the address's accounts the link is for (organization sign-ups pass it along).
  const accountParam = useLocalSearchParams<{ account?: string }>().account;
  const [email, setEmail] = useState(initialEmail);
  // Right after sign-up the server has just sent the link: the same one-minute wait applies.
  const [retryAt, setRetryAt] = useState(() => (sentJustNow ? Date.now() + 60_000 : 0));
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const wait = secondsLeft(retryAt, now);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [retryAt]);
  const waitFor = (seconds: number) => {
    const at = Date.now();
    setNow(at);
    setRetryAt(at + seconds * 1000);
  };

  const send = useMutation({
    mutationFn: async () => {
      setNotice(null);
      if (user) {
        const r = await api.resendVerification(appLanguage);
        if (r.alreadyVerified) {
          markVerified(qc, user.id);
          return;
        }
        waitFor(r.retryAfterSeconds);
        setNotice(r.sent ? { text: t('verify.resent'), ok: true } : null);
      } else {
        const r = await api.requestVerification(email.trim(), appLanguage, accountParam === 'organization' ? 'organization' : undefined);
        waitFor(r.retryAfterSeconds);
        setNotice({ text: t('verify.requested', { email: email.trim() }), ok: true });
      }
    },
  });
  const refresh = useMutation({
    mutationFn: async () => {
      setNotice(null);
      const r = await state.refetch();
      if (r.data && !r.data.verified) setNotice({ text: t('verify.notYet'), ok: false });
    },
  });

  return (
    <View style={{ gap: space(3) }}>
      {!user && (
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
          onSubmitEditing={() => email.trim() && wait === 0 && send.mutate()}
        />
      )}
      {!!notice && (
        <Body style={{ color: notice.ok ? colors.success : colors.warning, fontWeight: '600' }}>
          {notice.text}
        </Body>
      )}
      <ErrorText error={send.error ?? refresh.error} />
      {checkAgain && <Button title={t('verify.checkAgain')} onPress={() => refresh.mutate()} loading={refresh.isPending} />}
      <Button
        variant={checkAgain ? 'secondary' : 'primary'}
        title={user ? t('verify.resend') : t('verify.sendLink')}
        onPress={() => send.mutate()}
        loading={send.isPending}
        disabled={wait > 0 || (!user && !email.trim())}
      />
      {wait > 0 && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('verify.resendWait', { seconds: wait })}</Body>}
      {!user && <TextButton title={t('nav.signIn')} tone="muted" onPress={() => router.replace('/sign-in')} />}
    </View>
  );
}
