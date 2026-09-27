/**
 * Localization: every language has every string, the right plural forms and the same placeholders;
 * i18next resolves them correctly (incl. Arabic's six plural forms); RTL rules; persistence.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { completePlurals, pluralCategories } from '../src/i18n/plurals';
import {
  changesDirection,
  formattingLocale,
  isRtlLanguage,
  LANGUAGES,
  NATIVE_NAMES,
  resolveAiLanguage,
  resolveInitialLanguage,
} from '../src/i18n/languages';
import { loadLanguagePrefs, saveAiLanguagePref, saveAppLanguage } from '../src/i18n/prefs-store';
import i18n, { initI18n } from '../src/i18n';

type Dict = { [k: string]: string | Dict };
const LOCALES: Record<string, Dict> = { en, es, fr, ar } as unknown as Record<string, Dict>;
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(d: Dict, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}
const placeholders = (s: string) => new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
const base = (key: string) => key.replace(PLURAL, '');

const enFlat = flatten(en as unknown as Dict);
const enBases = new Map<string, Set<string>>(); // base key → placeholders (union over forms)
for (const [k, v] of enFlat) {
  const ph = enBases.get(base(k)) ?? new Set<string>();
  placeholders(v).forEach((p) => ph.add(p));
  enBases.set(base(k), ph);
}
const pluralBases = new Set([...enFlat.keys()].filter((k) => PLURAL.test(k)).map(base));

test('the app ships exactly four languages: en, es, fr, ar', () => {
  assert.deepEqual([...LANGUAGES], ['en', 'es', 'fr', 'ar']);
  assert.deepEqual(Object.keys(NATIVE_NAMES), ['en', 'es', 'fr', 'ar']);
});

for (const [lang, dict] of Object.entries(LOCALES)) {
  test(`${lang}: complete, no stray keys, no empty strings, matching placeholders, correct plural forms`, () => {
    const flat = flatten(dict);
    const bases = new Set([...flat.keys()].map(base));
    const missing = [...enBases.keys()].filter((b) => !bases.has(b));
    assert.deepEqual(missing, [], `${lang} is missing keys`);
    const extra = [...bases].filter((b) => !enBases.has(b));
    assert.deepEqual(extra, [], `${lang} has keys English doesn't`);

    for (const [k, v] of flat) {
      assert.ok(v.trim().length > 0, `${lang}.${k} is empty`);
      const allowed = enBases.get(base(k))!;
      for (const p of placeholders(v)) assert.ok(allowed.has(p), `${lang}.${k} uses unknown placeholder {{${p}}}`);
      // Every placeholder except the plural count must appear in every form.
      for (const p of allowed) if (p !== 'count' || !pluralBases.has(base(k))) assert.ok(placeholders(v).has(p), `${lang}.${k} is missing {{${p}}}`);
      if (PLURAL.test(k)) assert.ok(pluralBases.has(base(k)), `${lang}.${k} is a plural form of a non-plural key`);
    }

    // Plural forms: Arabic must spell out all six; others need one + other (many falls back to other).
    const required = lang === 'ar' ? pluralCategories('ar') : ['one', 'other'];
    for (const b of pluralBases) {
      for (const cat of required) assert.ok(flat.has(`${b}_${cat}`), `${lang}.${b}_${cat} missing`);
    }
  });
}

test('Arabic has the six CLDR plural categories and i18next picks the right one', async () => {
  assert.deepEqual(pluralCategories('ar').sort(), ['few', 'many', 'one', 'other', 'two', 'zero']);
  await initI18n('ar');
  const q = (count: number) => i18n.t('course.questions', { count });
  assert.equal(q(0), 'لا أسئلة');
  assert.equal(q(1), 'سؤال واحد');
  assert.equal(q(2), 'سؤالان');
  assert.equal(q(5), '5 أسئلة');
  assert.equal(q(11), '11 سؤالًا');
  assert.equal(q(100), '100 سؤال');
});

test('i18next renders every language, with interpolation and fallbacks', async () => {
  const cases: Record<string, string> = {
    en: 'Start exam · 8 questions',
    es: 'Empezar examen · 8 preguntas',
    fr: 'Commencer l’examen · 8 questions',
    ar: 'ابدأ الاختبار · 8 أسئلة',
  };
  for (const [lang, expected] of Object.entries(cases)) {
    await initI18n(lang as 'en');
    assert.equal(i18n.t('course.startExam', { count: 8 }), expected);
    assert.ok(!i18n.t('paywall.trialSubtitle').includes('paywall.'), 'no raw keys');
  }
  // Spanish/French "many" (millions) falls back to the "other" form instead of a raw key.
  await initI18n('es');
  assert.equal(i18n.t('course.questions', { count: 1_000_000 }), '1000000 preguntas');
  assert.equal((completePlurals({ x_one: 'a', x_other: 'b' }, 'fr') as Record<string, string>).x_many, 'b');
});

test('RTL: only Arabic is right-to-left; switching direction is detected', () => {
  assert.deepEqual(LANGUAGES.filter((l) => isRtlLanguage(l)), ['ar']);
  assert.equal(changesDirection('en', 'ar'), true);
  assert.equal(changesDirection('ar', 'fr'), true);
  assert.equal(changesDirection('es', 'fr'), false);
  assert.equal((ar as { common: { chevron: string } }).common.chevron, '‹', 'forward arrows mirror in Arabic');
  assert.equal(formattingLocale('ar'), 'ar-u-nu-latn', 'Western digits in the Arabic UI');
  assert.equal(new Intl.NumberFormat(formattingLocale('ar')).format(85), '85');
});

test('default language: saved choice, else first supported device language, else English', () => {
  assert.equal(resolveInitialLanguage('fr', ['es-ES']), 'fr');
  assert.equal(resolveInitialLanguage(null, ['de-DE', 'es-MX', 'en-US']), 'es');
  assert.equal(resolveInitialLanguage(undefined, ['ar-EG']), 'ar');
  assert.equal(resolveInitialLanguage('xx', ['de', 'ja']), 'en');
  assert.equal(resolveInitialLanguage(null, []), 'en');
});

test('AI language: follows the app unless set; can differ from the app (e.g. app es, AI fr)', () => {
  assert.equal(resolveAiLanguage('app', 'es'), 'es');
  assert.equal(resolveAiLanguage('fr', 'es'), 'fr');
  assert.equal(resolveAiLanguage('source', 'ar'), 'source');
});

test('language preferences persist across restarts and ignore corrupt values', async () => {
  const mem = new Map<string, string>();
  const store = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: string) => void mem.set(k, v) };
  assert.deepEqual(await loadLanguagePrefs(store, ['fr-FR']), { appLanguage: 'fr', aiLanguagePref: 'app' }, 'first launch: device language');
  await saveAppLanguage(store, 'ar');
  await saveAiLanguagePref(store, 'es');
  assert.deepEqual(await loadLanguagePrefs(store, ['fr-FR']), { appLanguage: 'ar', aiLanguagePref: 'es' }, 'after restart: saved choices win');
  mem.set('app_language', 'klingon');
  mem.set('ai_language', '{"x":1}');
  assert.deepEqual(await loadLanguagePrefs(store, ['de']), { appLanguage: 'en', aiLanguagePref: 'app' });
});
