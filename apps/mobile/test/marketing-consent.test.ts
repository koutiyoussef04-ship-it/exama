/**
 * Optional marketing-email consent in the app: an unticked, optional checkbox on the sign-up screen (never required, never combined
 * with the terms), the same wording as an Account switch, the marketing unsubscribe page, four languages with right-to-left Arabic,
 * and the wording pinned to its version. The daily study-plan email is a separate category and is not claimed by this consent.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MARKETING_CONSENT_VERSION, registerSchema, type Language } from '@study/shared';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import i18n, { initI18n } from '../src/i18n';
import { isRtlLanguage } from '../src/i18n/languages';
import { unsubscribeCategory } from '../src/lib/reminders-core';
import { canSubmitSignup, signupRequest, type SignupForm } from '../src/lib/signup-form';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const LANGS = ['en', 'es', 'fr', 'ar'] as const satisfies readonly Language[];
const L = { en, es, fr, ar };
const form = (over: Partial<SignupForm> = {}): SignupForm => ({ name: 'Lina', email: 'lina@example.com', password: 'correct horse', confirmPassword: 'correct horse', ageRange: '18_24', ...over });
const base = { ...form(), ageRange: '18_24' as const };

// ---------------------------------------------------------------- the wording

/**
 * The consent wording of version 2026-10-v1, all four languages (statement + hint). It is hashed here so that editing any of it
 * without bumping MARKETING_CONSENT_VERSION (packages/shared/src/marketing-consent.ts) fails: a stored consent names a version, and the
 * version must always mean exactly one text per language. After a deliberate change: bump the version, update this hash, and have the
 * new wording reviewed (docs/email/marketing-consent.md).
 */
const WORDING_SHA256 = '647cd5b5646180b2d7fec8498ebb8a2465915e683cce094fe539df9568d3e7af';

test('the consent wording is pinned to its version: changing a word in any language without a new version fails', () => {
  assert.equal(MARKETING_CONSENT_VERSION, '2026-10-v1');
  const hash = createHash('sha256').update(JSON.stringify(LANGS.map((l) => [L[l].marketing.statement, L[l].marketing.hint]))).digest('hex');
  assert.equal(hash, WORDING_SHA256, 'the consent wording changed: bump MARKETING_CONSENT_VERSION, update this hash, and re-review the wording');
});

test('every language states what it covers, that it can be undone, and that it does NOT cover the study reminder emails (a separate category)', () => {
  const covers: Record<Language, RegExp[]> = {
    en: [/tips/, /news/, /offers/, /invitations to come back/, /unsubscribe at any time/],
    es: [/consejos/, /novedades/, /ofertas/, /invitaciones para volver/, /darme de baja en cualquier momento/],
    fr: [/conseils/, /nouveautés/, /offres/, /invitations à revenir/, /me désabonner à tout moment/],
    ar: [/نصائح/, /أخبار/, /عروضًا/, /دعوات للعودة/, /إلغاء الاشتراك في أي وقت/],
  };
  const notStudyReminders: Record<Language, RegExp> = { en: /daily|reminder|study-plan email/i, es: /diario|recordatorio/i, fr: /quotidien|rappel/i, ar: /اليومية|تذكير/ };
  const separate: Record<Language, RegExp[]> = {
    en: [/separate/, /study reminder emails/, /Account/],
    es: [/independiente/, /recordatorio de estudio/, /Cuenta/],
    fr: [/distinct/, /rappel de révision/, /Compte/],
    ar: [/منفصل/, /تذكير المذاكرة/, /الحساب/],
  };
  for (const lang of LANGS) {
    const m = L[lang].marketing;
    for (const re of covers[lang]) assert.match(m.statement, re, `${lang} statement: ${re}`);
    assert.doesNotMatch(m.statement, notStudyReminders[lang], `${lang}: the checkbox must not claim to authorise study reminders (a separate category with its own switch)`);
    for (const re of separate[lang]) assert.match(m.hint, re, `${lang} hint: ${re}`);
    assert.doesNotMatch(m.statement, /terms|conditions|términos|condiciones|conditions d|شروط|politique|política|سياسة|privacy|privacidad|confidentialit|الخصوصية/i, `${lang}: consent wording is not mixed with the mandatory terms`);
  }
});

