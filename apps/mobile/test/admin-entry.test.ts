/**
 * Account → Administration → Admin dashboard: shown only when the server confirms the owner account,
 * opens the existing /admin screen, and is translated in every app language. The server still refuses
 * every /admin endpoint to non-owners (apps/api/test/admin.test.ts); this entry is only navigation.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { ADMIN_ROUTE, adminAccessQueryKey, showAdminEntry } from '../src/admin/access';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('owner: the entry is shown when GET /admin/access confirms the owner account', () => {
  assert.equal(showAdminEntry({ owner: true }), true);
});

test('non-owner: hidden while loading, on 403/401 or network errors (no data), and for anything but owner: true', () => {
  assert.equal(showAdminEntry(undefined), false, 'loading, or the request failed (403 for non-owners)');
  assert.equal(showAdminEntry(null), false);
  assert.equal(showAdminEntry({}), false);
  assert.equal(showAdminEntry({ owner: false }), false);
  assert.equal(showAdminEntry({ owner: 'true' }), false, 'only the exact server answer counts');
});

test('the answer is cached per account, so it never carries over to another signed-in user', () => {
  assert.notDeepEqual(adminAccessQueryKey('user-a'), adminAccessQueryKey('user-b'));
  assert.notDeepEqual(adminAccessQueryKey(undefined), adminAccessQueryKey('user-a'));
});

test('visibility comes from the server, not from an email or role in the app', () => {
  const entry = src('admin/AdminEntry.tsx');
  assert.match(entry, /queryFn: api\.adminAccess/);
  assert.match(entry, /showAdminEntry\(access\.data\)/);
  assert.match(entry, /retry: false/, 'a 403 is final; no retries');
  assert.match(entry, /enabled: !!user/, 'signed-out visitors never ask');
  assert.match(src('lib/api.ts'), /adminAccess: \(\) => request<\{ owner: true \}>\('\/admin\/access'\)/);
  for (const [name, code] of [['admin/AdminEntry.tsx', entry], ['admin/access.ts', src('admin/access.ts')], ['app/account.tsx', src('app/account.tsx')]]) {
    assert.doesNotMatch(code, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${name}: no email address`);
    assert.doesNotMatch(code, /OWNER_(EMAILS|USER_IDS)|isOwner/, `${name}: no owner list in the app`);
  }
});

test('navigation: the row opens the existing /admin screen, inside a separate Administration section of Account', () => {
  assert.equal(ADMIN_ROUTE, '/admin');
  assert.ok(existsSync(new URL('../src/app/admin.tsx', import.meta.url)), 'the /admin route exists');
  assert.match(src('app/admin.tsx'), /export \{ default \} from '@\/admin\/AdminScreen'/);
  const entry = src('admin/AdminEntry.tsx');
  assert.match(entry, /onPress=\{\(\) => router\.push\(ADMIN_ROUTE\)\}/);
  assert.match(entry, /<SectionLabel>\{t\('account\.administration'\)\}<\/SectionLabel>/);
  assert.match(entry, /label=\{t\('account\.adminDashboard'\)\}/);
  const account = src('app/account.tsx');
  assert.match(account, /import \{ AdminEntry \} from '@\/admin\/AdminEntry';/);
  assert.equal(account.match(/<AdminEntry \/>/g)?.length, 1, 'rendered once on the Account page');
});

test('the section title and row label exist in every app language', () => {
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    for (const key of ['administration', 'adminDashboard'] as const) {
      const value = (l.account as Record<string, string>)[key];
      assert.equal(typeof value, 'string', `${lang}.account.${key}`);
      assert.ok(value.trim().length > 0, `${lang}.account.${key}`);
    }
  }
  assert.equal(en.account.administration, 'Administration');
  assert.equal(en.account.adminDashboard, 'Admin dashboard');
});
