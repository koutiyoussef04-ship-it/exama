/**
 * Language rules — pure functions (no React Native), unit-tested in test/i18n.test.ts.
 */
import { LANGUAGES, isRtlLanguage, type AiLanguage, type Language } from '@study/shared';

export { LANGUAGES, isRtlLanguage };
export type { AiLanguage, Language };

/** Native names, shown the same in every UI language so people can find their own. */
export const NATIVE_NAMES: Record<Language, string> = { en: 'English', es: 'Español', fr: 'Français', ar: 'العربية' };

export const FALLBACK_LANGUAGE: Language = 'en';

export const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);

/** Study-language preference: "app" follows the app language; "source" = same as the course material. */
export type AiLanguagePref = 'app' | AiLanguage;
export const AI_LANGUAGE_PREFS: readonly AiLanguagePref[] = ['app', ...LANGUAGES, 'source'];
export const isAiLanguagePref = (v: unknown): v is AiLanguagePref => typeof v === 'string' && (AI_LANGUAGE_PREFS as readonly string[]).includes(v);

/**
 * App language at launch: the saved choice, else the first supported device language
 * (in the user's order of preference), else English.
 */
export function resolveInitialLanguage(saved: unknown, deviceLanguageCodes: readonly (string | null | undefined)[]): Language {
  if (isLanguage(saved)) return saved;
  for (const code of deviceLanguageCodes) {
    const base = code?.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return FALLBACK_LANGUAGE;
}

/** What the API receives for AI output: a concrete language or "source". */
export function resolveAiLanguage(pref: AiLanguagePref, appLanguage: Language): AiLanguage {
  return pref === 'app' ? appLanguage : pref;
}

/** Locale for dates/numbers. Arabic uses Western digits to match scores, prices and percentages. */
export function formattingLocale(lang: Language): string {
  return lang === 'ar' ? 'ar-u-nu-latn' : lang;
}

/** Whether switching from one language to another flips the layout direction (needs an app restart on native). */
export const changesDirection = (from: Language, to: Language) => isRtlLanguage(from) !== isRtlLanguage(to);
