# Deploying Exama Web to production (Render + Cloudflare DNS)

Goal: Exama Web live and testable by real users. Stripe is deliberately **off** at first.

```
api.exama.app   → exama-api        Render web service (Node) + persistent disk (/var/data) + Render Postgres
app.exama.app   → exama-app        Render static site (the Expo web build)
exama.app       → exama-marketing  Render static site — attach LAST (see step 8)
```

Everything is described in [`render.yaml`](../../render.yaml). **No secret is stored in the repo.**

## What it costs (approx., check Render's pricing page)

API web service 0.5 CPU / 512 MB ≈ $7/mo · disk 10 GB ≈ $2.50/mo · Postgres 256 MB ≈ $6/mo · static sites free
→ about **$15–16/month**, plus pay-as-you-go use of Anthropic, AssemblyAI and Resend. If the API runs out of
memory, raise `plan` for `exama-api` (e.g. `1c-2g`).

## Accounts you need (you create them; nobody can do this for you)

1. **GitHub** — the repo must contain this `render.yaml` on the branch you deploy (`main`).
2. **Render** — https://render.com (add a payment method).
3. **Cloudflare** — already manages `exama.app` DNS.
4. **Resend** — https://resend.com, with `exama.app` added and verified as a sending domain.
5. **Anthropic** — API key from https://console.anthropic.com (billing enabled).
6. **AssemblyAI** — API key from https://www.assemblyai.com (EU key if you want EU processing; then also set `ASSEMBLYAI_BASE_URL=https://api.eu.assemblyai.com`).

## Secrets: what to enter and where

Enter these **only** in the Render dashboard (the Blueprint form asks for them; later: service → *Environment*).
Never paste them in chat, in the repo, or in a `.env` that is committed.

| Variable | Service | Where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | exama-api | Anthropic Console → API keys (`sk-ant-…`) |
| `ASSEMBLYAI_API_KEY` | exama-api | AssemblyAI dashboard → API key |
| `RESEND_API_KEY` | exama-api | Resend → API Keys (sending access is enough) |

Created automatically by Render (you never see or type them): `JWT_SECRET` (random), `DATABASE_URL` (private connection to the database).

Optional, add later in *Environment* (then Render redeploys):

| Variable | Service | Why |
|---|---|---|
| `OWNER_EMAILS` | exama-api | Your own email: full access for testing every feature without a plan (server-side only). |
| `ANTHROPIC_WORKSPACE_ID` | exama-api | Only if Anthropic's error says the key needs a workspace id. |
| `EXPO_PUBLIC_COMPANY_NAME`, `EXPO_PUBLIC_COMPANY_ADDRESS`, `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL` | exama-app | Real business details for the in-app legal/support screens. Until set, those screens show `[placeholders]`. These are **your real details** — they are not invented anywhere. After changing them, redeploy `exama-app` (they are baked in at build time). |

## Steps

### 1. Put `render.yaml` on GitHub
Commit `render.yaml`, `docs/deploy/web-production.md`, and the two `package.json` script additions to `main` and push. (Scripts added: `start:prod` and `db:migrate:prod` in `apps/api`, `build:web` in `apps/mobile`.)

### 2. Resend: verify the sending domain (needed for password-reset emails)
Resend → Domains → Add `exama.app`. Resend shows DNS records (SPF/DKIM). Add them in **Cloudflare → DNS** exactly as shown (all **DNS only / grey cloud**). Wait until Resend says *Verified*. Without this, reset emails are rejected. The API sends from `Exama <no-reply@exama.app>` (change `EMAIL_FROM` in `render.yaml` or the dashboard if you prefer another sender on the verified domain).

### 3. Render: create the Blueprint
Render dashboard → **New → Blueprint** → connect the GitHub repo → branch `main` → it reads `render.yaml`. Render asks for the three secrets above. Click **Apply**. Render creates the database, the API (runs migrations automatically before it starts), and the three sites.

First build takes several minutes. The API deploy is healthy when `https://exama-api-….onrender.com/health` answers `{"ok":true,…}`.

### 4. Custom domains + DNS (Cloudflare)
In Render: *exama-api* → Settings → Custom Domains shows `api.exama.app`; *exama-app* shows `app.exama.app`. Render tells you the target (`<service>.onrender.com`). In **Cloudflare → DNS** add:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `api` | `exama-api-….onrender.com` | **DNS only** (grey cloud) |
| CNAME | `app` | `exama-app-….onrender.com` | **DNS only** (grey cloud) |

Back in Render click **Verify**. HTTPS certificates are issued automatically (a few minutes). Keep both records on *DNS only* at first: it avoids double-proxy/SSL surprises. (If you later turn the orange cloud on, set Cloudflare SSL/TLS mode to **Full (strict)**.)

### 5. Smoke test
- `https://api.exama.app/health` → `{"ok":true,"ai":{"provider":"anthropic",…}}`
- `https://app.exama.app` → the sign-in screen (no "configuration error" screen).
- Browser console on `app.exama.app`: no CORS errors when you try to sign up.

### 6. Full production flow (you or Claude, with a test account)
sign-up → sign-in → forgot password (a real email must arrive) → upload a PDF → wait for AI processing → generate an exam → answer + grade → weak topics / practice → study planner. For features gated by plan, add your email to `OWNER_EMAILS` first (otherwise the Free plan's limits apply).

### 7. Stripe (separate, after step 6 passes)
Stripe Dashboard (live mode): create the 6 Prices, a webhook endpoint `https://api.exama.app/billing/stripe/webhook`, enable the Customer Portal. Then set on `exama-api`: `STRIPE_ENABLED=true`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the six `STRIPE_*_PRICE_ID`, `STRIPE_SUCCESS_URL=https://app.exama.app/checkout?status=success`, `STRIPE_CANCEL_URL=https://app.exama.app/checkout?status=cancel`, `STRIPE_PORTAL_RETURN_URL=https://app.exama.app/account`. See `docs/stripe/stripe-web-billing.md` (on the Stripe branch) for the exact procedure and test-mode run-through first.

### 8. Marketing site `exama.app` (attach last)
`website/README.md` says: do not publish before Stripe works, because "Start 7-day free trial" leads to a Stripe checkout. When Stripe is verified: *exama-marketing* → Custom Domains → `exama.app` → in Cloudflare add a **CNAME** `@` → `exama-marketing-….onrender.com` (Cloudflare flattens it at the apex; DNS only), and let Render redirect `www`. Also fill `site.legal.supportEmail` in `website/src/config/site.ts` and publish reviewed Privacy/Terms first.

## Operations

- **Deploys:** auto-deploy is off. Push to `main`, then *Manual Deploy → Deploy latest commit* on the service (API runs pending migrations first; a failed migration blocks the release and the old version keeps running).
- **Rollback:** each service → *Events/Deploys* → roll back to a previous deploy. Database migrations are not undone automatically.
- **Uploads** live on the API's disk (`/var/data/storage`); the API must stay a **single instance**. Render keeps daily disk snapshots (confirm in the dashboard) and backups for paid Postgres.
- **Logs:** service → *Logs*. Password-reset email failures appear as `[password-reset] email failed`.

## Known limits at launch (not blockers)

- One API instance + local disk: fine for the first users; move uploads to object storage before scaling out.
- The per-IP rate limiters trust the first `X-Forwarded-For` value. Behind Render that value can be supplied by the caller, so IP limits are weaker than they look. Per-account limits (e.g. the 15-minute reset-code cooldown) are unaffected. Worth hardening before heavy public traffic.
- Rate limiters and the unknown-email reset cooldown are in memory (reset on restart).
