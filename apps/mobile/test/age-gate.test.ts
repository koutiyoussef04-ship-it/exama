/**
 * Minimum sign-up age (13), client side and policy text: the neutral question (every age can be
 * answered, nothing pre-selected), "Under 13" stops sign-up on the device without contacting the
 * server or keeping the details, the 24-hour "declined" marker, and the updated Privacy Policy and
 * Terms in all four languages.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SIGNUP_AGE_ANSWERS } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import { LEGAL, LEGAL_UPDATED } from '../src/i18n/legal';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { AGE_BLOCK_KEY, AGE_BLOCK_MS, ageBlockActive, ageBlockValue, isBelowMinimumAge, MINIMUM_SIGNUP_AGE } from '../src/lib/age-gate';

test('only "Under 13" is below the minimum age of 13', () => {
  assert.equal(MINIMUM_SIGNUP_AGE, 13);
  assert.deepEqual(SIGNUP_AGE_ANSWERS.filter(isBelowMinimumAge), ['under_13']);
  assert.equal(isBelowMinimumAge(null), false);
  assert.equal(isBelowMinimumAge(undefined), false);
});

test('the "declined" marker lasts 24 hours and holds nothing but its end time', () => {
  const now = 1_800_000_000_000;
  const v = ageBlockValue(now);
  assert.equal(v, String(now + AGE_BLOCK_MS));
  assert.equal(AGE_BLOCK_KEY, 'signup_age_block_until');
  assert.equal(ageBlockActive(v, now + 1000), true);
  assert.equal(ageBlockActive(v, now + AGE_BLOCK_MS + 1), false, 'expires');
  for (const bad of [null, undefined, '', 'yes', 'NaN', String(now + 10 * AGE_BLOCK_MS)]) assert.equal(ageBlockActive(bad, now), false, String(bad));
});

test('sign-up: neutral question, nothing pre-selected, and "Under 13" never reaches the server', () => {
  const src = readFileSync(new URL('../src/app/sign-up.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('SIGNUP_AGE_ANSWERS.map'), 'every answer, including Under 13, is offered (FTC: neutral age screen)');
  assert.ok(src.includes('useState<SignupAgeAnswer | null>(null)'), 'no default answer');
  const rules = readFileSync(new URL('../src/lib/signup-form.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('canSubmitSignup(form)') && rules.includes('!!f.ageRange'), 'an answer is required');
  const submit = src.slice(src.indexOf('const submit = async'), src.indexOf('if (blocked === null)'));
  assert.ok(submit.indexOf('isBelowMinimumAge(ageRange)) return decline()') < submit.indexOf('await signUp('), 'declined before any request');
  const decline = src.slice(src.indexOf('const decline = () =>'), src.indexOf('const submit = async'));
  for (const reset of ["setName('')", "setEmail('')", "setPassword('')", 'setAgeRange(null)', 'kv.set(AGE_BLOCK_KEY, ageBlockValue())']) assert.ok(decline.includes(reset), reset);
  assert.ok(src.includes("e.code === 'age_requirement_not_met'"), 'a refusal from the server is handled the same way');
  assert.ok(src.includes('ageBlockActive(v)'), 'the form is not offered again during the 24 hours');
  // FTC COPPA FAQ H.3: the question screen itself doesn't announce that under-13s can't join.
  const question = src.slice(src.indexOf("t('auth.ageQuestion')"), src.indexOf("t('auth.ageHint')"));
  assert.ok(!question.includes('ageBlocked'));
});

type Dict = { [k: string]: string | Dict };
const LOCALES = { en, fr, es, ar } as unknown as Record<string, Dict>;
for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
  test(`${lang}: age answers, the "13 and over" message and the age errors are translated`, async () => {
    await initI18n(lang);
    const tr = (k: string, o?: Record<string, unknown>): string => String(i18n.t(k as 'nav.flashcards', o as never));
    const age = ((LOCALES[lang].auth as Dict).age as Dict);
    assert.deepEqual(Object.keys(age).sort(), [...SIGNUP_AGE_ANSWERS].sort(), 'exactly the five answers (no "prefer not to say")');
    for (const a of SIGNUP_AGE_ANSWERS) assert.ok(!tr(`auth.age.${a}`).startsWith('auth.'), a);
    for (const k of ['ageQuestion', 'ageHint', 'ageBlockedTitle', 'ageBlockedBody', 'ageBlockedBack']) assert.ok(!tr(`auth.${k}`, { age: 13 }).startsWith('auth.'), k);
    assert.ok(tr('auth.ageBlockedTitle', { age: 13 }).includes('13'));
    assert.ok(tr('auth.ageBlockedBody', { age: 13 }).includes('13'));
    for (const c of ['age_requirement_not_met', 'age_range_required']) assert.ok(!tr(`errors.codes.${c}`).startsWith('errors.'), c);
    assert.ok(tr('errors.codes.age_requirement_not_met').includes('13'));
  });

  test(`${lang}: Privacy Policy and Terms state the minimum age of 13, with no age placeholder left`, () => {
    const docs = LEGAL[lang];
    const all = JSON.stringify(docs);
    assert.ok(!all.includes('[13/16]') && !/minimum age for your markets|edad mínima para tus mercados|âge minimum pour vos marchés|الحد الأدنى للعمر في أسواقك/.test(all));
    const children = docs.privacy.sections.find((s) => /13/.test(s.body) && /24/.test(s.body));
    assert.ok(children, 'the children section describes the 13+ rule and the 24-hour marker');
    assert.ok(docs.terms.sections.some((s) => s.body.includes('13')), 'Terms: at least 13 to create an account');
    const collected = docs.privacy.sections[1].body;
    assert.ok(/18–24/.test(collected), 'the age group is listed among the data collected');
  });
}

test('the published Markdown copies match the in-app texts (npm run legal:export)', () => {
  const md = readFileSync(new URL('../../../docs/legal/privacy-policy.md', import.meta.url), 'utf8');
  assert.ok(md.includes(`_Last updated: ${LEGAL_UPDATED}_`) || md.includes(LEGAL_UPDATED));
  for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
    for (const s of LEGAL[lang].privacy.sections) assert.ok(md.includes(s.body.split('\n')[0]), `${lang}: ${s.heading}`);
  }
  const terms = readFileSync(new URL('../../../docs/legal/terms-of-use.md', import.meta.url), 'utf8');
  for (const lang of ['en', 'fr', 'es', 'ar'] as const) assert.ok(terms.includes(LEGAL[lang].terms.sections[2].body), lang);
});
