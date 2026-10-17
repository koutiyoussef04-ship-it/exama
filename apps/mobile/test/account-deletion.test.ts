/** Account deletion: the 30-day email restriction is announced before deleting; its exact end is shown only afterwards. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the warning, success line and a generic sign-up error exist in every language', () => {
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    const d = l.deleteAccount as Record<string, string>;
    assert.ok(d.emailHold.includes('{{days}}') && d.emailHold.includes('{{email}}'), `${lang} emailHold`);
    assert.ok(d.successEmailHold.includes('{{date}}'), `${lang} successEmailHold`);
    const err = (l.errors.codes as Record<string, string>).signup_email_unavailable;
    // Generic: no placeholders (no date) and no hint that the address had an account.
    assert.ok(err && !err.includes('{{'), `${lang} error`);
    assert.doesNotMatch(err, /delet|supprim|elimin|حذف|recent|récemment|reciente|مؤخر/i, `${lang} error is generic`);
  }
});

test('the delete screen shows the warning before the password field, and the exact end time afterwards', () => {
  const screen = src('app/delete-account.tsx');
  const warning = screen.indexOf("t('deleteAccount.emailHold'");
  assert.ok(warning > 0 && warning < screen.indexOf("t('deleteAccount.passwordLabel')"));
  assert.match(screen, /days: DELETED_EMAIL_HOLD_DAYS, email: user\?\.email/);
  assert.match(screen, /t\('deleteAccount\.successEmailHold', \{ date: formatMoment\(done\.emailReusableAt, locale\) \}\)/);
  assert.match(screen, /hour: '2-digit', minute: '2-digit'/, 'date and time, not a rounded day');
  assert.doesNotMatch(src('lib/errors.ts'), /availableOn|email_recently_deleted/);
});
