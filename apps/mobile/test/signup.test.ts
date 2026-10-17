/**
 * Sign-up "Confirm password": both fields required, they must match before any request, the mismatch
 * message is translated, and the confirmation never leaves the device. Plus the Free plan's course
 * allowance wording (one course per account; deleting it doesn't give it back).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import i18n, { initI18n } from '../src/i18n';
import { canSubmitSignup, MIN_PASSWORD_LENGTH, passwordsMatch, showPasswordMismatch, signupRequest, type SignupForm } from '../src/lib/signup-form';

const form = (over: Partial<SignupForm> = {}): SignupForm => ({
  name: 'Lina',
  email: 'lina@example.com',
  password: 'correct horse',
  confirmPassword: 'correct horse',
  ageRange: '18_24',
  ...over,
});

test('passwords that differ block sign-up and show the mismatch message', () => {
  const f = form({ confirmPassword: 'correct hors' });
  assert.equal(passwordsMatch(f), false);
  assert.equal(showPasswordMismatch(f), true);
  assert.equal(canSubmitSignup(f), false);
  // Case and spacing matter: no normalisation of passwords.
  assert.equal(canSubmitSignup(form({ confirmPassword: 'Correct horse' })), false);
  assert.equal(canSubmitSignup(form({ confirmPassword: 'correct horse ' })), false);
});

test('both password fields are required; the message only appears once the second has content', () => {
  assert.equal(canSubmitSignup(form({ confirmPassword: '' })), false);
  assert.equal(showPasswordMismatch(form({ confirmPassword: '' })), false, 'no error while it is still empty');
  assert.equal(canSubmitSignup(form({ password: '', confirmPassword: '' })), false);
});

test('matching passwords pass, subject to the existing rules (8+ characters, name, email, age answer)', () => {
  assert.equal(canSubmitSignup(form()), true);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(canSubmitSignup(form({ password: 'short', confirmPassword: 'short' })), false);
  assert.equal(canSubmitSignup(form({ name: '  ' })), false);
  assert.equal(canSubmitSignup(form({ email: '' })), false);
  assert.equal(canSubmitSignup(form({ ageRange: null })), false);
});

test('the request never contains the confirmation', () => {
  const body = signupRequest({ ...form({ name: ' Lina ', email: ' lina@example.com ' }), ageRange: '18_24' }, { language: 'fr' });
  assert.deepEqual(body, { name: 'Lina', email: 'lina@example.com', password: 'correct horse', language: 'fr', ageRange: '18_24' });
  assert.ok(!('confirmPassword' in body));
  assert.ok(!JSON.stringify(body).includes('confirm'));
});

test('sign-up screen: the confirmation field sits under the password, is checked before any request and is not sent', () => {
  const src = readFileSync(new URL('../src/app/sign-up.tsx', import.meta.url), 'utf8');
  const pw = src.indexOf("label={t('auth.password')}");
  const confirm = src.indexOf("label={t('auth.confirmPassword')}");
  const age = src.indexOf("t('auth.ageQuestion')");
  assert.ok(pw > 0 && confirm > pw && confirm < age, 'Confirm password directly below Password');
  assert.ok(src.slice(confirm, confirm + 400).includes('secureTextEntry'), 'hidden like the password');
  const submit = src.slice(src.indexOf('const submit = async'), src.indexOf('if (blocked === null)'));
  assert.ok(submit.indexOf('if (!passwordsMatch(form)) return setMismatch(true)') >= 0, 'mismatch stops the submit');
  assert.ok(submit.indexOf('passwordsMatch(form)') < submit.indexOf('await signUp('), 'checked before the request');
  assert.ok(submit.includes('await signUp(signupRequest('), 'the body is built without the confirmation');
  assert.ok(!/signUp\([^)]*confirmPassword/.test(submit), 'confirmPassword is never passed to the API');
  assert.ok(src.includes("t('auth.passwordsDontMatch')") && src.includes('accessibilityRole="alert"'));
  assert.ok(/canSubmit = canSubmitSignup\(form\)/.test(src), 'the button stays disabled until everything is valid');
  // Nothing about the confirmation is stored (no storage calls with it).
  assert.ok(!/kv\.set\([^)]*onfirm/.test(src));
});

for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
  test(`${lang}: confirm-password, mismatch and Free course-limit texts are translated`, async () => {
    await initI18n(lang);
    const tr = (k: string, o?: Record<string, unknown>) => String(i18n.t(k as 'nav.flashcards', o as never));
    for (const k of ['auth.confirmPassword', 'auth.passwordsDontMatch', 'account.usageFreeCourses']) assert.ok(!tr(k).startsWith('auth.') && !tr(k).startsWith('account.'), `${lang} ${k}`);
    const msg = tr('limits.free_courses', { count: 1, plan: tr('plan.free') });
    assert.ok(msg.includes(tr('plan.free')) && !msg.includes('{{'), msg);
    if (lang === 'en') {
      assert.equal(tr('auth.passwordsDontMatch'), 'Passwords do not match.');
      assert.equal(msg, 'You’ve reached the maximum number of courses on the Free plan. Upgrade your plan to create more courses.');
    }
  });
}

test('the Free course-limit message is used for Free only (trial and paid plans keep theirs); Account labels it per account', () => {
  const errors = readFileSync(new URL('../src/lib/errors.ts', import.meta.url), 'utf8');
  assert.ok(errors.includes("body.tier === 'free' && body.feature === 'courses'") && errors.includes("'limits.free_courses'"));
  assert.ok(errors.indexOf("body.tier === 'trial'") < errors.indexOf("'limits.free_courses'"), 'the trial keeps its own wording');
  const account = readFileSync(new URL('../src/app/account.tsx', import.meta.url), 'utf8');
  assert.ok(account.includes("e.tier === 'free' ? t('account.usageFreeCourses') : t('account.usageCourses')"));
  // The upload pre-check still opens the existing paywall; the server has the final say.
  const courses = readFileSync(new URL('../src/lib/courses.ts', import.meta.url), 'utf8');
  assert.ok(courses.includes("openPaywall('limit_courses'"));
});
