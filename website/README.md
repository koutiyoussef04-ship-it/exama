# Exama marketing website

The public landing site for **https://exama.app**, in English, Spanish, French and Arabic. Its job: turn
visitors into students of the Exama app — and, since the organizations pages, send academies and training
centers to the organization workspace (see "For organizations" below). Every button goes to the app's **`/start`** route
(`https://app.exama.app/start?…`), which works for new and existing accounts alike: signed out it shows sign-up
(with a link to sign in) or sign-in; after signing up or in — or straight away when already signed in — it
continues where the button said (the plans screen, with the chosen plan pre-selected, for the pricing buttons).

Whether the site advertises the **3-day free trial** is a build setting, `PUBLIC_WEB_CHECKOUT_AVAILABLE`
(see "Web checkout and the trial" below). It is off by default, because the trial needs live web checkout.

This is a **separate, static site** next to the Exama app. It does not import, share or modify anything in
`apps/mobile`, `apps/api` or `packages/shared`, and it is deliberately **not** part of the npm workspaces
(`apps/*`, `packages/*`), so installing or building it cannot change the app's dependency tree.

| | |
|---|---|
| Framework | [Astro](https://astro.build) 7 — static output, zero client-side JavaScript framework |
| Styling | one hand-written stylesheet (`src/styles/global.css`), system fonts, no web-font requests |
| Runtime JS | none, except a small inline helper that closes the menus after a link is used |
| Languages | `/` English, `/es/` Spanish, `/fr/` French, `/ar/` Arabic (right-to-left) — plus the legal and support pages in each; the organizations pages in all four too |
| Page weight | ~8 KB HTML + ~4 KB CSS (gzipped), plus a few tiny images |

```
exama.app        → this site   (website/)
app.exama.app    → the product (apps/mobile web build) — unchanged
```

## Run it

Requires Node ≥ 22.12 (same as the rest of the repo).

```bash
cd website
npm install
npm run dev        # http://localhost:4321
npm run build      # → dist/
npm run preview    # serve dist/
npm test           # pricing check + typecheck + build + post-build verification
```

| Script | What it does |
|---|---|
| `npm run typecheck` | `astro check` (TypeScript + Astro diagnostics) |
| `npm run check:pricing` | Fails if the site's prices/trial length differ from the launch prices **or** from `packages/shared/src/billing.ts`; same for the organization plans vs `packages/shared/src/organizations.ts` |
| `npm run verify` | After a build, for every language: SEO tags and hreflang, `lang`/`dir`, one `<h1>`, alt text, the language selector, internal links/anchors, the exact app links (sign-up, sign-in, plans), prices, 7 FAQs = structured data, footer, no untranslated English, trial copy only when web checkout is live, no JS bundles, payload size, and **no fabricated social proof**. Run it with the same `PUBLIC_WEB_CHECKOUT_AVAILABLE` as the build |

## Where things live

```
src/config/site.ts       domain, app URL, links into the app (/start), the web-checkout flag, OG image, legal/contact details (null until confirmed), the B2B demo address
src/data/b2b.ts          organization plans (allowances, prices ex-VAT, pilot length) — checked against packages/shared/src/organizations.ts
src/i18n/b2b/            types.ts + en.ts / es.ts / fr.ts / ar.ts: ALL text of the organizations pages
src/components/b2b/      the organizations page (OrgPage.astro = hero, audiences, how, review, team, pricing, pilot, FAQ, final CTA) and the demo page
src/components/AudienceBand.astro   the band under the student hero that points academies to the organizations page
src/i18n/                languages.ts (languages, URLs, direction), types.ts (the shape of the copy), en.ts / es.ts / fr.ts / ar.ts (ALL page text)
src/data/content.ts      product facts shared by every language: trial length, prices, plan order, section anchors
src/data/legal.ts        Privacy Policy + Terms (en/es/fr/ar) from legal.generated.json — exported from the app, never edited here
src/components/*.astro   one component per page section (Hero, HowItWorks, …), each takes `lang`; Home.astro puts them together
src/layouts/             Base.astro (head/SEO/hreflang/lang+dir), InfoPage.astro (support/404)
src/components/LegalDocument.astro   one legal document in one language (language links, draft notice, hreflang)
src/pages/               index, support, privacy, terms; [lang]/index, [lang]/support, [lang]/privacy, [lang]/terms (es, fr, ar); for-organizations/ (index, demo), es/para-organizaciones/, fr/pour-les-organismes/, ar/for-organizations/ (each index, demo); 404, robots.txt, sitemap.xml
src/styles/global.css    design tokens (the app's palette) + all styles
public/                  favicon, apple-touch-icon, og-image.png, _headers, screenshots/
scripts/                 check-pricing.mjs, verify-build.mjs, og-image.html (source of og-image.png)
```

### Product claims: the app code is the source of truth

Nothing on the site may promise more than the app does. `src/data/content.ts` documents which app file each
claim comes from (`billing.ts`, `features.ts`, `limits.ts`, `materials.ts`, `grounding.ts`, the README's
planner section). When the app changes — a price, a plan feature, a supported format — update
`content.ts` and the four files in `src/i18n/`, then run `npm test`.

### For organizations (B2B)

`/for-organizations`, `/es/para-organizaciones`, `/fr/pour-les-organismes` and `/ar/for-organizations` (right to left;
the slug stays ASCII so shared links aren't percent-encoded), each with a `/demo` page, present the organization
workspace — question banks drafted from an organization's own PDF/PowerPoint courses, each draft with its
source, reviewed by the organization's team, exported as Moodle GIFT or CSV — to academies and training
centers, in the same four languages as the student site. Each student home links to the organizations page in its own
language (header link, audience band under the hero, footer link).

- **Facts** come from `src/data/b2b.ts`, which mirrors the app's plan catalog
  (`packages/shared/src/organizations.ts`): pilot 30 days — 5 courses, 150 question drafts and 3 admin/editor
  seats **as totals**; Esencial €149/month · €1,490/year — 10 course uploads and 500 question drafts **per
  calendar month**, 10 seats; Profesional €349/month · €3,490/year — 100 / 2,000 per month, 25 seats; Centro
  custom; reviewers unlimited; at most 20 drafts per request. `npm run check:pricing` fails if any of it drifts
  from the app. Prices are shown **excluding VAT** (`+ VAT` / `+ IVA` and a note).
- **Buttons.** "Start the free 30-day pilot" → `https://app.exama.app/start?mode=signup&account=organization&lang=…`
  (the app's `/start` route opens the sign-up with the organization form pre-selected; the pilot starts with the
  account). Esencial, Profesional and Centro → the demo page. **There is no online checkout**: plans are
  requested by email and activated by Exama; nothing is charged automatically, and the copy says so.
  "Log in" (header, menu, footer) → `…/start?mode=signin&account=organization&lang=…`: the sign-in form opens on
  "Organization account", because the organization identity is separate from a student account with the same email.
- **Demo requests** are a `mailto:` link to the confirmed address in `src/config/site.ts` (`site.b2b.demoEmail`),
  with a pre-filled subject and body, and the address written out. No form, no backend, no third-party widget.
- **Screenshots**: real captures of the workspace only — `public/screenshots/org-review.jpg`, `org-queue.jpg`
  and `org-dashboard.jpg` are genuine captures of app.exama.app/org (the demo organization "Academia Demo Exama",
  whose only course is the Spanish Constitution, arts. 1–55, from the BOE). `org-review` is also the hero image.
  The same captures are used on every language's page (the workspace shown is in Spanish; the alt texts are translated).
  To replace them, drop sharper captures (landscape, about 1280×800, `.webp`, `.png` or `.jpg`) under the same
  names; the build requires all three.
- **Link previews**: `public/og-image-org-{en,es,fr,ar}.png` (from `scripts/og-image-org-{en,es,fr,ar}.html`),
  so links shared by email, LinkedIn or WhatsApp show the organizations headline, not the student one.
- **House rules**, enforced by `npm run verify` on these pages: no customer names, logos, counts, testimonials,
  case studies, statistics, time savings or guarantees; no "buy"/"checkout"; "question drafts", never
  "generations"; monthly wording on the paid plans; the exact app links; English + Spanish hreflang only;
  FAQ = structured data; no tracking scripts.

### Languages

Each language is one file in `src/i18n/` with the same shape (`types.ts`; TypeScript fails the build if a
string is missing). English is at the root, the others under `/es/`, `/fr/`, `/ar/`; each page lists the others
with `hreflang` and the header has a language selector. Arabic pages are `dir="rtl"`: the stylesheet uses
logical properties (`margin-inline-start`, `inset-inline-end`, …) so the layout mirrors by itself, arrows that
point forward carry `flip-rtl`, and Arabic text gets its own font stack and no letter-spacing. Prices are written
the local way from the same euro amounts (`formatEuros`). Links into the app pass `lang`, so the app opens in the
same language unless the student already chose one there.

### Web checkout and the trial

`PUBLIC_WEB_CHECKOUT_AVAILABLE=true` (a build-time variable of this site) says the production web app can
really sell plans with the 3-day free trial (Stripe live, `STRIPE_ENABLED=true` on the API). Only then do the
buttons say "Start your 3-day free trial" and the hero, pricing and FAQ describe the trial and card payment.
Unset (the default) the site makes no trial or web-payment claim: the main button is "Get started free"
(sign-up), paid plans say "Choose Basic/Student/Pro" and lead to sign-up/sign-in and then the app's plans
screen, and the FAQ explains the Free plan and how to choose a plan in the app. Either way the trial is only
ever offered by the app's server to eligible accounts — creating an account never starts one. `npm test`
checks both the copy and the links for whichever mode it is run in:

```bash
npm test                                         # default: no trial claims
PUBLIC_WEB_CHECKOUT_AVAILABLE=true npm test      # web checkout live: trial copy
```

House rules (also enforced by `npm run verify`): no testimonials, user counts, ratings, university or
customer names, partnerships or statistics. The pricing copy uses **list prices in euros**; the stores show
the localized price.

### Real product screenshots

The "Inside Exama" section shows **genuine screenshots of the app only — it never mocks up screens**. Until
screenshots exist it shows icon cards. To add them, save real screenshots (portrait phone captures work best)
into `public/screenshots/` using these names, as `.webp`, `.png` or `.jpg`:

`materials` · `exams` · `results` · `weak-topics` · `planner`

They appear automatically on the next build; no code change needed. (`docs/brand/assets.md` also lists
store screenshots as still needed — the same captures can serve both.)

### Brand assets

`src/assets/brand/logo-mark.png`, `public/favicon.png` and `public/apple-touch-icon.png` are copies/derivatives
of the app's provisional brand files (`apps/mobile/assets/images/`). `docs/brand/assets.md` says to replace the
originals with exports from the source design before the store release — re-copy them here at the same time.
The wordmark is rendered as text, exactly like in the app. `public/og-image.png` is rendered from
`scripts/og-image.html` (instructions inside that file).

## Before launch — what is still needed

1. **Privacy Policy and Terms of Use.** `/privacy` and `/terms` (and `/es`, `/fr`, `/ar` versions) show the
   app's own text, exported by `npm run legal:export -w @study/mobile` (tests fail if the copies differ).
   While `LEGAL_IS_DRAFT = true` in `apps/mobile/src/i18n/legal.ts`, they show a "Draft" notice, stay `noindex`
   and out of the sitemap. To finish: fill `site.legal` (company, address, email), complete the remaining
   `[bracketed]` items with a lawyer (`docs/legal/open-items.md`), set `LEGAL_IS_DRAFT = false` and export
   again — indexing and the sitemap follow automatically. App Store Connect and Google Play need these URLs
   (`docs/release/eas-build.md` points `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` at them).
2. **Support contact.** Set `site.legal.supportEmail` in `src/config/site.ts`; `/support` shows it
   automatically. No company name, address or email is invented anywhere on the site.
3. **Real screenshots** (see above).
4. **The trial only when web billing is live.** Build with `PUBLIC_WEB_CHECKOUT_AVAILABLE=true` only after Stripe
   is configured in production (`STRIPE_ENABLED=true`, Prices, webhook, Customer Portal —
   `docs/stripe/stripe-web-billing.md`) and the flow has been tried end to end in Stripe test mode. Until then
   leave it unset: the site is accurate without it.
5. **The app's `/start` route must be deployed** (`apps/mobile/src/app/start.tsx`) before this site goes live,
   or its buttons land on the app's "not found" screen.

## Deploy

Any static host works. Create a **separate project** for this site (the app keeps its own deployment):

| Setting | Value |
|---|---|
| Root / base directory | `website` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node | 22 |
| Environment | `PUBLIC_WEB_CHECKOUT_AVAILABLE=true` only once web checkout is live (see above); otherwise leave unset |
| Custom domain | `exama.app` (and `www.exama.app` → redirect to `exama.app`) |

`public/_headers` (security headers, long-lived caching for `/_astro/*`) is read by Cloudflare Pages and
Netlify; on Vercel put the same headers in `vercel.json`. `app.exama.app` must keep pointing at the app's own
deployment — only the apex domain moves to this project.

## Gotcha: the repo's root `tsconfig.json`

The monorepo root has a `tsconfig.json` that extends `expo/tsconfig.base`. Vite 8 can walk up to it and fail the
build with `Tsconfig not found expo/tsconfig.base`. `astro.config.mjs` pins this site's own tsconfig
(`vite.tsconfig`) to prevent that — keep it.
