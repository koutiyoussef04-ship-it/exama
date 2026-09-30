/**
 * Site-wide constants. One place to change the domain, the app URL or the CTA.
 *
 * Legal and contact details are deliberately `null` until they are confirmed: the site never invents
 * a company name, address or support email. Fill them in (and publish the reviewed Privacy Policy
 * and Terms of Use) before launch — the /privacy, /terms and /support pages pick them up.
 */
export const site = {
  name: 'Exama',
  /** The marketing site. */
  url: 'https://exama.app',
  /** The existing Exama application (apps/mobile web build). */
  appUrl: 'https://app.exama.app',
  title: 'Exama — Your AI Exam Coach',
  description: 'Turn your course material into personalized exams, grading, weak-topic practice and a study plan.',
  headline: 'Turn your course material into your personal AI exam coach.',
  cta: { label: 'Start 7-day free trial', secondaryLabel: 'See how it works' },
  ogImage: { path: '/og-image.png', width: 1200, height: 630, alt: 'Exama — turn your course material into your personal AI exam coach.' },
  /** Confirmed legal/contact details. `null` = not confirmed yet (never guess). */
  legal: {
    supportEmail: null as string | null,
  },
} as const;

export type Site = typeof site;

/** Absolute URL for a path on the marketing site. */
export const absoluteUrl = (path = '/') => new URL(path, site.url).toString();
