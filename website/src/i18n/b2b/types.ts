/**
 * The shape of the "for organizations" (B2B) pages' copy, in one language (src/i18n/b2b/en.ts, es.ts).
 * Numbers (allowances, prices, days) are passed in from src/data/b2b.ts so the words never carry a figure of
 * their own — the build checks the data against the app, not the prose.
 */
import type { OrgLimits, OrgPlanId } from '../../data/b2b';
import type { Faq, Step } from '../types';

export type OrgAudience = { title: string; text: string; icon: string; points: string[] };
export type OrgScreen = { id: string; title: string; text: string; icon: string; alt: string };
export type OrgRole = { name: string; text: string };
export type OrgPlanCopy = {
  name: string;
  tagline: string;
  /** Feature lines, from the plan's allowances (Centro gets no numbers). */
  features: (limits: OrgLimits | null, perRequest: number) => string[];
  cta: string;
};

export type OrgCopy = {
  meta: { title: string; description: string; demoTitle: string; demoDescription: string };
  nav: { how: string; pricing: string; faq: string; students: string; demo: string };
  /** `pilotShort`: the header button (little room); `pilot` everywhere else. */
  cta: { pilot: (days: number) => string; pilotShort: string; demo: string; seeHow: string };
  hero: {
    eyebrow: string;
    titleStart: string;
    titleHighlight: string;
    lead: string;
    note: (days: number) => string;
    chipsAria: string;
    chips: string[];
    flowAria: string;
    flowIn: string;
    inputs: string[];
    flowCore: string;
    flowCoreSub: string;
    flowOut: string;
    outputs: string[];
  };
  audiences: { eyebrow: string; title: string; lead: string; items: OrgAudience[] };
  how: { eyebrow: string; title: string; lead: string; steps: Step[] };
  review: { eyebrow: string; title: string; lead: string; points: string[]; screens: OrgScreen[] };
  team: { eyebrow: string; title: string; lead: string; roles: OrgRole[]; reviewersNote: string; usageTitle: string; usageText: string };
  pricing: {
    eyebrow: string;
    title: string;
    lead: string;
    perMonth: string;
    plusVat: string;
    orYearly: (yearly: string, pct: number) => string;
    pilotPrice: string;
    pilotDuration: (days: number) => string;
    custom: string;
    customSub: string;
    plans: Record<OrgPlanId, OrgPlanCopy>;
    vatNote: string;
    billingNote: string;
  };
  pilot: { eyebrow: string; title: (days: number) => string; lead: string; includes: (limits: OrgLimits, perRequest: number) => string[]; afterTitle: string; after: string[] };
  faq: { eyebrow: string; title: string; items: (days: number) => Faq[] };
  final: { title: string; text: string; note: string };
  demo: {
    title: string;
    intro: string;
    includeTitle: string;
    include: string[];
    emailButton: string;
    emailHow: string;
    addressLead: string;
    subject: string;
    body: string;
    replyNote: string;
    orTitle: string;
    orText: (days: number) => string;
    back: string;
  };
  footer: { heading: string; overview: string; pricing: string; demo: string };
};