test('the wording resolves through the app’s translation system in every language, and Arabic is Arabic script', async () => {
  for (const lang of LANGS) {
    await initI18n(lang);
    await i18n.changeLanguage(lang);
    assert.equal(i18n.t('marketing.statement'), L[lang].marketing.statement, lang);
    assert.equal(i18n.t('marketing.hint'), L[lang].marketing.hint, lang);
    assert.notEqual(i18n.t('marketing.statement'), 'marketing.statement');
  }
  assert.ok(isRtlLanguage('ar'));
  for (const key of ['statement', 'hint', 'accountTitle', 'accountLabel', 'unsubscribeTitle', 'unsubscribeBody', 'unsubscribeConfirm', 'unsubscribeAlso', 'unsubscribeKeep', 'unsubscribeDoneTitle', 'unsubscribeDoneBody', 'unsubscribeDoneAllBody'] as const)
    assert.match(ar.marketing[key], /[؀-ۿ]/, `ar.marketing.${key} is Arabic`);
  await initI18n('en');
});

test('the four languages have exactly the same marketing keys', () => {
  const keys = Object.keys(en.marketing).sort();
  for (const lang of LANGS) assert.deepEqual(Object.keys(L[lang].marketing).sort(), keys, lang);
});

// ---------------------------------------------------------------- the request

test('the sign-up request carries marketingConsent ONLY when the box is ticked, with the version and the language of the wording shown', () => {
  for (const language of LANGS) {
    for (const opts of [{ language }, { language, marketing: false }] as const) {
      const body = signupRequest(base, opts);
      assert.ok(!('marketingConsent' in body), `${language}: unticked → no key at all`);
      assert.ok(!JSON.stringify(body).includes('marketing'));
    }
    const ticked = signupRequest(base, { language, marketing: true });
    assert.deepEqual(ticked.marketingConsent, { version: MARKETING_CONSENT_VERSION, language });
    assert.ok(registerSchema.safeParse(ticked).success, `${language}: the API schema accepts it`);
  }
  // The unticked body is exactly what it was before this feature existed (older API versions keep working).
  assert.deepEqual(signupRequest(base, { language: 'fr' }), { name: 'Lina', email: 'lina@example.com', password: 'correct horse', language: 'fr', ageRange: '18_24' });
  // The shared schema refuses anything that is not an explicit version + language.
  for (const bad of [true, 'true', 1, {}, { version: MARKETING_CONSENT_VERSION }, { version: 'x', language: 'en' }, { version: MARKETING_CONSENT_VERSION, language: 'de' }, { version: MARKETING_CONSENT_VERSION, language: 'en', at: 'now' }])
    assert.equal(registerSchema.safeParse({ ...signupRequest(base, { language: 'en' }), marketingConsent: bad }).success, false, JSON.stringify(bad));
});

test('ticking or not ticking never decides whether the form can be submitted', () => {
  const rules = src('lib/signup-form.ts');
  const canSubmit = rules.slice(rules.indexOf('export const canSubmitSignup'), rules.indexOf('/**', rules.indexOf('export const canSubmitSignup')));
  assert.ok(!/marketing/i.test(canSubmit), 'canSubmitSignup does not look at the consent');
  assert.equal(canSubmitSignup(form()), true);
});

// ---------------------------------------------------------------- the sign-up screen

test('sign-up screen: optional, unticked by default, above Create account, separate from the terms, cleared when sign-up is declined', () => {
  const screen = src('app/sign-up.tsx');
  assert.match(screen, /const \[marketing, setMarketing\] = useState\(false\)/, 'unticked by default');
  assert.doesNotMatch(screen, /useState\(true\)|setMarketing\(true\)/, 'nothing ticks it for the user');
  const age = screen.indexOf("t('auth.ageQuestion')");
  const box = screen.indexOf("t('marketing.statement')");
  const button = screen.indexOf("t('auth.createAccount')");
  const agreement = screen.indexOf("t('auth.agreement')");
  assert.ok(age > 0 && age < box && box < button && button < agreement, 'order: age question, the consent, Create account, then the terms notice');
  assert.match(screen.slice(box - 120, box + 160), /<CheckRow tone="primary" checked=\{marketing\} onChange=\{setMarketing\} label=\{t\('marketing\.statement'\)\} hint=\{t\('marketing\.hint'\)\}/);
  assert.match(screen, /signupRequest\(\{ \.\.\.form, ageRange \}, \{ language: appLanguage, marketing \}\)/);
  const decline = screen.slice(screen.indexOf('const decline'), screen.indexOf('const submit'));
  assert.match(decline, /setMarketing\(false\)/, 'declined for age: nothing is kept, including the choice');
  // The terms notice is its own sentence and does not mention the consent; the consent does not mention the terms.
  for (const lang of LANGS) assert.doesNotMatch(L[lang].auth.agreement, /offers|ofertas|offres|عروض|tips|consejos|conseils|نصائح/i, `${lang}: the terms notice carries no marketing consent`);
  const disabled = screen.slice(screen.indexOf("<Button title={t('auth.createAccount')}"), screen.indexOf("<Button title={t('auth.createAccount')}") + 200);
  assert.ok(!/marketing/.test(disabled), 'the button does not depend on the box');
});

