/**
 * Post-build checks on dist/ (run `npm run build` first):  npm run verify
 *
 * Enforces the launch requirements that are easy to break by accident: SEO metadata, one <h1>,
 * alt text, working internal links/anchors, the exact CTA destination, the required content
 * (pricing, FAQ, footer), zero JavaScript, a small payload — and no fabricated social proof.
 * Node stdlib only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const APP_URL = 'https://app.exama.app';
/** The app's real sign-up route: where every "Start 7-day free trial" button goes (then plan → Stripe Checkout). */
const SIGNUP_URL = 'https://app.exama.app/sign-up';
const TITLE = 'Exama — Your AI Exam Coach';
const DESCRIPTION = 'Turn your course material into personalized exams, grading, weak-topic practice and a study plan.';

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`✓ ${msg}`);
  else {
    failures++;
    console.error(`✗ ${msg}`);
  }
};
const read = (p) => readFileSync(join(dist, p), 'utf8');
const attr = (html, re) => html.match(re)?.[1];
const text = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');

const pages = { '/': 'index.html', '/privacy': 'privacy/index.html', '/terms': 'terms/index.html', '/support': 'support/index.html', '/404': '404.html' };
for (const [route, file] of Object.entries(pages)) check(existsSync(join(dist, file)), `page built: ${route}`);

const home = read('index.html');
const homeText = text(home);

// ---------- SEO ----------
console.log('\nSEO');
check(attr(home, /<title>([^<]*)<\/title>/) === TITLE, `title is "${TITLE}"`);
check(attr(home, /<meta name="description" content="([^"]*)"/) === DESCRIPTION, 'meta description matches');
check(attr(home, /<link rel="canonical" href="([^"]*)"/) === 'https://exama.app/', 'canonical is https://exama.app/');
for (const p of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) {
  check(new RegExp(`<meta property="${p}" content="[^"]+"`).test(home), `Open Graph: ${p}`);
}
check(attr(home, /<meta property="og:image" content="([^"]*)"/) === 'https://exama.app/og-image.png', 'og:image is an absolute URL');
for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
  check(new RegExp(`<meta name="${n}" content="[^"]+"`).test(home), `Twitter: ${n}`);
}
check(/<html lang="en"/.test(home), '<html lang="en">');
check(/<link rel="icon"[^>]*href="\/favicon\.png"/.test(home), 'favicon linked');
check(existsSync(join(dist, 'favicon.png')) && existsSync(join(dist, 'apple-touch-icon.png')) && existsSync(join(dist, 'og-image.png')), 'favicon, apple-touch-icon and og-image exist');
check(!/name="robots"/.test(home), 'home page is indexable');
for (const r of ['/privacy', '/terms', '/support', '/404']) {
  check(/<meta name="robots" content="noindex/.test(read(pages[r])), `${r} is noindex (interim page)`);
}
const robots = read('robots.txt');
check(/Sitemap: https:\/\/exama\.app\/sitemap\.xml/.test(robots), 'robots.txt points to the sitemap');
check(/<loc>https:\/\/exama\.app\/<\/loc>/.test(read('sitemap.xml')) && !/privacy|terms|support/.test(read('sitemap.xml')), 'sitemap lists only indexable pages');

// ---------- Structure & accessibility ----------
console.log('\nStructure & accessibility');
check((home.match(/<h1[ >]/g) ?? []).length === 1, 'exactly one <h1>');
check(/<main id="main"/.test(home) && /<header/.test(home) && /<footer/.test(home) && /class="skip-link"/.test(home), 'semantic landmarks + skip link');
for (const [route, file] of Object.entries(pages)) {
  const imgs = read(file).match(/<img\b[^>]*>/g) ?? [];
  // The minifier writes alt="" (decorative) as a bare `alt`, so accept `alt`, `alt=""` and `alt="…"`.
  check(imgs.every((i) => /\balt(?=[\s=>])/.test(i)), `${route}: every <img> has an alt attribute (${imgs.length})`);
}
const headingLevels = [...home.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
check(headingLevels.every((l, i) => i === 0 || l <= headingLevels[i - 1] + 1), 'heading levels never skip downward');

// ---------- Conversion ----------
console.log('\nConversion');
const ctaLinks = [...home.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>\s*Start 7-day free trial\s*<\/a>/g)].map((m) => m[1]);
check(ctaLinks.length >= 4, `"Start 7-day free trial" appears ${ctaLinks.length}× (header, hero, pricing, final CTA)`);
check(ctaLinks.every((h) => h === SIGNUP_URL), `every "Start 7-day free trial" link goes to the app's sign-up route ${SIGNUP_URL}`);
check(/href="#how-it-works"[^>]*>\s*See how it works/.test(home), 'secondary CTA "See how it works" → #how-it-works');
check(homeText.includes('Turn your course material into your personal AI exam coach.'), 'hero headline present (exact)');
for (const f of ['PDF', 'PowerPoint', 'Audio', 'Video']) check(new RegExp(`class="chip"[^>]*>(?:<svg[\\s\\S]*?</svg>)?\\s*${f}`).test(home), `hero shows supported format: ${f}`);

// ---------- Required content ----------
console.log('\nContent');
for (const price of ['€0', '€9.99', '€79.99', '€14.99', '€119.99', '€24.99', '€199.99']) check(homeText.includes(price), `pricing shows ${price}`);
check(/7 days free|7-day free trial/.test(homeText), 'communicates the 7-day free trial');
// The trial is now genuinely available on the web (Stripe): the copy must say how it works, honestly.
check(/Card required, no payment today/.test(homeText), 'hero says a card is required but nothing is charged today');
check(homeText.includes('Account → Manage billing'), 'explains where to manage/cancel (Account → Manage billing)');
check(/start the trial at checkout/.test(homeText), 'FAQ: the trial starts at checkout on the web');
check(!/started from the plan screen of the Exama app/.test(homeText) && !/because subscriptions are handled by the App Store/.test(homeText), 'the old "trial only in the mobile app" claim is gone');
for (const q of [
  'What can I upload to Exama?',
  'How does Exama create my exams?',
  'Are the questions based on my course material?',
  'Can Exama understand lectures?',
  'How does the 7-day free trial work?',
  'What happens after the trial?',
  'Is Exama only for PDF files?',
]) check(homeText.includes(q), `FAQ: ${q}`);
for (const h of ['How it works', 'Supported material', 'Your material, not generic AI', 'Personalized exams', 'Weak topics', 'Personalized study plan', 'Pricing', 'FAQ']) {
  check(homeText.toLowerCase().includes(h.toLowerCase()), `section present: ${h}`);
}
const footer = home.slice(home.indexOf('<footer'));
for (const [label, href] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['Support', '/support'], ['Pricing', '/#pricing'], ['FAQ', '/#faq']]) {
  check(new RegExp(`href="${href}"[^>]*>\\s*${label}\\s*<`).test(footer), `footer link: ${label} → ${href}`);
}

