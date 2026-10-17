/**
 * Post-build checks on dist/ (run `npm run build` first):  npm run verify
 *
 * Enforces the launch requirements that are easy to break by accident: SEO metadata, one <h1>,
 * alt text, working internal links/anchors, the exact CTA destinations, the required content
 * (pricing, FAQ, footer) in every language (en, es, fr, ar — Arabic right-to-left), zero JavaScript,
 * a small payload — and no fabricated social proof.
 *
 * Checks the build mode too: PUBLIC_WEB_CHECKOUT_AVAILABLE=true (web checkout with the 7-day trial
 * is live) must show the trial; anything else must not promise a trial or web payments anywhere.
 * Run it with the same environment as the build. Node stdlib only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const TRIAL = process.env.PUBLIC_WEB_CHECKOUT_AVAILABLE === 'true';
const APP_URL = 'https://app.exama.app';
/** Every link into the app goes through its /start route (sign-up or sign-in, then continue). */
const start = (lang, params) => `${APP_URL}/start?${new URLSearchParams({ ...params, lang }).toString()}`;
const SIGNUP = (lang) => start(lang, { mode: 'signup' });
const SIGNIN = (lang) => start(lang, { mode: 'signin' });
const PLANS = (lang, plan) => start(lang, { mode: 'signup', intent: 'plans', ...(plan ? { plan, period: 'monthly' } : {}) });
const PRIMARY = (lang) => (TRIAL ? PLANS(lang) : SIGNUP(lang));

const LANGS = ['en', 'es', 'fr', 'ar'];
const homePath = (l) => (l === 'en' ? '/' : `/${l}/`);
const pagePath = (l, page) => (l === 'en' ? `/${page}` : `/${l}/${page}`);
const fileOf = (route) => (route === '/404' ? '404.html' : route === '/' ? 'index.html' : `${route.replace(/^\//, '').replace(/\/$/, '')}/index.html`);

/** What each language must show — written out here independently of src/i18n so a broken translation is caught. */
const EXPECT = {
  en: {
    title: 'Exama — Your AI Exam Coach',
    ctaFree: 'Get started free',
    ctaTrial: 'Start your 7-day free trial',
    choose: (p) => `Choose ${p}`,
    startFree: 'Start free',
    login: 'Log in',
    prices: ['€0', '€9.99', '€79.99', '€14.99', '€119.99', '€24.99', '€199.99'],
    trialWords: /free trial|days free|\btrial\b/i,
    language: 'English',
  },
  es: {
    title: 'Exama — Tu entrenador de exámenes con IA',
    ctaFree: 'Empieza gratis',
    ctaTrial: 'Empieza tu prueba gratuita de 7 días',
    choose: (p) => `Elegir ${p}`,
    startFree: 'Empezar gratis',
    login: 'Iniciar sesión',
    prices: ['0 €', '9,99 €', '79,99 €', '14,99 €', '119,99 €', '24,99 €', '199,99 €'],
    trialWords: /prueba gratuita|días gratis|periodo de prueba/i,
    language: 'Español',
  },
  fr: {
    title: 'Exama — Votre coach d’examen IA',
    ctaFree: 'Commencer gratuitement',
    ctaTrial: 'Commencez votre essai gratuit de 7 jours',
    choose: (p) => `Choisir ${p}`,
    startFree: 'Commencer gratuitement',
    login: 'Se connecter',
    prices: ['0 €', '9,99 €', '79,99 €', '14,99 €', '119,99 €', '24,99 €', '199,99 €'],
    trialWords: /essai gratuit|jours gratuits|période d’essai/i,
    language: 'Français',
  },
  ar: {
    title: 'Exama — مدرّبك للاختبارات بالذكاء الاصطناعي',
    ctaFree: 'ابدأ مجانًا',
    ctaTrial: 'ابدأ تجربتك المجانية لمدة 7 أيام',
    choose: (p) => `اختر ${p}`,
    startFree: 'ابدأ مجانًا',
    login: 'تسجيل الدخول',
    prices: ['0 €', '9.99 €', '79.99 €', '14.99 €', '119.99 €', '24.99 €', '199.99 €'],
    trialWords: /تجربة|تجربتك|التجربة/,
    language: 'العربية',
  },
};
/** English UI strings that must not leak into the translated pages. */
const ENGLISH_LEAKS = ['See how it works', 'Get started free', 'Frequently asked questions', 'Skip to content', 'Recommended', 'How it works', 'Log in', 'Create an account', 'No payment needed'];

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
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const text = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
/** All <a> links of a page: decoded href, visible text and raw attributes. */
const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: decode(attr(m[1], /href="([^"]*)"/) ?? ''), label: text(m[2]).trim(), attrs: m[1] }));

