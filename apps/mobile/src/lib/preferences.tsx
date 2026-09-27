/**
 * Language preferences, stored on the device:
 *  - app language: the UI (default: the device language when supported, else English)
 *  - study language: what the AI writes in (default: same as the app language)
 * Changing the app language re-renders instantly; switching to/from Arabic restarts the app on
 * iOS/Android so the whole layout can mirror.
 */
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import i18n, { initI18n } from '@/i18n';
import { applyDirection } from '@/i18n/direction';
import { changesDirection, resolveAiLanguage, type AiLanguage, type AiLanguagePref, type Language } from '@/i18n/languages';
import { loadLanguagePrefs, saveAiLanguagePref, saveAppLanguage } from '@/i18n/prefs-store';
import { confirm } from './confirm';
import { kv } from './storage';

type Preferences = {
  ready: boolean;
  appLanguage: Language;
  aiLanguagePref: AiLanguagePref;
  /** What to send to the API. */
  aiLanguage: AiLanguage;
  setAppLanguage: (lang: Language) => Promise<void>;
  setAiLanguagePref: (pref: AiLanguagePref) => Promise<void>;
};

const Ctx = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [appLanguage, setLang] = useState<Language>('en');
  const [aiLanguagePref, setAiPref] = useState<AiLanguagePref>('app');

  useEffect(() => {
    (async () => {
      const { appLanguage: lang, aiLanguagePref: pref } = await loadLanguagePrefs(
        kv,
        getLocales().map((l) => l.languageCode),
      );
      await initI18n(lang);
      setLang(lang);
      setAiPref(pref);
      // Restarts once if the native layout direction doesn't match the language yet.
      if (await applyDirection(lang, { reload: true })) return;
      setReady(true);
    })();
  }, []);

  const setAppLanguage = useCallback(
    async (lang: Language) => {
      if (lang === appLanguage) return;
      const restart = Platform.OS !== 'web' && changesDirection(appLanguage, lang);
      if (restart) {
        // Ask in the language being switched to, so the user can read it.
        const t = i18n.getFixedT(lang);
        const ok = await confirm({
          title: t('language.restartTitle'),
          message: t('language.restartMessage'),
          confirmText: t('language.restartConfirm'),
          cancelText: t('common.cancel'),
        });
        if (!ok) return;
      }
      await saveAppLanguage(kv, lang);
      await i18n.changeLanguage(lang);
      setLang(lang);
      await applyDirection(lang, { reload: restart });
    },
    [appLanguage],
  );

  const setAiLanguagePref = useCallback(async (pref: AiLanguagePref) => {
    setAiPref(pref);
    await saveAiLanguagePref(kv, pref);
  }, []);

  const value = useMemo<Preferences>(
    () => ({
      ready,
      appLanguage,
      aiLanguagePref,
      aiLanguage: resolveAiLanguage(aiLanguagePref, appLanguage),
      setAppLanguage,
      setAiLanguagePref,
    }),
    [ready, appLanguage, aiLanguagePref, setAppLanguage, setAiLanguagePref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
