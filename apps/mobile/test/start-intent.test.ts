/**
 * Website "start" links (app /start): new visitors sign up, existing ones sign in, and both continue to
 * the plans screen afterwards — from known values only (no open redirect), once, within an hour.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseStartLink, PENDING_START_TTL_MS, readPendingStart, startDestination, startRedirect } from '../src/lib/start-intent';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 16, 9, 0);

test('known values only: mode, plan, period and language; anything else is ignored', () => {
  assert.deepEqual(parseStartLink({ intent: 'plans', plan: 'student', period: 'yearly', lang: 'ar' }, NOW), {
    mode: 'signup',
    account: null,
    intent: { kind: 'plans', tier: 'student', period: 'yearly', at: NOW },
    lang: 'ar',
  });
  assert.equal(parseStartLink({ mode: 'signin' }, NOW).mode, 'signin');
  assert.equal(parseStartLink({ mode: 'signup', account: 'organization' }, NOW).account, 'organization', 'the B2B pages open the organization sign-up');
  assert.equal(parseStartLink({ mode: 'signin', account: 'student' }, NOW).account, 'student', 'every "Log in" on the website names its account type');
  assert.equal(parseStartLink({ account: 'admin' } as never, NOW).account, null);
  assert.equal(parseStartLink({ mode: 'whatever' }, NOW).mode, 'signup');
  assert.equal(parseStartLink({}, NOW).intent, null, 'no intent: just sign up / sign in');
  const odd = parseStartLink({ intent: 'plans', plan: 'enterprise', period: 'weekly', lang: 'de', next: 'https://evil.example', redirect: '//evil.example' } as never, NOW);
  assert.deepEqual(odd, { mode: 'signup', account: null, intent: { kind: 'plans', tier: null, period: null, at: NOW }, lang: null });
  assert.equal(parseStartLink({ intent: 'https://evil.example' }, NOW).intent, null);
});

test('the destination is always the plans screen — never an address from the link', () => {
  const to = startDestination({ kind: 'plans', tier: 'pro', period: 'monthly', at: NOW });
  assert.deepEqual(to, { pathname: '/paywall', params: { trigger: 'website_cta', tier: 'pro', period: 'monthly' } });
  assert.deepEqual(startDestination({ kind: 'plans', tier: null, period: null, at: NOW }), { pathname: '/paywall', params: { trigger: 'website_cta' } });
});

test('a stored destination lasts one hour and must be well-formed', () => {
  const stored = JSON.stringify({ kind: 'plans', tier: 'basic', period: 'monthly', at: NOW });
  assert.deepEqual(readPendingStart(stored, NOW + 10 * 60_000), { kind: 'plans', tier: 'basic', period: 'monthly', at: NOW });
  assert.equal(readPendingStart(stored, NOW + PENDING_START_TTL_MS + 1), null, 'expired');
  assert.equal(readPendingStart(null, NOW), null);
  assert.equal(readPendingStart('{not json', NOW), null);
  assert.equal(readPendingStart(JSON.stringify({ kind: 'url', href: 'https://evil.example', at: NOW }), NOW), null);
  assert.deepEqual(readPendingStart(JSON.stringify({ kind: 'plans', tier: 'x', period: 'y', at: NOW }), NOW), { kind: 'plans', tier: null, period: null, at: NOW });
});

test('where /start sends people: the named account type is kept, and a session of the OTHER identity is never reused', () => {
  const link = (p: Record<string, string>) => parseStartLink(p, NOW);
  const student = { accountType: 'student' as const };
  const organization = { accountType: 'organization' as const };
  // Signed out: the form on the named type. A student link, an untyped link and an organization link.
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'student' }), null), { pathname: '/sign-in', params: { account: 'student' } });
  assert.deepEqual(startRedirect(link({ mode: 'signin' }), null), '/sign-in');
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'organization' }), null), { pathname: '/sign-in', params: { account: 'organization' } });
  assert.deepEqual(startRedirect(link({ mode: 'signup', account: 'organization' }), null), { pathname: '/sign-up', params: { account: 'organization' } });
  assert.deepEqual(startRedirect(link({ mode: 'signup', account: 'student' }), null), '/sign-up', 'the student sign-up is the plain form');
  assert.deepEqual(startRedirect(link({}), null), '/sign-up');
  // Signed in to the identity the link names (or to any, when it names none): straight in, or to the plans screen.
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'student' }), student), '/');
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'organization' }), organization), '/');
  assert.deepEqual(startRedirect(link({ mode: 'signin' }), organization), '/', 'an untyped link keeps whatever session there is');
  assert.deepEqual(startRedirect(link({ intent: 'plans', plan: 'pro' }), student), { pathname: '/paywall', params: { trigger: 'website_cta', tier: 'pro' } });
  // Signed in to the OTHER identity: the switch-account screen — never the current session, never an automatic sign-in.
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'organization' }), student), { pathname: '/switch-account', params: { account: 'organization' } }, 'an organization link never lands in a student session');
  assert.deepEqual(startRedirect(link({ mode: 'signin', account: 'student' }), organization), { pathname: '/switch-account', params: { account: 'student' } });
  assert.deepEqual(startRedirect(link({ mode: 'signup', account: 'organization' }), student), { pathname: '/switch-account', params: { account: 'organization' } });
  assert.deepEqual(startRedirect(link({ intent: 'plans', account: 'organization' }), student), { pathname: '/switch-account', params: { account: 'organization' } }, 'a destination never overrides the identity check');
});

test('the switch-account screen signs out before the other sign-in and never merges or carries a session', () => {
  const sw = src('app/switch-account.tsx');
  assert.match(sw, /if \(!user\) return <Redirect href=\{\{ pathname: '\/sign-in'/, 'signed out: just the sign-in on the requested type');
  assert.match(sw, /if \(user\.accountType === target\) return <Redirect href="\/" \/>/, 'already that identity: nothing to switch');
  assert.match(sw, /await signOut\(\);\s*router\.replace\(\{ pathname: '\/sign-in', params: \{ account: target \} \}\);/, 'sign out, then the sign-in form on the other type — the person types that account’s password');
  assert.doesNotMatch(sw, /signIn\(|signInWith\(|api\.login/, 'the screen never signs anyone in');
  assert.match(src('app/account.tsx'), /pathname: '\/switch-account'/, 'reachable from the Account screen');
  const signIn = src('app/sign-in.tsx');
  assert.match(signIn, /e\.code === 'wrong_account_type'\) setOtherType/, '403 wrong_account_type: the other sign-in is offered, nothing is signed in');
  assert.match(signIn, /await signIn\(\{ email: email\.trim\(\), password, accountType: as \}\)/, 'the session is requested for the chosen type only');
});

test('the flow: /start remembers the destination for signed-out visitors; after sign-up/in and onboarding the course list continues there once', () => {
  const start = src('app/start.tsx');
  assert.match(start, /if \(link\.intent && !user\) await kv\.set\(PENDING_START_KEY/);
  assert.match(start, /return <Redirect href=\{startRedirect\(link, user\)\} \/>/, 'every destination comes from startRedirect (tested above)');
  assert.match(src('app/sign-up.tsx'), /params\.account === 'organization' \? 'organization' : null/, 'the form pre-selects the organization step');
  const index = src('app/index.tsx');
  assert.match(index, /if \(gate !== 'proceed' \|\| mustVerify \|\| !pending\.intent\) return;/, 'only after onboarding (and verification, when enforced)');
  assert.match(index, /pending\.consume\(\);\s*router\.push\(to\);/, 'used once');
  // Both forms link to each other, so an existing account can sign in from the website's button.
  assert.match(src('app/sign-up.tsx'), /<Link href="\/sign-in" replace/);
  assert.match(src('app/sign-in.tsx'), /<Link href=\{\{ pathname: '\/sign-up', params: accountParams \}\}/);
  // The plans screen pre-selects the website's plan, but never over a current paid plan, and starts nothing by itself.
  const paywall = src('app/paywall.tsx');
  assert.match(paywall, /!entitlement\.data\?\.isPremium && \(PAID_TIERS as readonly string\[\]\)\.includes\(params\.tier/);
  assert.match(src('app/_layout.tsx'), /<Stack\.Screen name="start"/);
});
