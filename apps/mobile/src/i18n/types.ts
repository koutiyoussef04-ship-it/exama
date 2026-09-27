import type { Translation } from './locales/en';

/**
 * A locale must provide every key of the English dictionary (as strings). Extra keys are allowed
 * only for plural forms (e.g. Arabic `_zero`, `_two`, `_few`, `_many`) — test/i18n.test.ts
 * verifies there are no other extras and that placeholders match.
 */
export type LocaleDict<T = Translation> = { [K in keyof T]: T[K] extends string ? string : LocaleDict<T[K]> } & Record<string, unknown>;