const legal = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'legal.generated.json'), 'utf8'));
const legalPages = legal.languages.flatMap((lang) => ['privacy', 'terms'].map((doc) => ({ doc, lang, route: pagePath(lang, doc), file: fileOf(pagePath(lang, doc)) })));
const homes = LANGS.map((lang) => ({ lang, route: homePath(lang), file: fileOf(homePath(lang)) }));
const supports = LANGS.map((lang) => ({ lang, route: pagePath(lang, 'support'), file: fileOf(pagePath(lang, 'support')) }));
const pages = Object.fromEntries([...homes, ...supports, { route: '/404', file: '404.html' }, ...legalPages].map((p) => [p.route, p.file]));

console.log(`Build mode: ${TRIAL ? 'web checkout live — the 7-day trial is advertised' : 'web checkout NOT live — no trial or web-payment claims'}\n`);
for (const [route, file] of Object.entries(pages)) check(existsSync(join(dist, file)), `page built: ${route}`);

// ---------- Every home page (/, /es/, /fr/, /ar/) ----------
for (const { lang, route, file } of homes) {
  const e = EXPECT[lang];
  const html = read(file);
  const body = text(html);
  const links = anchors(html);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  console.log(`\nHome page ${route} (${lang})`);

  // SEO
  check(attr(html, /<title>([^<]*)<\/title>/) === e.title, `title is "${e.title}"`);
  check(!!attr(html, /<meta name="description" content="([^"]+)"/), 'meta description present');
  check(attr(html, /<link rel="canonical" href="([^"]*)"/) === `https://exama.app${route}`, `canonical is https://exama.app${route}`);
  for (const p of ['og:type', 'og:site_name', 'og:locale', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) {
    check(new RegExp(`<meta property="${p}" content="[^"]+"`).test(html), `Open Graph: ${p}`);
  }
  check(attr(html, /<meta property="og:image" content="([^"]*)"/) === 'https://exama.app/og-image.png', 'og:image is an absolute URL');
  for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) check(new RegExp(`<meta name="${n}" content="[^"]+"`).test(html), `Twitter: ${n}`);
  check(new RegExp(`<html lang="${lang}" dir="${dir}"`).test(html), `<html lang="${lang}" dir="${dir}">`);
  check(
    LANGS.every((l) => html.includes(`<link rel="alternate" hreflang="${l}" href="https://exama.app${homePath(l)}"`)) && html.includes('hreflang="x-default" href="https://exama.app/"'),
    'hreflang alternates for all 4 languages + x-default',
  );
  check(!/name="robots"/.test(html), 'indexable');
  check(/<link rel="icon"[^>]*href="\/favicon\.png"/.test(html), 'favicon linked');

  // Structure & accessibility
  check((html.match(/<h1[ >]/g) ?? []).length === 1, 'exactly one <h1>');
  check(/<main id="main"/.test(html) && /<header/.test(html) && /<footer/.test(html) && /class="skip-link"/.test(html), 'semantic landmarks + skip link');
  const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  check(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1), 'heading levels never skip downward');
  for (const id of ['how-it-works', 'materials', 'pricing', 'faq']) check(new RegExp(`id="${id}"`).test(html), `section #${id}`);

  // Language selector: the other languages' home pages, the current one marked.
  const menuStart = html.indexOf('class="lang-menu"');
  const menu = menuStart < 0 ? '' : html.slice(menuStart, html.indexOf('</details>', menuStart));
  check(new RegExp(`aria-current="page" lang="${lang}">${e.language}<`).test(menu), `language selector marks ${e.language} as current`);
  check(
    LANGS.filter((l) => l !== lang).every((l) => new RegExp(`href="${homePath(l)}" hreflang="${l}" lang="${l}">${EXPECT[l].language}<`).test(menu)),
    'language selector links to the other three home pages',
  );

  // Calls to action (header, mobile menu, hero, final CTA)
  const primaryLabel = TRIAL ? e.ctaTrial : e.ctaFree;
  const primary = links.filter((a) => a.label === primaryLabel && a.href === PRIMARY(lang));
  check(primary.length >= 4, `"${primaryLabel}" → ${PRIMARY(lang)} appears ${primary.length}× (header, menu, hero, final CTA)`);
  check(
    links.filter((a) => a.label === primaryLabel).every((a) => a.href === PRIMARY(lang) || (TRIAL && ['basic', 'student', 'pro'].some((p) => a.href === PLANS(lang, p))) || (!TRIAL && a.href === SIGNUP(lang))),
    `no "${primaryLabel}" link goes anywhere else`,
  );
  check(links.some((a) => a.label === e.login && a.href === SIGNIN(lang)), `"${e.login}" → sign-in for existing accounts`);
  check(/href="#how-it-works"[^>]*>/.test(html), 'secondary CTA → #how-it-works');

  // Pricing: prices, and each plan button's destination and wording.
  for (const price of e.prices) check(body.includes(price), `pricing shows ${price}`);
  const cards = html.split(/(?=<li class="plan[ "])/).slice(1);
  for (const plan of ['free', 'basic', 'student', 'pro']) {
    const card = cards.find((c) => c.includes(`data-plan="${plan}"`)) ?? '';
    const btn = anchors(card).find((a) => /class="btn/.test(a.attrs));
    const name = plan[0].toUpperCase() + plan.slice(1);
    const wantHref = plan === 'free' ? SIGNUP(lang) : PLANS(lang, plan);
    const wantLabel = plan === 'free' ? e.startFree : TRIAL ? e.ctaTrial : e.choose(name);
    check(btn?.href === wantHref && btn?.label === wantLabel, `plan ${plan}: "${wantLabel}" → ${plan === 'free' ? 'sign-up' : `sign-up/sign-in, then the plans screen with ${plan} pre-selected`}`);
  }

  // Trial / web payments: only when checkout is live.
  if (TRIAL) {
    check(e.trialWords.test(body), 'communicates the 7-day free trial');
    check(/Stripe/.test(body), 'says web payments go through Stripe');
  } else {
    const hit = body.match(e.trialWords);
    check(!hit, `no trial promised while web checkout is not live${hit ? ` (found "${hit[0]}")` : ''}`);
    check(!/Stripe|checkout/i.test(body), 'no web-payment (Stripe/checkout) claims while web checkout is not live');
  }

  // FAQ: 7 questions, mirrored exactly in the structured data.
  const questions = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]).trim());
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faqLd = ld.find((d) => d['@type'] === 'FAQPage');
  check(questions.length === 7, `FAQ has 7 questions (${questions.length})`);
  check(faqLd?.inLanguage === lang && faqLd.mainEntity.length === questions.length && faqLd.mainEntity.every((q, i) => q.name === questions[i]), 'FAQPage structured data = the visible questions, in this language');
  check(!ld.some((d) => JSON.stringify(d).match(/aggregateRating|review/i)), 'structured data contains no ratings/reviews');

  // Footer
  const flinks = anchors(html.slice(html.indexOf('<footer'))).map((a) => a.href);
  for (const href of [pagePath(lang, 'privacy'), pagePath(lang, 'terms'), pagePath(lang, 'support'), `${homePath(lang)}#pricing`, `${homePath(lang)}#faq`, SIGNUP(lang), SIGNIN(lang), APP_URL]) {
    check(flinks.includes(href), `footer links to ${href}`);
  }

  if (lang !== 'en') {
    const leaks = ENGLISH_LEAKS.filter((s) => body.includes(s));
    check(leaks.length === 0, `no untranslated English UI text${leaks.length ? ` (found "${leaks[0]}")` : ''}`);
    const strays = links.filter((a) => a.href.startsWith('/') && !a.href.startsWith(`/${lang}/`) && !a.attrs.includes('hreflang'));
    check(strays.length === 0, `internal links stay in /${lang}/ (except the language selector)${strays.length ? ` (found ${strays[0].href})` : ''}`);
    check(links.filter((a) => a.href.startsWith(`${APP_URL}/start?`)).every((a) => a.href.endsWith(`&lang=${lang}`)), `links into the app open it in ${e.language}`);
  }
  if (lang === 'ar') check((html.match(/class="[^"]*flip-rtl/g) ?? []).length >= 2, 'direction arrows are mirrored for right-to-left (flip-rtl)');
  const kb = statSync(join(dist, file)).size / 1024;
  check(kb < 100, `${file} is ${kb.toFixed(1)} KB (< 100 KB)`);
}

