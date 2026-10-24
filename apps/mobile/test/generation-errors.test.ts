/**
 * Draft generation (organization workspace), bugs found during outreach on 24 Oct 2026:
 *  - a failed generation showed the upload message ("could not send this file… update the app") although the file
 *    was already in: it now has its own message, and browsers' "Failed to fetch" counts as a network failure;
 *  - the "not checked" verification note was a fixed English sentence: it is now shown in the interface language.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = { en, es, fr, ar } as const;

test('generation failures have their own message in every language, never the upload wording', () => {
  for (const [lang, l] of Object.entries(LOCALES)) {
    const g = l.org.course.generate;
    for (const key of ['failed', 'failedServer'] as const) {
      assert.ok(g[key] && g[key].length > 20, `${lang}: org.course.generate.${key}`);
      assert.notEqual(g[key], l.errors.request, `${lang}: ${key} is not the upload message`);
    }
    assert.equal(l.errors.codes.generation_failed, g.failed, `${lang}: the API code reads like the card's message`);
    assert.ok(l.org.item.verificationUnavailable.length > 20, `${lang}: verificationUnavailable`);
  }
  assert.match(fr.org.course.generate.failedServer, /Votre fichier n’est pas en cause/);
  assert.doesNotMatch(fr.org.course.generate.failed + fr.org.course.generate.failedServer, /mettez l’application à jour/);
});

test('the Generate card formats its errors with generationErrorMessage; business errors keep their own wording', () => {
  const page = src('app/org/courses/[id].tsx');
  assert.match(page, /<ErrorText error=\{generate\.error\} format=\{generationErrorMessage\} \/>/);
  const errors = src('lib/errors.ts');
  const fn = errors.slice(errors.indexOf('export function generationErrorMessage'), errors.indexOf('export function errorMessage'));
  assert.match(fn, /err\.code === 'generation_failed' \|\| err\.code === 'ai_bad_output'\) return t\('org\.course\.generate\.failed'\)/);
  assert.match(fn, /err\.code === 'ai_rate_limited'\) return errorMessage\(err\)/, 'busy: the usual "try again in a minute"');
  assert.match(fn, /err\.status === 0 \|\| err\.status >= 500\) return t\('org\.course\.generate\.failedServer'\)/, 'no readable response or a server error: not an upload problem');
  assert.match(fn, /return errorMessage\(err\);\n\}/, 'plan, allowance, too little text… keep their own messages');
  const ui = src('components/ui.tsx');
  assert.match(ui, /export function ErrorText\(\{ error, format = errorMessage \}/, 'other screens are unchanged');
});

test('browsers’ own wording for a request with no readable response counts as a network failure', () => {
  const api = src('lib/api.ts');
  const re = new RegExp(/const isNetwork = \/(.*)\/i\.test\(detail\);/.exec(api)![1], 'i');
  for (const msg of ['TypeError: Failed to fetch', 'TypeError: Load failed', 'TypeError: NetworkError when attempting to fetch resource.', 'TypeError: Network request failed']) {
    assert.ok(re.test(msg), msg);
  }
  assert.ok(!re.test('TypeError: Cannot read properties of undefined'), 'other errors still count as request_failed');
});

test('a "not checked" verification shows a translated note instead of the stored English sentence', () => {
  const item = src('app/org/items/[id].tsx');
  assert.match(item, /it\.verification\.verdict === 'unavailable' \? \(\s*<Body muted style=\{\{ fontSize: 14 \}\}>\{t\('org\.item\.verificationUnavailable'\)\}<\/Body>/);
});
