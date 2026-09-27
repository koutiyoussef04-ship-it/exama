/**
 * Language helpers for the AI layer. Output languages are ISO 639-1 codes; "source" means
 * "write in the same language as the course material".
 */
import type { AiLanguage } from '@study/shared';

const NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish (español)',
  fr: 'French (français)',
  ar: 'Modern Standard Arabic (العربية)',
};

/** Human-readable language name for prompts, e.g. "fr" → "French (français)". */
export function languageName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Accepts plausible ISO 639-1/-2 codes (optionally with a region) from the model; anything else → null. */
export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().toLowerCase().match(/^([a-z]{2,3})(?:[-_][a-z]{2})?$/);
  return m ? m[1] : null;
}

/** Concrete output language for an AI request. */
export function resolveOutputLanguage(requested: AiLanguage | string | null | undefined, sourceLanguage: string | null, fallback = 'en'): string {
  if (!requested) return fallback;
  if (requested === 'source') return sourceLanguage ?? fallback;
  return requested;
}