test('the checkbox row is accessible, mirrors in right-to-left languages, and has no left/right-only styling', () => {
  const ui = src('components/ui.tsx');
  const row = ui.slice(ui.indexOf('export function CheckRow'), ui.indexOf('export function EmptyState'));
  assert.match(row, /accessibilityRole="checkbox"/);
  assert.match(row, /accessibilityState=\{\{ checked \}\}/);
  assert.match(row, /aria-checked=\{checked\}/, 'screen readers on the web');
  assert.match(row, /accessibilityLabel=\{hint \? `\$\{label\} \$\{hint\}` : label\}/, 'the label and the hint are read together');
  assert.match(row, /minHeight: 44/, 'a touch target of at least 44');
  assert.match(row, /flexDirection: 'row'/, 'a plain row: React Native mirrors it by itself under I18nManager.isRTL, and the web follows <html dir>');
  assert.doesNotMatch(row, /textAlign: ?'(left|right)'|margin(Left|Right)|padding(Left|Right)|\bleft:|\bright:/, 'no hard-coded physical sides');
  const card = src('components/marketing-consent.tsx');
  assert.doesNotMatch(card, /textAlign: ?'(left|right)'|margin(Left|Right)|padding(Left|Right)|\bleft:|\bright:/);
});

// ---------------------------------------------------------------- Account switch

test('Account: the switch shows the server’s state (off for everyone who never said yes), turning it on is the explicit yes, off withdraws', () => {
  const card = src('components/marketing-consent.tsx');
  assert.match(card, /if \(!prefs\?\.marketingAvailable\) return null;/);
  assert.match(card, /value=\{prefs\.marketing\}/, 'its state comes from the server, not a default');
  assert.match(card, /onValueChange=\{\(on\) => setMarketing\.mutate\(on\)\}/);
  assert.match(card, /t\('marketing\.statement'\)[\s\S]*t\('marketing\.hint'\)/, 'the same wording as the sign-up checkbox is shown next to the switch');
  assert.match(src('app/account.tsx'), /<ReminderSettingsCard \/>\s*<MarketingSettingsCard \/>/, 'its own card, next to (not inside) the study-reminder card');
  const api = src('lib/api.ts');
  assert.match(api, /updateMarketingConsent: \(on: boolean, language: Language\)/);
  assert.match(api, /marketing: on \? \{ consent: true, version: MARKETING_CONSENT_VERSION, language \} : \{ consent: false \}/);
  const hook = src('lib/use-email-preferences.ts');
  assert.match(hook, /api\.updateMarketingConsent\(on, appLanguage\)/);
  assert.match(hook, /api\.updateEmailPreferences\(studyReminders\)/, 'the daily study-plan email keeps its own mutation');
});

// ---------------------------------------------------------------- unsubscribe page

test('unsubscribe link category: marketing only when the link says so; any other link is the old daily-study-email link', () => {
  assert.equal(unsubscribeCategory('#token=abc&category=marketing'), 'marketing');
  assert.equal(unsubscribeCategory('', 'marketing'), 'marketing');
  assert.equal(unsubscribeCategory(null, ['marketing']), 'marketing');
  assert.equal(unsubscribeCategory('#token=abc'), 'study_reminders');
  assert.equal(unsubscribeCategory('#token=abc&category=all'), 'study_reminders', 'not a category a link can carry');
  assert.equal(unsubscribeCategory('#token=abc&category=nonsense'), 'study_reminders');
  assert.equal(unsubscribeCategory(null, null), 'study_reminders');
});

test('unsubscribe page: the marketing link stops marketing, offers the daily plan email as a separate second choice, and asks before changing anything', () => {
  const page = src('app/unsubscribe.tsx');
  assert.match(page, /stop\.mutate\(marketing \? 'marketing' : 'study_reminders'\)/);
  assert.match(page, /marketing && <Button variant="secondary" title=\{t\('marketing\.unsubscribeAlso'\)\} onPress=\{\(\) => stop\.mutate\('all'\)\}/);
  assert.match(page, /api\.unsubscribeEmails\(token!, what\)/);
  assert.match(page, /Asks before changing anything/);
  for (const lang of LANGS) {
    assert.match(L[lang].marketing.unsubscribeBody, new RegExp(lang === 'en' ? 'separate setting' : lang === 'es' ? 'ajuste aparte' : lang === 'fr' ? 'réglage distinct' : 'إعداد منفصل'), `${lang}: says the daily plan email is not affected`);
  }
});
