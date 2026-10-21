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
 * The "for organizations" (B2B) pages, in the same four languages as the rest of the site (+ /demo):
 * /for-organizations, /es/para-organizaciones, /fr/pour-les-organismes, /ar/for-organizations. The Arabic slug stays
 * ASCII so shared links never turn into percent-encoded text.
 */
export const ORG_LANGS = ['en', 'es', 'fr', 'ar'] as const;
export type OrgLang = (typeof ORG_LANGS)[number];
export const isOrgLang = (v: unknown): v is OrgLang => typeof v === 'string' && (ORG_LANGS as readonly string[]).includes(v);
const ORG_SLUG: Record<OrgLang, string> = { en: 'for-organizations', es: 'para-organizaciones', fr: 'pour-les-organismes', ar: 'for-organizations' };
export type OrgPage = '' | 'demo';
export function orgPathFor(lang: OrgLang, page: OrgPage = ''): string {
  const base = lang === 'en' ? `/${ORG_SLUG.en}` : `/${lang}/${ORG_SLUG[lang]}`;
  return page ? `${base}/${page}` : base;
}
/** The organizations page of a language (every language has its own now; kept for callers typed with Lang). */
export const orgLangFor = (lang: Lang): OrgLang => (isOrgLang(lang) ? lang : 'en');
export const orgAlternatesFor = (page: OrgPage) => ORG_LANGS.map((l) => ({ lang: l, path: orgPathFor(l, page) }));
export const orgAnchor = (lang: OrgLang, id: string) => `${orgPathFor(lang)}#${id}`;
/** Link-preview image of the organizations pages (public/og-image-org-<lang>.png, from scripts/og-image-org.html). */
export const orgOgImage = (lang: OrgLang) => `/og-image-org-${lang}.png`;

/**
 * The "for students" landing page, in every language: /for-students, /es/para-estudiantes, /fr/pour-les-etudiants,
 * /ar/for-students (ASCII slug, like the organizations page). The home page stays the general entrance with the
 * two audience choices; this page is the student-only one.
 */
const STUDENT_SLUG: Record<Lang, string> = { en: 'for-students', es: 'para-estudiantes', fr: 'pour-les-etudiants', ar: 'for-students' };
export const studentPathFor = (lang: Lang): string => (lang === 'en' ? `/${STUDENT_SLUG.en}` : `/${lang}/${STUDENT_SLUG[lang]}`);
export const studentAlternates = () => LANGS.map((l) => ({ lang: l, path: studentPathFor(l) }));
export const studentAnchor = (lang: Lang, id: string) => `${studentPathFor(lang)}#${id}`;

/** Anchor on the home page of a language, e.g. /es/#pricing. */
export const homeAnchor = (lang: Lang, id: string) => `${pathFor(lang)}#${id}`;
export const alternatesFor = (page: '' | 'privacy' | 'terms' | 'support') => LANGS.map((l) => ({ lang: l, path: pathFor(l, page) }));