// ---------- English copy that must stay exact ----------
console.log('\nEnglish content');
const enHome = read('index.html');
const homeText = text(enHome);
check(homeText.includes('Turn your course material into your personal AI exam coach.'), 'hero headline present (exact)');
for (const f of ['PDF', 'PowerPoint', 'Audio', 'Video']) check(new RegExp(`class="chip"[^>]*>(?:<svg[\\s\\S]*?</svg>)?\\s*${f}`).test(enHome), `hero shows supported format: ${f}`);
const enQuestions = [
  'What can I upload to Exama?',
  'How does Exama create my exams?',
  'Are the questions based on my course material?',
  'Can Exama understand lectures?',
  ...(TRIAL ? ['How does the 7-day free trial work?', 'What happens after the trial?'] : ['Can I use Exama for free?', 'How do I choose a paid plan?']),
  'Is Exama only for PDF files?',
];
for (const q of enQuestions) check(homeText.includes(q), `FAQ: ${q}`);
if (TRIAL) {
  check(/Card required, no payment today/.test(homeText), 'hero: a card is required but nothing is charged today');
  check(homeText.includes('Account → Manage billing'), 'explains where to manage/cancel (Account → Manage billing)');
  check(/start the trial at checkout/.test(homeText), 'FAQ: the trial starts at checkout on the web');
} else {
  check(/No card needed/.test(homeText), 'hero: the free plan needs no card');
}
for (const h of ['How it works', 'Supported material', 'Your material, not generic AI', 'Personalized exams', 'Weak topics', 'Personalized study plan', 'Pricing', 'FAQ']) {
  check(homeText.toLowerCase().includes(h.toLowerCase()), `section present: ${h}`);
}