// ---------- Integrity: no fabricated proof, no JS ----------
console.log('\nIntegrity');
const PROOF = /(trusted by|testimonial|★|\b\d[\d,.]*\s*\+?\s*(students|users|universities|learners|schools)\b|\b\d(\.\d)?\s*\/\s*5\b|\brated\b|as seen (in|on)|lorem ipsum)/i;
for (const [route, file] of Object.entries(pages)) {
  const hit = text(read(file)).match(PROOF);
  check(!hit, `${route}: no fabricated social proof${hit ? ` (found "${hit[0]}")` : ''}`);
}
for (const [route, file] of Object.entries(pages)) {
  const scripts = [...read(file).matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  // Allowed: JSON-LD data, and the tiny inline helper that closes the mobile menu after a link is used.
  check(scripts.every((a) => /application\/ld\+json|data-purpose="close-menu"/.test(a)), `${route}: no JavaScript beyond JSON-LD and the menu-close helper`);
}
const ld = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
check(ld.some((d) => d['@type'] === 'FAQPage' && d.mainEntity.length === 7), 'FAQPage structured data lists the 7 visible questions');
check(!ld.some((d) => JSON.stringify(d).match(/aggregateRating|review/i)), 'structured data contains no ratings/reviews');

// ---------- Links ----------
console.log('\nLinks');
const idsOf = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const homeIds = idsOf(home);
let bad = 0;
for (const [route, file] of Object.entries(pages)) {
  const html = read(file);
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]*)"/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [path, hash] = href.split('#');
    const target = path === '' || path === '/' ? 'index.html' : join(path.replace(/^\//, ''), 'index.html');
    const exists = existsSync(join(dist, target));
    const hashOk = !hash || (target === 'index.html' ? homeIds.has(hash) : idsOf(read(target)).has(hash));
    if (!exists || !hashOk) {
      bad++;
      console.error(`  broken link on ${route}: ${href}`);
    }
  }
}
check(bad === 0, 'all internal links and #anchors resolve');
const external = new Set([...home.matchAll(/<a\b[^>]*href="(https?:[^"]*)"/g)].map((m) => m[1]));
check([...external].every((u) => u === APP_URL || u === SIGNUP_URL), `the only external links are ${APP_URL} and ${SIGNUP_URL}`);

// ---------- Weight ----------
console.log('\nPerformance');
const kb = (p) => statSync(join(dist, p)).size / 1024;
check(kb('index.html') < 100, `index.html is ${kb('index.html').toFixed(1)} KB (< 100 KB)`);
const css = readdirSync(join(dist, '_astro')).filter((f) => f.endsWith('.css'));
const cssKb = css.reduce((n, f) => n + kb(join('_astro', f)), 0);
check(cssKb < 50, `CSS is ${cssKb.toFixed(1)} KB (< 50 KB)`);
check(readdirSync(join(dist, '_astro')).every((f) => !f.endsWith('.js')), 'no JavaScript bundles emitted');

if (failures) {
  console.error(`\n${failures} verification check(s) failed.`);
  process.exit(1);
}
console.log('\nAll build verification checks passed.');
