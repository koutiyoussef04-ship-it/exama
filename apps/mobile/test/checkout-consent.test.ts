/** Web checkout consents: two unticked boxes, translated, required before Stripe Checkout opens. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('both consent statements and the error are translated, name the price and the 14-day period', () => {
  for (const [lang, l] of Object.entries({ en, es, fr, ar })) {
    const p = l.paywall as Record<string, string>;
    assert.ok(p.consentRenewal.includes('{{price}}') && p.consentRenewal.includes('{{per}}'), `${lang} renewal consent names the price`);
    for (const key of ['consentStartNow', 'consentStartNowTrial']) assert.match(p[key], /14|١٤/, `${lang} ${key} mentions the 14-day period`);
    assert.notEqual(p.consentStartNow, p.consentStartNowTrial, lang);
    assert.ok((l.errors.codes as Record<string, string>).checkout_consent_required, `${lang} error message`);
    assert.match((l.deleteAccount as Record<string, string>).webSubscriptionNote, /14|١٤/, `${lang} delete-account note points to withdrawal`);
  }
});

test('the paywall starts with both boxes unticked, re-asks after a plan change, and gates the button', () => {
  const paywall = src('app/paywall.tsx');
  assert.match(paywall, /useState\(false\);\s*\n\s*const \[startNowConsent, setStartNowConsent\] = useState\(false\)/);
  assert.match(paywall, /useEffect\(\(\) => setRenewalConsent\(false\), \[tier, period\]\)/, 'a new price needs a new renewal consent');
  assert.match(paywall, /disabled=\{[^}]*webCheckout && !\(renewalConsent && startNowConsent\)/);
  assert.match(paywall, /consent, language: appLanguage/);
});

test('the web store refuses to open checkout without the consents (the server checks again)', () => {
  const stripe = src('lib/store/stripe.ts');
  assert.match(stripe, /if \(!consent\) throw new ApiError\(400, [^)]*'checkout_consent_required'\)/);
  assert.match(src('lib/api.ts'), /stripeCheckout: \([^)]*consent: CheckoutConsent/);
});
