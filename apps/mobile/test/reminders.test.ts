/**
 * Daily study reminders are server-sent emails now: what the Account card and plan offer show, the
 * unsubscribe link, the four languages, and that the app no longer schedules on-device notifications.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EmailPreferences } from '@study/shared';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { reminderState, showReminderOffer, unsubscribeToken } from '../src/lib/reminders-core';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const prefs = (over: Partial<EmailPreferences> = {}): EmailPreferences => ({ studyReminders: true, available: true, emailVerified: true, sentToThisAccount: true, marketing: false, marketingAvailable: true, ...over });

test('card state: hidden when the server does not send them or the account has a subscription; verify first; then on/off', () => {
  assert.equal(reminderState(undefined), 'hidden');
  assert.equal(reminderState(prefs({ available: false })), 'hidden');
  assert.equal(reminderState(prefs({ sentToThisAccount: false })), 'hidden', 'subscribers never see the switch');
  assert.equal(reminderState(prefs({ emailVerified: false })), 'verify');
  assert.equal(reminderState(prefs()), 'on');
  assert.equal(reminderState(prefs({ studyReminders: false })), 'off');
  assert.deepEqual((['hidden', 'verify', 'on', 'off'] as const).map(showReminderOffer), [false, true, false, true]);
});

test('unsubscribe link: token from the fragment (or a route param); malformed → invalid', () => {
  const tok = '0b3f3c1e-9a7d-4a51-8b1e-2f6f0c4d9e11.' + 'a'.repeat(32);
  assert.equal(unsubscribeToken(`#token=${tok}`), tok);
  assert.equal(unsubscribeToken('', tok), tok);
  assert.equal(unsubscribeToken(null, [tok]), tok);
  assert.equal(unsubscribeToken('#token=nope'), '');
  assert.equal(unsubscribeToken(null, null), null);
});

test('reminder and unsubscribe texts exist in every language', () => {
  const keys = Object.keys(en.reminders);
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    assert.deepEqual(Object.keys(l.reminders), keys, lang);
    for (const k of keys) assert.ok((l.reminders as Record<string, string>)[k]?.trim(), `${lang} reminders.${k}`);
    assert.ok((l.errors.codes as Record<string, string>).unsubscribe_link_invalid, lang);
    assert.ok((l.nav as Record<string, string>).unsubscribe, lang);
  }
  // No more notification permission or "only in the app" wording.
  assert.doesNotMatch(JSON.stringify(en.reminders), /notification|iPhone and Android|phone’s settings/i);
});

test('the app no longer schedules on-device notifications; it only cancels ones left by older versions', () => {
  const native = src('lib/reminders.ts');
  assert.doesNotMatch(native, /scheduleNotificationAsync|requestPermissionsAsync/);
  assert.match(native, /cancelScheduledNotificationAsync/);
  const layout = src('app/_layout.tsx');
  assert.match(layout, /clearLegacyReminders\(\)/);
  for (const f of ['app/_layout.tsx', 'app/plan/[id].tsx', 'app/plan/setup.tsx']) assert.doesNotMatch(src(f), /syncReminders/, f);
  // The unsubscribe page asks before changing anything and reads the token from the fragment.
  const page = src('app/unsubscribe.tsx');
  assert.match(page, /onPress=\{\(\) => stop\.mutate\(marketing \? 'marketing' : 'study_reminders'\)\}/); // a button press, never on load; the link without a category is the study-reminder link
  assert.doesNotMatch(page, /useEffect\([^)]*stop\.mutate/, 'nothing changes until the person presses a button');
  assert.match(page, /globalThis\.location\?\.hash/);
  assert.match(layout, /name="unsubscribe"/);
});
