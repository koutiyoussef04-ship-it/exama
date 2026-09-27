import { z } from 'zod';

/** Languages the app UI and the AI tutor support at launch. */
export const LANGUAGES = ['en', 'es', 'fr', 'ar'] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;
export const RTL_LANGUAGES: readonly Language[] = ['ar'];
export const isRtlLanguage = (lang: string | null | undefined) => !!lang && (RTL_LANGUAGES as readonly string[]).includes(lang);

/**
 * Language the AI writes in (summaries, exams, practice, feedback): a concrete language,
 * or "source" = the language of the uploaded course material.
 */
export const AI_LANGUAGES = [...LANGUAGES, 'source'] as const;
export const aiLanguageSchema = z.enum(AI_LANGUAGES);
export type AiLanguage = z.infer<typeof aiLanguageSchema>;

