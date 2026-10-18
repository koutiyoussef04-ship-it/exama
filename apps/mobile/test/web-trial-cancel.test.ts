/**
 * Cancelling a web (Stripe) free trial ends premium access as soon as the cancellation is confirmed
 * (enforced by the server: apps/api/test/stripe-billing.test.ts). The app and the Terms say so.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LEGAL } from '../src/i18n/legal';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';

test('Account (web): a Stripe trial says that cancelling ends premium access at once', () => {
  const account = readFileSync(new URL('../src/app/account.tsx', import.meta.url), 'utf8');
  assert.match(account, /\{e\.status === 'trialing' && <Body muted style=\{\{ fontSize: 13, textAlign: 'center' \}\}>\{t\('account\.webTrialCancelHint'\)\}<\/Body>\}/);
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    const v = (l.account as Record<string, string>).webTrialCancelHint;
    assert.ok(typeof v === 'string' && v.trim().length > 0, lang);
  }
});

test('Terms: a web trial cancellation ends access at once; paid periods and store trials keep theirs', () => {
  const marker = { en: 'Cancelling a free trial on the web ends premium access as soon as the cancellation is confirmed', es: 'Si cancelas una prueba gratuita en la web, el acceso premium termina en cuanto se confirma la cancelación', fr: 'Si vous résiliez un essai gratuit sur le web, l’accès premium prend fin dès que la résiliation est confirmée', ar: 'أما إلغاء التجربة المجانية عبر الويب فيُنهي الوصول المميّز فور تأكيد الإلغاء' } as const;
  for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
    const terms = LEGAL[lang].terms.sections.map((s) => s.body).join('\n');
    assert.ok(terms.includes(marker[lang]), lang);
  }
  const en = LEGAL.en.terms.sections.map((s) => s.body).join('\n');
  assert.doesNotMatch(en, /you keep access until the end of the trial or of the period already paid/, 'the old rule is gone');
  assert.match(en, /you keep access until the end of the period already paid or, for an App Store or Google Play free trial, until the end of the trial/);
});
