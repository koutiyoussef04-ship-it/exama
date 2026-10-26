/**
 * Real captures of the organization workspace (app.exama.app/org) for the organizations pages — never a mock-up.
 *
 * Files live in public/screenshots/ and are picked up automatically when they exist (.webp, .png or .jpg):
 *   - en, es, ar pages: screenshots/org-review.*, org-queue.*, org-dashboard.*  (the current captures, in Spanish)
 *   - fr pages:         screenshots/fr/org-review-fr.*, org-queue-fr.*, org-dashboard-fr.*  (French captures only)
 *
 * The French page never shows the Spanish captures (verify-build.mjs fails if it does). Until the French files exist
 * the page shows its fallbacks (the workflow diagram in the hero, icon cards in the review section). Expected
 * captures, 1280×800: `org-review-fr` = the review screen of a French course with the highlighted passage and
 * "Correspondance 100 %", `org-queue-fr` = the question list with "Vérifications réussies".
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgLang } from '../i18n';

const EXTENSIONS = ['webp', 'png', 'jpg'] as const;

/** Public URL of the capture `id` for `lang`, or null while the file does not exist. */
export function orgScreenshot(lang: OrgLang, id: string): string | null {
  const dir = lang === 'fr' ? 'screenshots/fr' : 'screenshots';
  const ext = EXTENSIONS.find((e) => existsSync(join(process.cwd(), 'public', dir, `${id}.${e}`)));
  return ext ? `/${dir}/${id}.${ext}` : null;
}

/** The hero capture: the review screen (`org-review`, or `org-review-fr` on the French page). */
export const orgHeroScreenshot = (lang: OrgLang) => orgScreenshot(lang, lang === 'fr' ? 'org-review-fr' : 'org-review');
