import type { OrgLang } from '../languages';
import { enOrg } from './en';
import { esOrg } from './es';
import type { OrgCopy } from './types';

const ORG_COPY: Record<OrgLang, OrgCopy> = { en: enOrg, es: esOrg };
/** Copy of the "for organizations" pages (English and Spanish only). */
export const orgCopy = (lang: OrgLang): OrgCopy => ORG_COPY[lang];
export type { OrgCopy } from './types';
