# Exama marketing website

The public landing site for **https://exama.app**, in English, Spanish, French and Arabic. Its one job: turn
visitors into students of the Exama app. Every button goes to the app's **`/start`** route
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
| Languages | `/` English, `/es/` Spanish, `/fr/` French, `/ar/` Arabic (right-to-left) — plus the legal and support pages in each |
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
| `npm run check:pricing` | Fails if the site's prices/trial length differ from the launch prices **or** from `packages/shared/src/billing.ts` |
| `npm run verify` | After a build, for every language: SEO tags and hreflang, `lang`/`dir`, one `<h1>`, alt text, the language selector, internal links/anchors, the exact app links (sign-up, sign-in, plans), prices, 7 FAQs = structured data, footer, no untranslated English, trial copy only when web checkout is live, no JS bundles, payload size, and **no fabricated social proof**. Run it with the same `PUBLIC_WEB_CHECKOUT_AVAILABLE` as the build |

## Where things live

```
src/config/site.ts       domain, app URL, links into the app (/start), the web-checkout flag, OG image, legal/contact details (null until confirmed)
src/i18n/                languages.ts (languages, URLs, direction), types.ts (the shape of the copy), en.ts / es.ts / fr.ts / ar.ts (ALL page text)
src/data/content.ts      product facts shared by every language: trial length, prices, plan order, section anchors
src/data/legal.ts        Privacy Policy + Terms (en/es/fr/ar) from legal.generated.json — exported from the app, never edited here
src/components/*.astro   one component per page section (Hero, HowItWorks, …), each takes `lang`; Home.astro puts them together
src/layouts/             Base.astro (head/SEO/hreflang/lang+dir), InfoPage.astro (support/404)
src/components/LegalDocument.astro   one legal document in one language (language links, draft notice, hreflang)
src/pages/               index, support, privacy, terms; [lang]/index, [lang]/support, [lang]/privacy, [lang]/terms (es, fr, ar); 404, robots.txt, sitemap.xml
src/styles/global.css    design tokens (the app's palette) + all styles
public/                  favicon, apple-touch-icon, og-image.png, _headers, screenshots/
scripts/                 check-pricing.mjs, verify-build.mjs, og-image.html (source of og-image.png)
```

### Product claims: the app code is the source of truth

Nothing on the site may promise more than the app does. `src/data/content.ts` documents which app file each
claim comes from (`billing.ts`, `features.ts`, `limits.ts`, `materials.ts`, `grounding.ts`, the README's
planner section). When the app changes — a price, a plan feature, a supported format — update
`content.ts` and the four files in `src/i18n/`, then run `npm test`.

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
