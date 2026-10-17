/**
 * The shape of the website's copy in one language (src/i18n/en.ts, es.ts, fr.ts, ar.ts).
 * Strings that depend on whether the web checkout (with its 7-day trial) is live come in pairs:
 * `…Trial` is only used when it is (site.webCheckoutAvailable), `…Free` otherwise.
 */
import type { PlanId } from '../data/content';

export type Step = { title: string; text: string; icon: string };
export type MaterialType = { name: string; icon: string; formats: string; text: string };
export type ProductArea = { id: string; title: string; text: string; icon: string; alt: string };
export type PlanFeature = { text: string; off?: boolean };
export type Faq = { q: string; a: string[] };
export type PriceLine = { monthly: string; yearly: string; savingPct: number };

export type Copy = {
  meta: { title: string; description: string; ogAlt: string };
  ui: { skip: string; menu: string; homeAria: string; language: string; primaryNav: string; mobileNav: string };
  nav: { how: string; materials: string; pricing: string; faq: string; login: string };
  cta: { trial: (days: number) => string; free: string; secondary: string; choose: (plan: string) => string; startFree: string };
  hero: {
    eyebrow: string;
    titleStart: string;
    titleHighlight: string;
    lead: string;
    noteTrial: (days: number) => string;
    noteFree: string;
    formatsAria: string;
    formats: { pdf: string; slides: string; audio: string; video: string };
    outputs: [string, string, string, string];
    flowAria: string;
    flowIn: string;
    flowCore: string;
    flowCoreSub: string;
    flowOut: string;
  };
  how: { eyebrow: string; title: string; steps: Step[] };
  materials: { eyebrow: string; title: string; lead: string; items: MaterialType[]; fineTrial: string; fineFree: string };
  grounded: {
    eyebrow: string;
    title: string;
    lead: string;
    points: string[];
    disclaimer: string;
    contrastAria: string;
    genericLabel: string;
    genericText: string;
    examaLabel: string;
    examaText: string;
    sourceNote: string;
  };
  exams: { eyebrow: string; title: string; lead: string; pipelineAria: string; steps: string[]; details: Step[] };
  weak: { eyebrow: string; title: string; lead: string; loopAria: string; steps: string[]; back: string; fineTrial: string; fineFree: string };
  plan: { eyebrow: string; title: string; lead: string; inputsTitle: string; inputs: Step[]; outputsTitle: string; outputs: string[]; fineTrial: string; fineFree: string };
  product: { eyebrow: string; title: string; lead: string; areas: ProductArea[] };
  pricing: {
    eyebrow: string;
    titleTrial: (days: number) => string;
    titleFree: string;
    leadTrial: (days: number) => string;
    leadFree: string;
    recommended: string;
    perMonth: string;
    orYearly: (yearly: string, pct: number) => string;
    zero: string;
    noPayment: string;
    plans: Record<PlanId, { name: string; tagline: string; features: PlanFeature[] }>;
    fineTrial: (days: number) => string;
    fineFree: string;
  };
  faq: { eyebrow: string; title: string; items: (trial: boolean, days: number) => Faq[] };
  final: { title: string; text: string; noteTrial: (days: number) => string; noteFree: string };
  footer: {
    tagline: string;
    openApp: string;
    product: string;
    legalHelp: string;
    account: string;
    links: { how: string; materials: string; pricing: string; faq: string; privacy: string; terms: string; support: string; login: string; signup: string };
  };
  support: { title: string; description: string; intro: string; openApp: string; emailLead: string; noEmail: string; faqLead: string; faqLink: string; back: string };
};
