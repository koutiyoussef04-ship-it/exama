import type { APIRoute } from 'astro';
import { absoluteUrl } from '../config/site';
import { LEGAL_IS_DRAFT, LEGAL_LANGS, legalPath } from '../data/legal';
import { LANGS, pathFor } from '../i18n';

/**
 * Only indexable pages belong here: the home page in every language (/, /es/, /fr/, /ar/). /support
 * (every language) is a `noindex` interim page; add it when it goes live.
 * The Privacy Policy and Terms (every language) are listed automatically once their text is final
 * (LEGAL_IS_DRAFT = false in apps/mobile/src/i18n/legal.ts, then `npm run legal:export -w @study/mobile`).
 */
const LEGAL_PATHS = LEGAL_IS_DRAFT ? [] : LEGAL_LANGS.flatMap((lang) => [legalPath('privacy', lang), legalPath('terms', lang)]);
const PATHS = [...LANGS.map((lang) => pathFor(lang)), ...LEGAL_PATHS];

export const GET: APIRoute = () => {
  const urls = PATHS.map((p) => `  <url><loc>${absoluteUrl(p)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