// ---------- Support and 404 ----------
console.log('\nSupport & 404');
for (const { lang, route, file } of supports) {
  const html = read(file);
  check(/<meta name="robots" content="noindex/.test(html), `${route} is noindex (interim page)`);
  check(new RegExp(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`).test(html), `${route}: lang="${lang}"${lang === 'ar' ? ', right-to-left' : ''}`);
  check(LANGS.every((l) => html.includes(`hreflang="${l}" href="https://exama.app${pagePath(l, 'support')}"`)), `${route}: hreflang links to all 4 languages`);
  check(anchors(html).some((a) => a.href === `${homePath(lang)}#faq`), `${route}: links to the FAQ in the same language`);
}
check(/<meta name="robots" content="noindex/.test(read('404.html')), '/404 is noindex');
check(anchors(read('404.html')).some((a) => a.href === PRIMARY('en')), '/404 links to the app (primary CTA)');

// ---------- Legal pages: the app's own Privacy Policy and Terms, in every language ----------
console.log('\nLegal pages');
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const p of legalPages) {
  const html = read(p.file);
  const body = text(html);
  const d = legal.docs[p.lang][p.doc];
  check(new RegExp(`<html lang="${p.lang}"`).test(html), `${p.route}: <html lang="${p.lang}">`);
  check(/dir="rtl"/.test(html) === (p.lang === 'ar'), `${p.route}: ${p.lang === 'ar' ? 'right-to-left' : 'left-to-right'} text`);
  check(body.includes(d.title), `${p.route}: title "${d.title}"`);
  check(/<meta name="robots" content="noindex/.test(html) === legal.isDraft, `${p.route} is ${legal.isDraft ? 'noindex (draft text)' : 'indexable'}`);
  // Every line of every section, exactly as in the app ({{company}}/{{email}}/{{address}} may be filled by site config).
  const lines = d.sections.flatMap((s) => [s.heading, ...s.body.split('\n').map((l) => l.replace(/^• /, '').trim()).filter(Boolean)]);
  const missingLines = lines.filter((l) => !new RegExp(l.split(/\{\{(?:company|email|address)\}\}/).map(esc).join('.+?')).test(body));
  check(missingLines.length === 0, `${p.route}: all ${d.sections.length} sections match the app text${missingLines.length ? ` (missing: "${missingLines[0].slice(0, 60)}…")` : ''}`);
  check(!html.includes('{{'), `${p.route}: no unfilled {{placeholders}}`);
  check(/class="legal-draft"/.test(html) === legal.isDraft, `${p.route}: draft notice ${legal.isDraft ? 'shown' : 'absent'}`);
  check(legal.languages.every((l) => html.includes(`hreflang="${l}" href="https://exama.app${pagePath(l, p.doc)}"`)), `${p.route}: hreflang links to all ${legal.languages.length} languages`);
  check(body.includes(legal.updated) || /<time datetime="\d{4}-\d{2}-\d{2}"/.test(html), `${p.route}: shows the last-updated date`);
}
const privacyEn = text(read('privacy/index.html'));
check(/aged 13 and over/.test(privacyEn), '/privacy: states the minimum age (13)');
check(/Stripe/.test(privacyEn) && /Stripe/.test(text(read('terms/index.html'))), '/privacy and /terms: disclose Stripe web payments');

// ---------- Sitemap & robots ----------
console.log('\nSitemap');
check(/Sitemap: https:\/\/exama\.app\/sitemap\.xml/.test(read('robots.txt')), 'robots.txt points to the sitemap');
const sitemap = read('sitemap.xml');
check(LANGS.every((l) => sitemap.includes(`<loc>https://exama.app${homePath(l)}</loc>`)), 'sitemap lists the home page in all 4 languages');
check(!/support/.test(sitemap), 'sitemap leaves out the interim support pages');
check(legalPages.every((p) => sitemap.includes(`<loc>https://exama.app${p.route}</loc>`) === !legal.isDraft), `sitemap ${legal.isDraft ? 'leaves out' : 'lists'} the legal pages (${legal.isDraft ? 'draft' : 'final'} text)`);

// ---------- Every page: alt text, no fabricated proof, no JS ----------
console.log('\nIntegrity');
const PROOF = /(trusted by|testimonial|★|\b\d[\d,.]*\s*\+?\s*(students|users|universities|learners|schools|estudiantes|usuarios|étudiants|utilisateurs)\b|\b\d(\.\d)?\s*\/\s*5\b|\brated\b|as seen (in|on)|lorem ipsum|testimonio|témoignage)/i;
for (const [route, file] of Object.entries(pages)) {
  const html = read(file);
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  // The minifier writes alt="" (decorative) as a bare `alt`, so accept `alt`, `alt=""` and `alt="…"`.
  check(imgs.every((i) => /\balt(?=[\s=>])/.test(i)), `${route}: every <img> has an alt attribute (${imgs.length})`);
  const hit = text(html).match(PROOF);
  check(!hit, `${route}: no fabricated social proof${hit ? ` (found "${hit[0]}")` : ''}`);
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  // Allowed: JSON-LD data, and the tiny inline helper that closes the menus after a link is used.
  check(scripts.every((a) => /application\/ld\+json|data-purpose="close-menu"/.test(a)), `${route}: no JavaScript beyond JSON-LD and the menu-close helper`);
}

// ---------- Links ----------
console.log('\nLinks');
const idCache = new Map();
const idsOf = (file) => {
  if (!idCache.has(file)) idCache.set(file, new Set([...read(file).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
  return idCache.get(file);
};
const startRe = /^https:\/\/app\.exama\.app\/start\?mode=(signup|signin)(&intent=plans(&plan=(basic|student|pro)&period=monthly)?)?&lang=(en|es|fr|ar)$/;
let bad = 0;
let badExternal = 0;
for (const [route, file] of Object.entries(pages)) {
  const isLegal = legalPages.some((p) => p.file === file);
  for (const { href } of anchors(read(file))) {
    if (/^(https?:|mailto:)/.test(href)) {
      // Home, support and 404 pages only link out to the app (its home or its /start route).
      if (!isLegal && !href.startsWith('mailto:') && href !== APP_URL && !startRe.test(href)) {
        badExternal++;
        console.error(`  unexpected external link on ${route}: ${href}`);
      }
      continue;
    }
    const [path, hash] = href.split('#');
    const target = path === '' ? file : fileOf(path);
    if (!existsSync(join(dist, target)) || (hash && !idsOf(target).has(hash))) {
      bad++;
      console.error(`  broken link on ${route}: ${href}`);
    }
  }
}
check(bad === 0, 'all internal links and #anchors resolve');
check(badExternal === 0, `outside the legal texts, the only external links are ${APP_URL} and its /start route (sign-up, sign-in, plans)`);

// ---------- Weight & right-to-left styles ----------
console.log('\nPerformance & styles');
const assets = readdirSync(join(dist, '_astro'));
const css = assets.filter((f) => f.endsWith('.css'));
const cssText = css.map((f) => read(join('_astro', f))).join('\n');
const cssKb = css.reduce((n, f) => n + statSync(join(dist, '_astro', f)).size / 1024, 0);
check(cssKb < 50, `CSS is ${cssKb.toFixed(1)} KB (< 50 KB)`);
check(assets.every((f) => !f.endsWith('.js')), 'no JavaScript bundles emitted');
check(/html\[dir=["']?rtl["']?\] \.flip-rtl\{transform:scaleX\(-1\)/.test(cssText), 'CSS mirrors direction arrows in right-to-left pages');
check(/html\[lang=["']?ar["']?\]/.test(cssText) && /\.lang-menu/.test(cssText), 'CSS has the Arabic typography and the language selector');
check(!/(?:margin|padding)-(?:left|right):/.test(cssText) && !/[;{](?:left|right):/.test(cssText), 'CSS uses logical (direction-aware) offsets, margins and paddings');

if (failures) {
  console.error(`\n${failures} verification check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll build verification checks passed (${TRIAL ? 'web checkout live' : 'web checkout not live'}).`);
