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
  - Search by email (case-insensitive; `%` and `_` are literal).
  - Filters: account type (Free / trial / paid / owner), **current plan** (the tier the account has now: free, trial, basic, student, pro; owner accounts never match), **subscription status**, signup dates and activity.
  - Sorting: newest, oldest, email A–Z, recently active, AI cost (all time), AI cost (last 30 days) and AI calls.
  - Pagination of 1–100 rows per page.
  - Each row shows email, plan, status, signup date, last activity, usage counts, and AI cost (all time / last 30 days) with an "Unusual" badge.
  - One query per page plus fixed aggregate queries for the page (no N+1). The AI and activity sorts use a per-account subquery on the `(user_id, created_at)` indexes, computed only for the chosen sort.
  - Tapping a row (or a customer in the AI tab's top-cost or unusual lists) opens the detail view.
- **Customer detail.**
  - Account, subscription (with Stripe customer and subscription links for Stripe only), plan history, usage by month and recent events.
  - **AI usage** (estimate):
    - last 7 days, last 30 days and all time, each with calls, failed calls, tokens in / out, estimated cost and unpriced calls;
    - cost per day for the last 30 days;
    - breakdowns by feature and by provider / model;
    - the price-table versions used.
  - **Lecture transcription** (estimate): billed minutes from the usage ledger (all time and last 30 days) × the transcription price.
  - **Payments** (Stripe, live):
    - this customer's charges only (at most the latest 100, cached for 60 s, with concurrent views sharing one read);
    - per currency: gross, refunded, Stripe fees, net after refunds and fees (not profit), and failed payments;
    - the latest 20 payments with links to Stripe.
    - How each figure is calculated:
      - **Source:** Stripe's Charges API filtered by the customer's Stripe id from `stripe_customers`. Any charge Stripe attributes to another customer is dropped.
      - **Gross:** the amount of captured, succeeded charges. Pending, failed and uncaptured (authorised only) charges are not counted as received.
      - **Refunded:** each counted charge's `amount_refunded`, which can include a refund that is still pending. Each refund is counted once, on its own payment.
      - **Fees:** the `fee` of the charge's balance transaction, used only when it is in the charge's currency. If any counted charge has no fee in that currency, fees and net show as **unavailable**, never 0.
      - **Net** = gross − refunded − fees. It is **not profit**: it leaves out disputes, taxes, payouts, FX and all other costs.
      - Currencies are never mixed.
      - Disputed payments are marked, but their outcome isn't reflected in the totals.
    - Unavailable with a reason for App Store / Google Play customers, for accounts without a Stripe customer, or when Stripe can't be reached.
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
  - Each customer gets a coverage label:
    - `full`: the account was created after the first recorded call, so 0 calls means no AI usage;
    - `partial`: the account is older, so earlier usage is unknown, not zero (marked `*` in the directory);
    - `not_tracked`: nothing recorded on the server yet, so usage is unavailable.
  - Historical costs are never reconstructed.
- **Unusual consumption** uses the same rule in the AI tab and on each customer: the last 7 days are ≥ 3× the weekly average of the 4 weeks before and ≥ $0.25, or ≥ $1 with no earlier usage.

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

## Diagnosing a failed upload

A customer says "my upload failed" and the dashboard shows 0 courses: no course row is created until the file reaches the API, so a failure before that leaves no trace in the counters. The trace is in **Customers → the customer → Recent events**. The **Details** column shows `platform`, `failure_reason` and `file_size_kb` (an allow-list; nothing else is shown). Upload events and `app_opened` each have their own quota in that list (up to 30 upload events, 10 `app_opened`, 30 others), so frequent `app_opened` rows cannot push an upload out of view.

`upload_failed.failure_reason` — one coarse category, never a file name, path or error text:

| Reason | Meaning | What the student is told |
|---|---|---|
| `picker` | the file picker failed, or copying the picked file failed (before anything was sent). Cancelling is **not** a failure and records nothing | choose a PDF or PowerPoint (.pptx) saved on this device and try again |
| `request` | the app could not prepare or send the request (before any response), or the request reached the server without the file | try again or choose another file; update the app |
| `network` | no response: offline, dropped connection, timeout | check the internet connection |
| `auth` | 401 / 403: not signed in, session expired | sign in again |
| `not_verified` | 403 `email_not_verified` (only when verification is enforced and the grace period is over) | confirm the email address |
| `limit` | 402: the plan's limit (the paywall opens) | the limit message |
| `rate_limited` | 429 | wait and try again |
| `too_large` | 413 (the app's limit, or the edge's) | the size limit |
| `not_pdf` | 415: any unsupported file type (including old .ppt) | what is supported |
| `server` | 5xx | try again in a moment |
| `unknown` | anything else | try again |

The first five existing values (`network`, `too_large`, `not_pdf`, `server`, `unknown`) keep their meaning.

**Reading a trace.** `upload_started` is sent when a file has been picked, before the request. `upload_started` then `upload_succeeded` is a success. `upload_failed` with `picker` and **no** `upload_started` means the picker failed. `upload_started` with neither a later `upload_failed` nor `upload_succeeded` means the connection dropped (see below) or the app was closed mid-upload. No upload events at all: no file was picked (cancelled, or the picker offered nothing) or the app never reached that screen.

**Limitation (deliberate).** `upload_failed` is sent once, best-effort, as the failure happens. If the network is down at that moment the event is lost. No retry or on-device queue was added: events carry no id, so a retry after a timeout could record the same failure twice, and unsent events kept in client storage are not reliable (cleared by the OS, lost on reinstall, shared between sessions). The pattern above (a started upload with no outcome) is the signal for this case. The API logs also show every upload request that arrives (`<-- POST /documents` and its status); an upload that never reaches the API leaves nothing there, and Cloudflare edge rejections are not in the app logs.

**Read-only query** (Render Shell, `psql`; replace the address):

```sql
select e.created_at, e.name, e.properties->>'platform' as platform, e.properties->>'failure_reason' as reason
from analytics_events e join users u on u.id = e.user_id
where u.email = '<customer email>' and e.name in ('upload_started','upload_failed','upload_succeeded','app_opened')
order by e.created_at;
```

Across all customers: `select properties->>'platform' as platform, properties->>'failure_reason' as reason, count(*) from analytics_events where name = 'upload_failed' group by 1, 2 order by 3 desc;`
