# Owner admin dashboard (internal)

A read-only dashboard for the account owner, in the app at **Account → Admin dashboard** (route `/admin`).
It is backed by `GET /admin/*` on the API. The UI is English-only and internal.

## Access and security

- **Server-side authorization on every endpoint.** `apps/api/src/routes/admin.ts` runs `requireAuth` and then `requireOwner`.
  - `requireOwner` uses `isOwner()`, the same `OWNER_USER_IDS` / `OWNER_EMAILS` server configuration as owner access.
  - No client role or hidden URL grants anything.
  - Everyone else gets **403**, including on `/admin/access`. That endpoint is what the app asks before it shows the Account entry or the screen.
- **Read-only.** There are no write endpoints: no deletion, cancellation, refunds or entitlement changes.
- **Audit.** Every request, allowed or refused, writes a row to `admin_audit_log`. A row holds:
  - the actor, the endpoint, the customer id viewed, and allowed/status;
  - only the known filter parameters (each cut to 100 characters). The search text is stored only as its length.
- **Rate limit.** 300 requests per 5 minutes per owner.
- **Bounded queries.**
  - Custom ranges are at most 366 days; daily buckets at most 120 days.
  - Pages are 1–100 rows (page ≤ 1000), and the search is ≤ 100 characters.
  - The query schemas are strict: unknown parameters are rejected with 400.
- **Never returned:**
  - passwords or hashes, session tokens, Apple or Google purchase tokens (only "has store reference");
  - API keys, Stripe secrets, card details;
  - document text, prompts, AI output, file names;
  - environment values (Health shows only enabled/disabled per feature).
- **Personal data shown:** the email, signup date, plan state and usage counts. These are what is needed to support a customer.

## Where each figure comes from

Every block is labelled with its source. Missing data is shown as **unavailable** with a reason, never as 0.

| Label | Meaning |
| --- | --- |
| **Stripe (live)** | Read from the Stripe API at request time (charges with balance-transaction fees, and refunds). Cached for 60 s and capped at 2000 objects per list (a "truncated" flag is shown). The source of truth for money. Test-mode keys show test data (`livemode` is shown). |
| **Database** | Exama's own tables: accounts, subscriptions, usage ledger, course creations, jobs and webhooks. The source of truth for entitlements and usage. |
| **Analytics** | `analytics_events`: counts of what happened, never money. |
| **Estimate** | Calculated from usage × a dated price table, or subscriptions × catalog price. Never a charge. |

## Sections

- **Overview.**
  - Users and signups.
  - Accounts by category: Free / trial / paid / owner, plus paid-cancelling. These use the same rules as the entitlement resolver (a lapsed row counts as Free; a trial is never paid).
  - Subscriptions by status and environment.
  - Trial → paid conversion, cancellations and expirations (from analytics).
  - Recurring-revenue **estimate** (renewing production subscriptions × EUR catalog price).
  - Stripe gross / refunds / fees / net / failed payments, per currency.
  - AI and transcription cost estimates (USD).
  - Contribution is shown as **unavailable**: revenue is in EUR and AI costs in USD, and no exchange rate is applied.
  - Ranges: 7 / 30 / 90 days / all.
- **Customers.**
  - Search by email or id, filters (category, status, signup dates, activity) and pagination.
  - One query per page plus fixed aggregate queries for the page (no N+1).
  - The detail view shows the subscription (with Stripe customer and subscription links for Stripe only), plan history, usage by month, AI cost by feature and the last 50 events.
- **AI costs.**
  - Totals, then breakdowns by feature (with p50/p95 latency), by provider/model and over time.
  - Top 10 users.
  - Cost per active user and per paying subscriber.
  - Anomalies: last 7 days ≥ 3× the previous weekly average and ≥ $0.25, or ≥ $1 with no history.
  - The price table and its version are shown.
- **Billing.**
  - Database subscription stats.
  - The 50 most recently updated subscriptions with Stripe dashboard links.
  - Live Stripe charges (failed ones with their failure code).
  - Stripe-only states (past_due, unpaid, incomplete) are not stored locally, so see Stripe for those.
- **Product.**
  - Signup-cohort funnel: signed up → confirmed email → onboarding → course → exam → practice → paywall → plan selected → subscribe tapped → Stripe Checkout opened → trial → paid.
  - Event trends.
  - A list of events that are not recorded.
- **Health.**
  - Migrations applied vs expected.
  - Document and material jobs (processing / stuck / failed).
  - AI calls, errors and latency over the last 24 h.
  - Stripe webhooks (received / unprocessed / last received).
  - Reminder email outcomes.
  - Feature switches as enabled/disabled.

## AI cost methodology

- Every Anthropic call reports its own `usage` (input, output and cache tokens), latency and outcome to `ai_usage`. The dashboard makes **no extra AI calls**.
- Attribution comes from an AsyncLocalStorage context (`withAIUsage({ userId, feature })`) set at each service call site:
  - document processing, exam generation, practice generation, grading, study plans, flashcards and material processing;
  - anything else is recorded as `unknown`.
- Recording is best effort: a failed insert never fails the user's request.
- **Price table:** `apps/api/src/billing/ai-pricing.ts`, version `AI_PRICING_VERSION`. Each row stores its estimate and that version, so later price changes don't rewrite history.
  - A model missing from the table is stored with **no estimate** and counted as "unpriced".
  - Failed calls without usage have no tokens and no estimate.
  - When prices change, update the table and bump the version.
- **Transcription:** an estimate of lecture minutes (usage ledger) × `TRANSCRIPTION_USD_PER_MINUTE`.
- **Coverage starts at deployment.** AI usage before `ai_usage` existed was never measured, and "tracked since" shows the first row.

## Not yet instrumented

- `checkout_returned`: leaving Stripe Checkout without paying. Smallest fix: a client event on the cancel/return page.
- App Store / Google Play purchase sheets opened (only `upgrade_started` exists).
- Delivery outcomes of verification, password-reset and receipt emails (no Resend webhook).
- Stripe-only subscription states (past_due, unpaid, incomplete) and disputes: read them in Stripe.
- Payments for Apple and Google subscriptions. Only Stripe money is read; store revenue lives in App Store Connect and Play Console.
- Currency conversion for a contribution margin.

## Deploying

The dashboard adds migration `0018_admin_dashboard`:

- two new tables, `ai_usage` and `admin_audit_log`;
- one new index on `users(created_at)`.

The migration is additive, with no data changes. `exama-api`'s pre-deploy step applies it.

No new environment variables are needed:

- The owner comes from the existing `OWNER_USER_IDS` / `OWNER_EMAILS`.
- Stripe reads use the existing `STRIPE_SECRET_KEY`. Use a restricted key with read access to charges and refunds if one is created later.
