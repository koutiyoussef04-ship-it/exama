# Exama — web subscriptions with Stripe

Stripe is the **third billing provider**, next to Apple and Google Play, used by the **web app only**
(`https://app.exama.app`). It feeds the same server-side entitlement system: `applySubscriptionUpdate` is still
the only writer of `subscriptions`, and access is still computed on the server. Apple and Google billing are
unchanged. The iOS/Android apps never sell through, or link to, Stripe.

It is **off by default** (`STRIPE_ENABLED=false`). Nothing changes until you configure and switch it on.

## How it works

```
web app  ──POST /billing/stripe/checkout {plan, interval}──▶  API  ──Checkout Session──▶  Stripe
   ▲                                                            │  (server picks the Price, the trial, the Customer)
   │ redirect to the Checkout URL                               ▼
   └────────────────────────── Stripe Checkout ◀───────────────┘
                                   │  customer pays/enters a card; Stripe owns the 7-day trial
                                   ▼
Stripe ──signed webhook──▶ POST /billing/stripe/webhook ──▶ re-fetch the subscription ──▶ subscriptions row
                                                                                              │
web app (/checkout?status=success) ◀── polls GET /billing/status (the server's answer) ◀──────┘
```

* The browser sends **a plan and an interval only**. The server maps them to a Stripe Price id from its own
  configuration, decides whether the account still gets the free trial, and creates/reuses the Customer.
* **The webhook is the only thing that grants access.** The success page shows "Activating your plan…" and
  polls `GET /billing/status` until the server reports the subscription.
* Each webhook event is verified (signature over the raw body), recorded once (`stripe_events`), and handled by
  **re-reading the subscription from Stripe**, so late, duplicate or out-of-order events all end in Stripe's
  current state. Handling is serialized per customer.
* One Stripe Customer per user (`stripe_customers`: primary key on the user, unique customer id).
* One subscription per account, across all sources: Checkout is refused while the account has a live Stripe,
  Apple or Google subscription (`409 already_subscribed` / `subscribed_elsewhere`). Apple/Google subscriptions are
  never cancelled by us. If a second live subscription ever slips through (two tabs), the NEW Stripe one is
  cancelled automatically — refund any charge manually in the Dashboard (the server log names it).
* **Deleting an Exama account deletes its Stripe Customer first** (which cancels the subscription). If Stripe
  cannot be reached the deletion is refused and nothing is deleted.

## Access rules (Stripe status → Exama)

| Stripe status | Exama access | Notes |
|---|---|---|
| `trialing` | trial (Student features, trial allowance) until the trial ends | status `trialing` |
| `active` | the plan's tier until the current period ends | status `active` |
| `active` + cancel at period end | same, until the period ends, then none | status `cancelled` (will not renew) |
| `past_due` | still entitled for **7 days** after the failed renewal (`PAST_DUE_GRACE_DAYS`), then none | like Apple's billing grace / Google's grace period; if the payment later succeeds, `invoice.paid` restores access |
| `unpaid` | none | retries exhausted |
| `canceled` | none | ended (immediately, or at period end) |
| `incomplete` | nothing granted, nothing changes | first payment not confirmed yet |
| `incomplete_expired`, `paused`, unknown | none | fail closed |

Trial users get the **trial tier** (Student features, limited allowance — same as store trials) and the paid
plan's limits once Stripe converts the subscription. One trial per account: a previous trial from any source
(`subscriptions.trial_used`) or from Stripe removes the trial from a new Checkout.

## Stripe Dashboard setup (TEST mode first)

Test mode and live mode are separate worlds in Stripe: repeat every step in live mode when you go live.

1. **Products & Prices** (Product catalog). Create three products — *Exama Basic*, *Exama Student*, *Exama Pro* —
   each with two **recurring, EUR** prices, exactly:

   | Product | Monthly | Yearly |
   |---|---|---|
   | Basic | €9.99 | €79.99 |
   | Student | €14.99 | €119.99 |
   | Pro | €24.99 | €199.99 |

   **Do not configure a trial on the Prices**: the 7-day trial is added by the server at Checkout
   (`trial_period_days`). Copy the six Price ids (`price_…`) into the environment variables below.
