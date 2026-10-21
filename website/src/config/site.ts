/**
 * Site-wide constants. One place to change the domain, the app URL or the CTA destinations.
 *
 * Legal and contact details are deliberately `null` until they are confirmed: the site never invents
 * a company name, address or support email. Fill them in before launch — the /privacy, /terms and
 * /support pages pick them up.
 */
import type { Lang } from '../i18n/languages';

const APP_URL = 'https://app.exama.app';

/**
 * True only when the production web app can really sell plans with the 3-day free trial (Stripe web
 * checkout live: STRIPE_ENABLED=true on the API). Build-time setting of THIS site:
 * PUBLIC_WEB_CHECKOUT_AVAILABLE=true. While false (the default), no page promises a trial or web
 * payments: buttons say "Get started free" and lead to sign-up / the plans screen of the app.
 */
const webCheckoutAvailable = import.meta.env.PUBLIC_WEB_CHECKOUT_AVAILABLE === 'true';

/**
 * Links into the app all go through its /start route (apps/mobile/src/app/start.tsx), which works for
 * new and existing accounts alike: signed out it shows sign-up (or sign-in), signed in it continues
 * straight away; after signing up/in it continues to the plans screen when `intent=plans`. `lang`
 * opens the app in the website's language (unless the student already chose one there).
 */
function startUrl(lang: Lang, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, lang });
  return `${APP_URL}/start?${q.toString()}`;
}

const links = {
  /** Create an account (the form links to sign-in for existing accounts). */
  signUp: (lang: Lang) => startUrl(lang, { mode: 'signup' }),
  /** Sign in to an existing account. */
  signIn: (lang: Lang) => startUrl(lang, { mode: 'signin' }),
  /**
   * Sign up or sign in, then the plans screen (with `plan` pre-selected). The trial itself is only
   * offered there, by the server, to eligible accounts — creating an account never starts one.
   */
  plans: (lang: Lang, plan?: 'basic' | 'student' | 'pro') => startUrl(lang, { mode: 'signup', intent: 'plans', ...(plan ? { plan, period: 'monthly' } : {}) }),
  /** The main call to action: plans (with the trial) when web checkout is live, otherwise a free account. */
  primary: (lang: Lang) => (webCheckoutAvailable ? links.plans(lang) : links.signUp(lang)),
  /**
   * Organization sign-up (the B2B pages): the same /start route, with the organization form pre-selected
   * (apps/mobile/src/lib/start-intent.ts, `account=organization`). The 30-day pilot starts with the account;
   * no card, no payment.
   */
  orgSignUp: (lang: Lang) => startUrl(lang, { mode: 'signup', account: 'organization' }),
  /**
   * Organization sign-in (the "Log in" links of the B2B pages): the sign-in form opens on "Organization account", so staff —
   * and the B2B owner — sign in to their organization identity, not to a student account with the same email.
   */
  orgSignIn: (lang: Lang) => startUrl(lang, { mode: 'signin', account: 'organization' }),
};

/**
 * Demo requests from the organizations pages go by email (a mailto link with a pre-filled subject and body,
 * plus the address written out): no form, no backend, no third-party service. Confirmed address.
 */
const B2B_DEMO_EMAIL = 'examaweb@gmail.com';
const demoMailto = (subject: string, body: string) => `mailto:${B2B_DEMO_EMAIL}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`;

export const site = {
  name: 'Exama',
  /** The marketing site. */
  url: 'https://exama.app',
  /** The existing Exama application (apps/mobile web build). */
  appUrl: APP_URL,
  webCheckoutAvailable,
  links,
  b2b: { demoEmail: B2B_DEMO_EMAIL, demoMailto },
  ogImage: { path: '/og-image.png', width: 1200, height: 630 },
  /**
   * Confirmed legal/contact details. `null` = not confirmed yet (never guess). They fill {{company}},
   * {{address}} and {{email}} in the Privacy Policy and Terms (/privacy, /terms) — use the same values as
   * the app's EXPO_PUBLIC_COMPANY_NAME, EXPO_PUBLIC_COMPANY_ADDRESS and EXPO_PUBLIC_SUPPORT_EMAIL.
   */
  legal: {
    supportEmail: null as string | null,
    companyName: null as string | null,
    companyAddress: null as string | null,
  },
} as const;

export type Site = typeof site;

/** Absolute URL for a path on the marketing site. */
export const absoluteUrl = (path = '/') => new URL(path, site.url).toString();
