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
  /** The plan's name in this language (the same as the app's org.plan.name.<id>; check-pricing.mjs compares them). */
  name: string;
  tagline: string;
  /** Feature lines, from the plan's allowances (Centro gets no numbers). */
  features: (limits: OrgLimits | null, perRequest: number) => string[];
  cta: string;
};

export type OrgCopy = {
  meta: { title: string; description: string; demoTitle: string; demoDescription: string; ogAlt: string };
  nav: { how: string; pricing: string; faq: string; students: string; demo: string };
  /**
   * `demo` is the main call to action everywhere (header, hero, final block) — on the French page it asks for the free
   * 2-week pilot; `createAccount` opens the organization sign-up.
   */
  cta: { demo: string; seePricing: string; seeHow: string; createAccount: string };
  hero: {
    eyebrow: string;
    titleStart: string;
    titleHighlight: string;
    lead: string;
    note: string;
    /** Verified facts shown as a strip under the hero (storage, access, review, export). */
    trustAria: string;
    trust: string[];
    /** Alt text of the real review screenshot shown in the hero when public/screenshots/org-review.* exists. */
    shotAlt: string;
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
  /**
   * Optional section for training organizations under a quality framework (the French page: Qualiopi). Only what the
   * référentiel asks and what the workspace demonstrably does; never that Exama certifies anyone or guarantees an
   * audit result. `requirements` quotes the official text; `helps` lists the workspace's facts.
   */
  qualiopi?: {
    eyebrow: string;
    title: string;
    lead: string;
    requirementsTitle: string;
    requirements: { title: string; text: string }[];
    helpsTitle: string;
    helps: { title: string; text: string; icon: string }[];
    note: string;
  };
  /** Optional section listing the export formats (PDF for trainees and trainers, Excel, CSV, Moodle GIFT). */
  exports?: { eyebrow: string; title: string; lead: string; items: { title: string; text: string; icon: string }[]; note: string };
  review: { eyebrow: string; title: string; lead: string; points: string[]; screens: OrgScreen[] };
  team: { eyebrow: string; title: string; lead: string; roles: OrgRole[]; reviewersNote: string; usageTitle: string; usageText: string };
  pricing: {
    eyebrow: string;
    title: string;
    lead: string;
    perMonth: string;
    plusVat: string;
    orYearly: (yearly: string, pct: number) => string;
    custom: string;
    customSub: string;
    plans: Record<OrgPlanId, OrgPlanCopy>;
    /** Badge on the recommended plan (ORG_RECOMMENDED_PLAN). */
    mostChosen: string;
    vatNote: string;
    billingNote: string;
    /**
     * Under the plans. en/es/ar: a pilot can be discussed individually (contact us) — never a plan, a price, a length
     * or a sign-up button. fr: the free 2-week pilot, opened in the organization's name and activated by Exama, with
     * its terms as `points`; still never a plan card and never a self-service start.
     */
    pilotNote: { title: string; text: string; points?: string[]; cta: string };
  };
  /** How an organization gets started: talk to us, agree a plan, create the account, Exama activates the plan. */
  start: { eyebrow: string; title: string; lead: string; steps: Step[]; noPlanTitle: string; noPlan: string[] };
  faq: { eyebrow: string; title: string; items: Faq[] };
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
    /** Optional booking link (site.b2b.bookingUrl, PUBLIC_B2B_BOOKING_URL): shown only when the URL is set. */
    booking?: { title: string; text: string; button: string };
    orTitle: string;
    orText: string;
    back: string;
  };
  footer: { tagline: string; product: string; account: string; how: string; pricing: string; faq: string; demo: string; signup: string; students: string };
};