2. **Webhook endpoint** (Developers → Webhooks → Add endpoint): URL
   `https://<your-api-host>/billing/stripe/webhook`, and subscribe to exactly these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `invoice.paid`, `invoice.payment_failed`. Copy the **signing secret** (`whsec_…`).
3. **Customer Portal** (Settings → Billing → Customer portal) — this is the "Manage billing" screen:
   enable *update payment method*, *invoice history*, *cancel subscriptions* (choose **cancel at the end of the
   billing period** — an immediate cancellation removes access immediately) and, if you want plan changes there,
   *switch plans* with the six Prices. Fill in the business information and the public Terms/Privacy links.
4. **Failed payments** (Settings → Billing → Subscriptions and emails): turn on Smart Retries and choose what
   happens when retries are exhausted (*cancel* or *mark as unpaid* — both end access in Exama).
5. **Customer emails** (same page): turn on the trial-ending and payment-failed emails. Recommended (and in
   some EU countries expected) so a customer is reminded before a trial turns into a paid subscription.
6. **Tax / VAT**: Checkout is created **without automatic tax** — the amount charged is the list price above.
   Decide with your accountant whether the prices are tax-inclusive, or enable Stripe Tax and add it to the
   Checkout Session in `stripe-api.ts` (`automatic_tax`). This is a business decision, not a code one.

## Environment variables (API server — never in Git, never in the app or the website)

```
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=sk_test_…            # Developers → API keys (test mode first)
STRIPE_WEBHOOK_SECRET=whsec_…          # from the webhook endpoint
STRIPE_BASIC_MONTHLY_PRICE_ID=price_…   STRIPE_BASIC_YEARLY_PRICE_ID=price_…
STRIPE_STUDENT_MONTHLY_PRICE_ID=price_… STRIPE_STUDENT_YEARLY_PRICE_ID=price_…
STRIPE_PRO_MONTHLY_PRICE_ID=price_…     STRIPE_PRO_YEARLY_PRICE_ID=price_…
STRIPE_SUCCESS_URL=https://app.exama.app/checkout?status=success
STRIPE_CANCEL_URL=https://app.exama.app/checkout?status=cancelled
STRIPE_PORTAL_RETURN_URL=              # optional; default https://app.exama.app/account
BILLING_MOCK_ENABLED=false             # the mock provider replaces every real provider
CORS_ORIGINS=https://app.exama.app     # the web app calls the API from the browser
```

The server refuses to start with `STRIPE_ENABLED=true` and anything missing or malformed (keys and ids are
checked by prefix, the six Price ids must differ, URLs must be https in production). Then run
`npm run db:migrate` (migration `0010_stripe_web_billing`: two new tables, nothing else changes).

## Testing in test mode

1. Forward webhooks to your machine with the Stripe CLI: `stripe listen --forward-to localhost:4000/billing/stripe/webhook`
   (it prints a `whsec_…` for that session — use it as `STRIPE_WEBHOOK_SECRET` locally).
2. Sign up in the web app → *Upgrade* → *Start 7-day free trial* → pay with test card `4242 4242 4242 4242`.
   The return page should show "Activating your plan…" and then "You're all set".
3. Account → *Manage billing* opens the Portal (cancel, change plan, payment method).
4. Use a **Test clock** (Billing → Test clocks) to jump past the trial and renewal dates; the card
   `4000 0000 0000 0341` fails the renewal (→ `past_due` → grace period).
5. Try the guards: start Checkout twice; subscribe on the web and then try a store purchase (409).

## Automated tests

`apps/api/test/stripe-billing.test.ts` (checkout, customer mapping, duplicates, portal, webhook signatures and
idempotency, every Stripe status → entitlement, account deletion, config) and
`apps/api/test/stripe-disabled.test.ts` (Stripe off = behaviour unchanged). Stripe's network is faked; webhook
signatures are verified by the real SDK. Run with `npm test -w @study/api` (needs Postgres).

## App Review note (iOS)

The iOS/Android apps are built so a Stripe subscription only ever **unlocks** features: the catalog never offers
Stripe on iOS/Android, `getStoreClient('stripe')` returns nothing there, and screens show plain text ("managed
on the web") with **no link, button or call to action** towards web purchasing or billing. Keep it that way:
Apple's rules allow unlocking content bought elsewhere when the same items are also sold via in-app purchase,
but not steering users to an external purchase from inside the app.
