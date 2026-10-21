/**
 * The website's languages and URLs. English lives at the root (/, /privacy, /terms, /support); the
 * others under a language prefix (/es/, /fr/…, /ar/…). Same four languages as the app.
 */
export const LANGS = ['en', 'es', 'fr', 'ar'] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Each language in its own name (for the language selector). */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', ar: 'العربية' };
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');
export const OG_LOCALE: Record<Lang, string> = { en: 'en_US', es: 'es_ES', fr: 'fr_FR', ar: 'ar_AR' };

/** Path of a page in a language: '' = home, 'privacy', 'terms', 'support'. */
export function pathFor(lang: Lang, page: '' | 'privacy' | 'terms' | 'support' = ''): string {
  if (lang === 'en') return page ? `/${page}` : '/';
  return page ? `/${lang}/${page}` : `/${lang}/`;
}
/**
 * The "for organizations" (B2B) pages exist in English and Spanish only: /for-organizations and
 * /es/para-organizaciones (+ /demo). French and Arabic pages link to the English one.
 */
export const ORG_LANGS = ['en', 'es'] as const;
export type OrgLang = (typeof ORG_LANGS)[number];
export const isOrgLang = (v: unknown): v is OrgLang => typeof v === 'string' && (ORG_LANGS as readonly string[]).includes(v);
const ORG_SLUG: Record<OrgLang, string> = { en: 'for-organizations', es: 'para-organizaciones' };
export type OrgPage = '' | 'demo';
export function orgPathFor(lang: OrgLang, page: OrgPage = ''): string {
  const base = lang === 'en' ? `/${ORG_SLUG.en}` : `/${lang}/${ORG_SLUG[lang]}`;
  return page ? `${base}/${page}` : base;
}
/** The organizations page nearest to a language: its own in English/Spanish, the English one otherwise. */
export const orgLangFor = (lang: Lang): OrgLang => (isOrgLang(lang) ? lang : 'en');
export const orgAlternatesFor = (page: OrgPage) => ORG_LANGS.map((l) => ({ lang: l, path: orgPathFor(l, page) }));
export const orgAnchor = (lang: OrgLang, id: string) => `${orgPathFor(lang)}#${id}`;
/** Link-preview image of the organizations pages (public/og-image-org-<lang>.png, from scripts/og-image-org.html). */
export const orgOgImage = (lang: OrgLang) => `/og-image-org-${lang}.png`;

/** Anchor on the home page of a language, e.g. /es/#pricing. */
export const homeAnchor = (lang: Lang, id: string) => `${pathFor(lang)}#${id}`;
export const alternatesFor = (page: '' | 'privacy' | 'terms' | 'support') => LANGS.map((l) => ({ lang: l, path: pathFor(l, page) }));
