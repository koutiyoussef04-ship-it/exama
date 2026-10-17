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
/** Anchor on the home page of a language, e.g. /es/#pricing. */
export const homeAnchor = (lang: Lang, id: string) => `${pathFor(lang)}#${id}`;
export const alternatesFor = (page: '' | 'privacy' | 'terms' | 'support') => LANGS.map((l) => ({ lang: l, path: pathFor(l, page) }));
