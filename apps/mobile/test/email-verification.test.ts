/**
 * Email verification (client): reading the link token, what each server answer shows, when the banner
 * and the verification page appear (onboarding stays first), routes, and translations in all four languages.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EmailVerificationState } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { linkOutcome, linkToken, mustVerifyNow, secondsLeft, showVerificationBanner } from '../src/lib/email-verification';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_9'; // 43 chars, base64url
const state = (s: Partial<EmailVerificationState>): EmailVerificationState => ({ verified: false, verifiedAt: null, required: true, restrictedFrom: null, restricted: false, ...s });

test('the token is read from the link fragment (or an app deep-link parameter); malformed ones are flagged', () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(linkToken(`#token=${TOKEN}`), TOKEN);
  assert.equal(linkToken(`token=${TOKEN}`), TOKEN);
  assert.equal(linkToken('', TOKEN), TOKEN, 'deep link ?token=');
  assert.equal(linkToken(undefined, [TOKEN]), TOKEN);
  assert.equal(linkToken(`#token=${TOKEN}`, 'other'), TOKEN, 'the fragment wins');
  assert.equal(linkToken(''), null, 'no token: "check your email" page');
  assert.equal(linkToken(null, undefined), null);
  for (const bad of ['#token=', '#token=short', `#token=${TOKEN}x`, `#token=${TOKEN.slice(1)}!`, '#token=<script>']) assert.equal(linkToken(bad), '', bad);
});

test('each server answer maps to a clear page state', () => {
  assert.equal(linkOutcome({ status: 410, code: 'verification_link_expired' }), 'expired');
  assert.equal(linkOutcome({ status: 400, code: 'verification_link_invalid' }), 'invalid');
  assert.equal(linkOutcome({ status: 409, code: 'verification_link_used', body: { details: { emailVerified: true } } }), 'used_verified');
  assert.equal(linkOutcome({ status: 409, code: 'verification_link_used', body: { details: { emailVerified: false } } }), 'used');
  for (const e of [{ status: 0, code: 'network' }, { status: 429, code: 'too_many_requests' }, { status: 500 }, null, new Error('x')]) assert.equal(linkOutcome(e), 'error');
});

test('banner for new unverified accounts only; the page takes over only when the server restricts', () => {
  assert.equal(showVerificationBanner(state({})), true);
  assert.equal(showVerificationBanner(state({ verified: true })), false);
  assert.equal(showVerificationBanner(state({ required: false })), false, 'older accounts are never nagged');
  assert.equal(showVerificationBanner(undefined), false, 'state unknown (offline): nothing shown');
  assert.equal(mustVerifyNow(state({ restricted: true })), true);
  assert.equal(mustVerifyNow(state({})), false);
  assert.equal(mustVerifyNow(undefined), false, 'never blocks on the client when the state is unknown');
  assert.equal(secondsLeft(Date.now() + 59_500, Date.now()), 60);
  assert.equal(secondsLeft(Date.now() - 1, Date.now()), 0);
});

test('routes: the page works signed in and out; home keeps onboarding first, then verification', () => {
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  const signedOut = layout.indexOf('guard={!user}');
  const lastGuardEnd = layout.lastIndexOf('</Stack.Protected>');
  const at = layout.indexOf('name="verify-email"');
  assert.ok(at > lastGuardEnd && signedOut > 0, 'verify-email is outside both guarded groups');
  const home = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
  const onboarding = home.indexOf('<Redirect href="/onboarding"');
  const verify = home.indexOf('<Redirect href="/verify-email"');
  assert.ok(onboarding > 0 && verify > onboarding, 'onboarding redirect comes before the verification redirect');
  assert.ok(home.includes('mustVerifyNow(') && home.includes('<VerifyEmailBanner />'));
  const page = readFileSync(new URL('../src/app/verify-email.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('history?.replaceState') && page.includes("'hashchange'"), 'the token is removed from the address bar; a new fragment is picked up');
  assert.ok(!/console\.(log|info|warn|error)/.test(page), 'the page never logs (tokens included)');
  const signUp = readFileSync(new URL('../src/app/sign-up.tsx', import.meta.url), 'utf8');
  assert.ok(signUp.includes('language: appLanguage'), 'the verification email uses the app language');
});

type Dict = { [k: string]: string | Dict };
const LOCALES = { en, fr, es, ar } as unknown as Record<string, Dict>;
const KEYS = ['bannerTitle', 'bannerBody', 'bannerDeadline', 'checkTitle', 'checkBody', 'restrictedBody', 'resend', 'resent', 'resendWait', 'checkAgain', 'notYet', 'checking', 'successTitle', 'successBody', 'continue', 'signInToContinue', 'expiredTitle', 'expiredBody', 'invalidTitle', 'invalidBody', 'usedTitle', 'usedBody', 'usedVerifiedBody', 'errorTitle', 'signedOutBody', 'sendLink', 'requested', 'alreadyTitle', 'alreadyBody'];
const CODES = ['email_not_verified', 'email_send_failed', 'email_unavailable', 'verification_link_invalid', 'verification_link_expired', 'verification_link_used'];

for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
  test(`${lang}: every verification string and error is translated`, async () => {
    await initI18n(lang);
    const v = LOCALES[lang].verify as Dict;
    for (const k of KEYS) assert.ok(typeof v[k] === 'string' && (v[k] as string).trim(), `${lang} verify.${k}`);
    const codes = (LOCALES[lang].errors as Dict).codes as Dict;
    for (const c of CODES) assert.ok(typeof codes[c] === 'string' && (codes[c] as string).trim(), `${lang} errors.codes.${c}`);
    assert.ok((((LOCALES[lang].nav as Dict).verifyEmail) as string).trim());
    const body = i18n.t('verify.checkBody', { email: 'a@b.co' });
    assert.ok(body.includes('a@b.co'), body);
    assert.ok(i18n.t('verify.resendWait', { seconds: 42 }).includes('42'));
    if (lang === 'ar') assert.match(i18n.t('verify.checkTitle'), /\p{Script=Arabic}/u);
  });
}
