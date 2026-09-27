/**
 * i18next setup. All user-facing text lives in ./locales (en is the source of truth).
 * The language itself is chosen/persisted by lib/preferences.tsx.
 */
import 'intl-pluralrules'; // Intl.PluralRules polyfill for Hermes (Arabic needs 6 plural forms)
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import { FALLBACK_LANGUAGE, type Language } from './languages';
import { completePlurals } from './plurals';

export const resources = {
  en: { translation: completePlurals(en, 'en') },
  es: { translation: completePlurals(es as typeof en, 'es') },
  fr: { translation: completePlurals(fr as typeof en, 'fr') },
  ar: { translation: completePlurals(ar as typeof en, 'ar') },
} as const;

export function initI18n(lng: Language) {
  if (i18n.isInitialized) return i18n.changeLanguage(lng);
  return i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: { escapeValue: false }, // React Native renders text, not HTML
    returnNull: false,
    react: { useSuspense: false },
  });
}

export default i18n;
