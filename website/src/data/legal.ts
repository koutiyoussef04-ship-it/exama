/**
 * The Privacy Policy and Terms of Use shown on exama.app — the SAME text as the app's legal screens.
 *
 * Source of truth: apps/mobile/src/i18n/legal.ts. `npm run legal:export -w @study/mobile` writes
 * legal.generated.json next to this file (never edit the JSON by hand); the app's tests fail if it is
 * out of date. The website stays independent of the app: it only reads that data file.
 *
 * {{company}}, {{email}} and {{address}} are filled from src/config/site.ts (`site.legal`). Until a value
 * is confirmed there, the page shows the same "[to be completed]" marker as the app.
 */
import data from './legal.generated.json';
import { site } from '../config/site';

export type LegalLang = 'en' | 'es' | 'fr' | 'ar';
export type LegalDocId = 'privacy' | 'terms';
type Section = { heading: string; body: string };
type Doc = { title: string; sections: Section[] };

export const LEGAL_LANGS = data.languages as LegalLang[];
export const LEGAL_LANG_NAMES = data.languageNames as Record<LegalLang, string>;
/** Date of the current text (ISO). */
export const LEGAL_UPDATED: string = data.updated;
/** True while the text still has [bracketed] items to complete or has not been reviewed. */
export const LEGAL_IS_DRAFT: boolean = data.isDraft;

const docs = data.docs as Record<LegalLang, Record<LegalDocId, Doc>>;
const missing = data.missing as Record<LegalLang, { company: string; email: string; address: string }>;

/** /privacy (English) or /es/privacy, /fr/privacy, /ar/privacy. */
export const legalPath = (doc: LegalDocId, lang: LegalLang) => (lang === 'en' ? `/${doc}` : `/${lang}/${doc}`);
export const isRtl = (lang: LegalLang) => lang === 'ar';

function fill(text: string, lang: LegalLang): string {
  const values = {
    company: site.legal.companyName ?? missing[lang].company,
    email: site.legal.supportEmail ?? missing[lang].email,
    address: site.legal.companyAddress ?? missing[lang].address,
  };
  return text.replace(/\{\{(company|email|address)\}\}/g, (_, k: keyof typeof values) => values[k]);
}

export type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

/** A section body as paragraphs and bullet lists ("• " lines become list items). */
export function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const line of body.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith('• ')) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(line.slice(2));
      else blocks.push({ kind: 'ul', items: [line.slice(2)] });
    } else blocks.push({ kind: 'p', text: line });
  }
  return blocks;
}

export function legalDoc(doc: LegalDocId, lang: LegalLang) {
  const d = docs[lang][doc];
  return {
    title: d.title,
    sections: d.sections.map((s) => ({ heading: fill(s.heading, lang), blocks: toBlocks(fill(s.body, lang)) })),
  };
}

/** Short UI strings around the document (not legal text). */
export const LEGAL_UI: Record<LegalLang, { updated: string; draft: string; languages: string; back: string; description: Record<LegalDocId, string> }> = {
  en: {
    updated: 'Last updated',
    draft: 'Draft — this document is not final. Items in [brackets] are still being completed, and the text has not yet been legally reviewed.',
    languages: 'Language',
    back: '← Back to exama.app',
    description: { privacy: 'How Exama handles your data.', terms: 'The terms for using Exama.' },
  },
  es: {
    updated: 'Última actualización',
    draft: 'Borrador: este documento no es definitivo. Los elementos entre [corchetes] aún se están completando y el texto todavía no ha sido revisado jurídicamente.',
    languages: 'Idioma',
    back: '← Volver a exama.app',
    description: { privacy: 'Cómo trata Exama tus datos.', terms: 'Las condiciones para usar Exama.' },
  },
  fr: {
    updated: 'Dernière mise à jour',
    draft: 'Brouillon — ce document n’est pas définitif. Les éléments entre [crochets] sont en cours de finalisation et le texte n’a pas encore fait l’objet d’une revue juridique.',
    languages: 'Langue',
    back: '← Retour à exama.app',
    description: { privacy: 'Comment Exama traite vos données.', terms: 'Les conditions d’utilisation d’Exama.' },
  },
  ar: {
    updated: 'آخر تحديث',
    draft: 'مسودة — هذا المستند ليس نهائيًا. ما زالت العناصر الواردة بين [قوسين] قيد الاستكمال، ولم يخضع النص بعد لمراجعة قانونية.',
    languages: 'اللغة',
    back: 'العودة إلى exama.app →',
    description: { privacy: 'كيف يتعامل Exama مع بياناتك.', terms: 'شروط استخدام Exama.' },
  },
};
