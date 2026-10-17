/** Legal documents exist in every language with the same structure and only known placeholders. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGAL_VERSION } from '@study/shared';
import { fillLegal, LEGAL, LEGAL_MISSING, LEGAL_UPDATED } from '../src/i18n/legal';

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

test('the website renders the same legal text (website/src/data/legal.generated.json is up to date)', async () => {
  const { readFileSync } = await import('node:fs');
  const { LEGAL_WEBSITE_FILE, renderLegalWebsiteJson } = await import('../scripts/export-legal');
  const onDisk = readFileSync(new URL(LEGAL_WEBSITE_FILE, new URL('../scripts/', import.meta.url)), 'utf8');
  assert.equal(onDisk, renderLegalWebsiteJson(), `${LEGAL_WEBSITE_FILE} is out of date — run npm run legal:export -w @study/mobile`);
});

test('web payments (Stripe) and the known providers are disclosed in every language', () => {
  for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
    const privacy = JSON.stringify(LEGAL[lang].privacy);
    const terms = JSON.stringify(LEGAL[lang].terms);
    for (const provider of ['Render', 'Anthropic', 'AssemblyAI', 'Resend', 'Stripe', 'Apple', 'Google']) assert.ok(privacy.includes(provider), `${lang} privacy policy names ${provider}`);
    assert.ok(terms.includes('Stripe'), `${lang} terms cover web subscriptions (Stripe)`);
    assert.match(privacy, /Frankfurt|Fráncfort|Francfort|فرانكفورت/, `${lang} privacy policy says where data is hosted`);
    assert.match(privacy, /30/, `${lang} privacy policy states Anthropic's retention period`);
  }
});

test('only the [bracketed] items that need facts we do not have remain, the same in every language', () => {
  // Each remaining item needs a decision or confirmation from the business or its lawyer (see docs/legal/open-items.md).
  const remaining = { privacy: 2, terms: 2 } as const; // privacy: AssemblyAI training, transfer safeguards; terms: liability, governing law
  for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
    for (const doc of ['privacy', 'terms'] as const) {
      const brackets = LEGAL[lang][doc].sections.flatMap((s) => [...s.body.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]));
      assert.equal(brackets.length, remaining[doc], `${lang} ${doc}: ${brackets.join(' | ')}`);
    }
  }
});

test('the terms state the refund policy: statutory withdrawal only, no voluntary refunds, legal remedies kept', () => {
  // The "Last updated" date is the version recorded with every web checkout.
  assert.equal(LEGAL_UPDATED, LEGAL_VERSION);
  const en = LEGAL.en.terms.sections.map((s) => s.heading);
  const idx = ['Right of withdrawal (consumers in the EU, the EEA and the UK)', 'Refunds', 'If something doesn’t work'].map((h) => en.indexOf(h));
  assert.ok(idx.every((i) => i >= 0), `sections present: ${idx}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'withdrawal, then refunds, then service problems');
  for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
    const [withdrawal, refunds, service] = idx.map((i) => LEGAL[lang].terms.sections[i]);
    // 14 days, the model form needs the business identity, and the immediate-start consent is explained.
    assert.match(withdrawal.body, /14/, `${lang} withdrawal period`);
    for (const ph of ['{{company}}', '{{address}}', '{{email}}']) assert.ok(withdrawal.body.includes(ph), `${lang} model form has ${ph}`);
    assert.ok(refunds.body.trim().length > 0 && service.body.trim().length > 0, lang);
    for (const s of [withdrawal, refunds, service]) assert.doesNotMatch(s.body, /\[[^\]]+\]/, `${lang} ${s.heading} has no open placeholder`);
  }
  const all = JSON.stringify(LEGAL.en.terms);
  assert.doesNotMatch(all, /refund policy and withdrawal/i, 'the old refund placeholder is gone');
  assert.match(all, /Nothing in these terms limits those rights/, 'mandatory consumer rights are preserved');
});

test('privacy and terms disclose the 30-day email hold after account deletion, in every language', () => {
  for (const lang of ['en', 'es', 'fr', 'ar'] as const) {
    const privacy = JSON.stringify(LEGAL[lang].privacy);
    const terms = JSON.stringify(LEGAL[lang].terms);
    assert.match(privacy, /30[^"]{0,400}hash|hash[^"]{0,400}30/, `${lang} privacy policy: 30 days, keyed hash only`);
    assert.match(terms, /30/, `${lang} terms mention the 30 days`);
  }
});
