/**
 * Website "start" links (app /start): new visitors sign up, existing ones sign in, and both continue to
 * the plans screen afterwards — from known values only (no open redirect), once, within an hour.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseStartLink, PENDING_START_TTL_MS, readPendingStart, startDestination } from '../src/lib/start-intent';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 16, 9, 0);

test('known values only: mode, plan, period and language; anything else is ignored', () => {
  assert.deepEqual(parseStartLink({ intent: 'plans', plan: 'student', period: 'yearly', lang: 'ar' }, NOW), {
    mode: 'signup',
    intent: { kind: 'plans', tier: 'student', period: 'yearly', at: NOW },
    lang: 'ar',
  });
  assert.equal(parseStartLink({ mode: 'signin' }, NOW).mode, 'signin');
  assert.equal(parseStartLink({ mode: 'whatever' }, NOW).mode, 'signup');
  assert.equal(parseStartLink({}, NOW).intent, null, 'no intent: just sign up / sign in');
  const odd = parseStartLink({ intent: 'plans', plan: 'enterprise', period: 'weekly', lang: 'de', next: 'https://evil.example', redirect: '//evil.example' } as never, NOW);
  assert.deepEqual(odd, { mode: 'signup', intent: { kind: 'plans', tier: null, period: null, at: NOW }, lang: null });
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

test('the flow: /start remembers the destination for signed-out visitors; after sign-up/in and onboarding the course list continues there once', () => {
  const start = src('app/start.tsx');
  assert.match(start, /if \(link\.intent && !user\) await kv\.set\(PENDING_START_KEY/);
  assert.match(start, /if \(user\) return <Redirect href=\{link\.intent \? startDestination\(link\.intent\) : '\/'\} \/>/);
  assert.match(start, /link\.mode === 'signin' \? '\/sign-in' : '\/sign-up'/);
  const index = src('app/index.tsx');
  assert.match(index, /if \(gate !== 'proceed' \|\| mustVerify \|\| !pending\.intent\) return;/, 'only after onboarding (and verification, when enforced)');
  assert.match(index, /pending\.consume\(\);\s*router\.push\(to\);/, 'used once');
  // Both forms link to each other, so an existing account can sign in from the website's button.
  assert.match(src('app/sign-up.tsx'), /<Link href="\/sign-in" replace/);
  assert.match(src('app/sign-in.tsx'), /<Link href="\/sign-up"/);
  // The plans screen pre-selects the website's plan, but never over a current paid plan, and starts nothing by itself.
  const paywall = src('app/paywall.tsx');
  assert.match(paywall, /!entitlement\.data\?\.isPremium && \(PAID_TIERS as readonly string\[\]\)\.includes\(params\.tier/);
  assert.match(src('app/_layout.tsx'), /<Stack\.Screen name="start"/);
});
