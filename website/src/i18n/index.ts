import { ar } from './ar';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import type { Lang } from './languages';
import type { Copy } from './types';

const COPY: Record<Lang, Copy> = { en, es, fr, ar };
export const copy = (lang: Lang): Copy => COPY[lang];
export * from './languages';
export type { Copy } from './types';
