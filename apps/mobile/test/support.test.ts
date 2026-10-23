/**
 * Support: the screen shows contact@exama.app (Exama's public contact address) clearly, a button opens mailto:, and the address stays
 * visible and copyable (selectable text; a Copy button on the web) when no email app is available.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { copyText, SUPPORT_EMAIL, supportMailto } from '../src/lib/support';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the support address', () => {
  assert.equal(SUPPORT_EMAIL, 'contact@exama.app');
});

test('the legal screens show the same contact address unless EXPO_PUBLIC_SUPPORT_EMAIL sets another one', () => {
  assert.match(src('config/app-config.ts'), /supportEmail: opt\(process\.env\.EXPO_PUBLIC_SUPPORT_EMAIL\) \?\? SUPPORT_EMAIL,/);
  assert.match(src('lib/org-plans.ts'), /email: string = SUPPORT_EMAIL/, 'plan requests from Account go to the same address');
  for (const dir of ['app', 'components', 'lib', 'config', 'i18n']) {
    for (const f of readdirSync(new URL(`../src/${dir}`, import.meta.url), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      assert.doesNotMatch(src(`${dir}/${f}`), /examaweb|@gmail\.com/i, `${dir}/${f} has no old address`);
    }
  }
});

test('mailto: opens the address with only a subject prefilled (no account or device details)', () => {
  assert.equal(supportMailto('Exama support (v1.2.3)'), 'mailto:contact@exama.app?subject=Exama%20support%20(v1.2.3)');
  assert.equal(supportMailto('دعم Exama'), `mailto:contact@exama.app?subject=${encodeURIComponent('دعم Exama')}`);
  assert.doesNotMatch(supportMailto('x'), /body=|cc=|bcc=/);
});

test('copy: uses the browser clipboard when there is one, and reports failure otherwise', async () => {
  const g = globalThis as { navigator?: unknown };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    const written: string[] = [];
    setNavigator({ clipboard: { writeText: async (t: string) => void written.push(t) } });
    assert.equal(await copyText(SUPPORT_EMAIL), true);
    assert.deepEqual(written, ['contact@exama.app']);
    setNavigator({ clipboard: { writeText: async () => Promise.reject(new Error('NotAllowedError')) } });
    assert.equal(await copyText(SUPPORT_EMAIL), false, 'permission refused');
    setNavigator({});
    assert.equal(await copyText(SUPPORT_EMAIL), false, 'no clipboard API (native apps)');
    setNavigator(undefined);
    assert.equal(await copyText(SUPPORT_EMAIL), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete g.navigator;
  }
});

test('the screen: address always shown and selectable, mailto button, copy on web, hints when no email app', () => {
  const screen = src('app/support.tsx');
  assert.match(screen, /<Text\s+selectable/, 'the address can be selected and copied on every platform');
  assert.match(screen, /\{SUPPORT_EMAIL\}/, 'the address is rendered as text, not only inside a link');
  assert.doesNotMatch(screen, /\{email \?|legalConfig/, 'shown even without build-time configuration');
  assert.match(screen, /supportMailto\(/);
  assert.match(screen, /Linking\.openURL\(url\)\.catch\(\(\) => setNoEmailApp\(true\)\)/, 'no email app: say so, keep the address');
  assert.match(screen, /location/, 'web: mailto in the same tab');
  assert.match(screen, /Platform\.OS === 'web' \?/);
  assert.match(screen, /copyText\(SUPPORT_EMAIL\)/);
  assert.match(screen, /t\('support\.copyHintNative'\)/);
  assert.match(src('app/account.tsx'), /router\.push\('\/support'\)/, 'Account → Support opens this screen');
});

test('support texts exist in every app language', () => {
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    const s = l.support as Record<string, string>;
    for (const key of ['emailLabel', 'emailButton', 'emailSubject', 'copyButton', 'copied', 'copyHintNative', 'copyFailed', 'noEmailApp']) {
      assert.ok(typeof s[key] === 'string' && s[key].trim().length > 0, `${lang}.support.${key}`);
      assert.doesNotMatch(s[key], /@/, `${lang}.support.${key}: the address lives in one place (lib/support.ts)`);
    }
  }
});
