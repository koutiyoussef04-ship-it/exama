import 'i18next';
import type en from './locales/en';

// Compile-time checking of translation keys: t('course.startExam', { count }) etc.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
