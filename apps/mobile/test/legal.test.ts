/** Legal documents exist in every language with the same structure and only known placeholders. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillLegal, LEGAL, LEGAL_MISSING } from '../src/i18n/legal';

test('privacy policy and terms are translated into every launch language', () => {
  const langs = Object.keys(LEGAL);
  assert.deepEqual(langs, ['en', 'es', 'fr', 'ar']);
  for (const doc of ['privacy', 'terms'] as const) {
    const n = LEGAL.en[doc].sections.length;
    for (const lang of langs) {
      const d = LEGAL[lang as 'en'][doc];
      assert.equal(d.sections.length, n, `${lang} ${doc} has ${d.sections.length} sections, en has ${n}`);
      for (const s of d.sections) {
        assert.ok(s.heading.trim() && s.body.trim());
        for (const m of s.body.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(['company', 'email', 'address'].includes(m[1]), m[0]);
      }
    }
  }
});

test('placeholders are filled from config, or shown as clear [to be completed] markers', () => {
  const text = 'Operated by {{company}}, {{address}} — {{email}}';
  assert.equal(fillLegal(text, { company: 'Exama SL', address: 'Madrid', email: 'help@exama.app' }), 'Operated by Exama SL, Madrid — help@exama.app');
  assert.match(fillLegal(text, LEGAL_MISSING.fr), /\[nom de la société\]/);
  // The policy must mention what the app really does: AI processing, account deletion, no tracking.
  const privacy = JSON.stringify(LEGAL.en.privacy);
  assert.match(privacy, /Anthropic/);
  assert.match(privacy, /Delete account/);
  assert.match(privacy, /do not track/);
  assert.match(JSON.stringify(LEGAL.en.terms), /renews automatically/);
});

test('the public web versions (docs/legal) match the in-app text', async () => {
  const { readFileSync } = await import('node:fs');
  const { LEGAL_FILES, renderLegalMarkdown } = await import('../scripts/export-legal');
  for (const [doc, path] of Object.entries(LEGAL_FILES)) {
    const onDisk = readFileSync(new URL(path, new URL('../scripts/', import.meta.url)), 'utf8');
    assert.equal(onDisk, renderLegalMarkdown(doc as 'privacy'), `${path} is out of date — run npm run legal:export -w @study/mobile`);
  }
});
