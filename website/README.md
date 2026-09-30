# Exama marketing website

The public landing site for **https://exama.app**. Its one job: turn visitors into students who start the
7-day free trial at **https://app.exama.app**.

This is a **separate, static site** next to the Exama app. It does not import, share or modify anything in
`apps/mobile`, `apps/api` or `packages/shared`, and it is deliberately **not** part of the npm workspaces
(`apps/*`, `packages/*`), so installing or building it cannot change the app's dependency tree.

| | |
|---|---|
| Framework | [Astro](https://astro.build) 7 — static output, zero client-side JavaScript framework |
| Styling | one hand-written stylesheet (`src/styles/global.css`), system fonts, no web-font requests |
| Runtime JS | none, except a 10-line inline helper that closes the mobile menu after a link is used |
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
| `npm run verify` | After a build: SEO tags, one `<h1>`, alt text, internal links/anchors, exact CTA destination, required content (pricing, 7 FAQs, footer), no JS bundles, payload size, and **no fabricated social proof** |

## Where things live

```
src/config/site.ts       domain, app URL, CTA label, OG image, legal/contact details (null until confirmed)
src/data/content.ts      ALL copy and product facts: steps, materials, plans & prices, FAQ, footer links
src/components/*.astro   one component per page section (Hero, HowItWorks, Materials, Grounded, Exams, …)
src/layouts/             Base.astro (head/SEO/layout), InfoPage.astro (privacy/terms/support/404)
src/pages/               index, privacy, terms, support, 404, robots.txt, sitemap.xml
src/styles/global.css    design tokens (the app's palette) + all styles
public/                  favicon, apple-touch-icon, og-image.png, _headers, screenshots/
scripts/                 check-pricing.mjs, verify-build.mjs, og-image.html (source of og-image.png)
```

### Product claims: the app code is the source of truth

Nothing on the site may promise more than the app does. `src/data/content.ts` documents which app file each
claim comes from (`billing.ts`, `features.ts`, `limits.ts`, `materials.ts`, `grounding.ts`, the README's
planner section). When the app changes — a price, a plan feature, a supported format — update
`content.ts` and run `npm test`.

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

1. **Privacy Policy and Terms of Use.** The app's versions are still drafts with unresolved company/address
   placeholders (`LEGAL_IS_DRAFT = true` in `apps/mobile/src/i18n/legal.ts`), so `/privacy` and `/terms` are
   honest, `noindex` interim pages. Finish and review the texts, render them on those pages, remove `noindex`
   and add both paths to `src/pages/sitemap.xml.ts`. App Store Connect and Google Play need these URLs live
   (`docs/release/eas-build.md` already points `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` at them).
2. **Support contact.** Set `site.legal.supportEmail` in `src/config/site.ts`; `/support` shows it
   automatically. No company name, address or email is invented anywhere on the site.
3. **Real screenshots** (see above).
4. **Trial start path.** The 7-day trial is started through the App Store / Google Play, and the web app has no
   checkout (`packages/shared/src/billing.ts`, `apps/mobile/src/app/paywall.tsx`). The FAQ explains this
   accurately; decide whether the "Start 7-day free trial" button should stay pointed at `app.exama.app`, or at
   store links once the listings exist.

## Deploy

Any static host works. Create a **separate project** for this site (the app keeps its own deployment):

| Setting | Value |
|---|---|
| Root / base directory | `website` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node | 22 |
| Custom domain | `exama.app` (and `www.exama.app` → redirect to `exama.app`) |

`public/_headers` (security headers, long-lived caching for `/_astro/*`) is read by Cloudflare Pages and
Netlify; on Vercel put the same headers in `vercel.json`. `app.exama.app` must keep pointing at the app's own
deployment — only the apex domain moves to this project.

## Gotcha: the repo's root `tsconfig.json`

The monorepo root has a `tsconfig.json` that extends `expo/tsconfig.base`. Vite 8 can walk up to it and fail the
build with `Tsconfig not found expo/tsconfig.base`. `astro.config.mjs` pins this site's own tsconfig
(`vite.tsconfig`) to prevent that — keep it.
