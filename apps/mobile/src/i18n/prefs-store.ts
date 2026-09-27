/**
 * Persistence of language preferences — pure (storage is injected), unit-tested.
 * The app passes the device key-value store (lib/storage.ts); tests pass an in-memory map.
 */
import { isAiLanguagePref, resolveInitialLanguage, type AiLanguagePref, type Language } from './languages';

export type KeyValueStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

export const APP_LANGUAGE_KEY = 'app_language';
export const AI_LANGUAGE_KEY = 'ai_language';

export async function loadLanguagePrefs(store: KeyValueStore, deviceLanguageCodes: readonly (string | null | undefined)[]) {
  const [saved, savedAi] = await Promise.all([store.get(APP_LANGUAGE_KEY), store.get(AI_LANGUAGE_KEY)]);
  const appLanguage: Language = resolveInitialLanguage(saved, deviceLanguageCodes);
  const aiLanguagePref: AiLanguagePref = isAiLanguagePref(savedAi) ? savedAi : 'app';
  return { appLanguage, aiLanguagePref };
}

export const saveAppLanguage = (store: KeyValueStore, lang: Language) => store.set(APP_LANGUAGE_KEY, lang);
export const saveAiLanguagePref = (store: KeyValueStore, pref: AiLanguagePref) => store.set(AI_LANGUAGE_KEY, pref);
