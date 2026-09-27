/**
 * Writes the public web versions of the Privacy Policy and Terms of Use (docs/legal/*.md) from the
 * in-app text in src/i18n/legal.ts, so the App Store URLs and the app always say the same thing.
 *   npm run legal:export -w @study/mobile
 * test/legal.test.ts fails if the docs are out of date.
 */
import { writeFileSync } from 'node:fs';
import { LEGAL, LEGAL_IS_DRAFT, LEGAL_UPDATED, type LegalDoc } from '../src/i18n/legal';

const LANG_NAMES = { en: 'English', es: 'Español', fr: 'Français', ar: 'العربية' } as const;

export function renderLegalMarkdown(doc: 'privacy' | 'terms'): string {
  const out: string[] = [];
  if (LEGAL_IS_DRAFT) {
    out.push('> **DRAFT — not ready to publish.** Replace every `[bracketed]` item and `{{placeholder}}`, have the text reviewed, then set `LEGAL_IS_DRAFT = false` in `apps/mobile/src/i18n/legal.ts`. Generated from that file — edit it there and run `npm run legal:export -w @study/mobile`.', '');
  }
  for (const lang of Object.keys(LEGAL) as (keyof typeof LEGAL)[]) {
    const d: LegalDoc = LEGAL[lang][doc];
    out.push(`# ${d.title} (${LANG_NAMES[lang]})`, '', `_Last updated: ${LEGAL_UPDATED}_`, '');
    for (const s of d.sections) out.push(`## ${s.heading}`, '', s.body, '');
    out.push('---', '');
  }
  return out.join('\n');
}

export const LEGAL_FILES = { privacy: '../../../docs/legal/privacy-policy.md', terms: '../../../docs/legal/terms-of-use.md' } as const;

if (process.argv[1]?.endsWith('export-legal.ts')) {
  for (const [doc, path] of Object.entries(LEGAL_FILES)) {
    writeFileSync(new URL(path, import.meta.url), renderLegalMarkdown(doc as 'privacy'));
    console.log(`wrote ${path}`);
  }
}
