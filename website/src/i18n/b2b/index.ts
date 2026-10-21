import type { OrgLang } from '../languages';
import { arOrg } from './ar';
import { enOrg } from './en';
import { esOrg } from './es';
import { frOrg } from './fr';
import type { OrgCopy } from './types';

const ORG_COPY: Record<OrgLang, OrgCopy> = { en: enOrg, es: esOrg, fr: frOrg, ar: arOrg };
/** Copy of the "for organizations" pages (English, Spanish, French, Arabic). */
export const orgCopy = (lang: OrgLang): OrgCopy => ORG_COPY[lang];
export type { OrgCopy } from './types';
