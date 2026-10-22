# B2B plans → Stripe: mapping and implementation plan

Status: **plan only.** Nothing in this repository creates Stripe products, prices, customers, checkout sessions or
subscriptions for organizations, and no Stripe ID for them exists anywhere. Organizations are billed by hand until the
work below is done. The student Stripe integration (`docs/stripe/stripe-web-billing.md`) is separate and unchanged.

## 1. What is sold (source of truth: `ORGANIZATION_PLAN_CATALOG`, `packages/shared/src/organizations.ts`)

| Exama plan | Stripe product | Recurring prices to create (EUR, tax-exclusive) | Allowances (per calendar month) |
|---|---|---|---|
| `esencial` | **Exama Esencial — organizations** | monthly **€149.00** (14,900 cents, `interval=month`) · yearly **€1,490.00** (149,000 cents, `interval=year`) | 10 course uploads, 500 question drafts, 10 admins/editors |
| `profesional` | **Exama Profesional — organizations** | monthly **€349.00** (34,900) · yearly **€3,490.00** (349,000) | 100 course uploads, 2,000 question drafts, 25 admins/editors |
| `centro` | none in the catalog | custom: invoiced by hand, or a price created per customer and attached by the owner | set by the owner (`organizations.limits`) |
| `pilot` | **never in Stripe** | — | granted by hand by the B2B owner (default 5 / 150 / 3 as totals) |
| `none` | — | — | nothing (the state of every new organization) |

All prices: reviewers unlimited, at most 20 drafts per request, **VAT excluded** (`tax_behavior = exclusive`).
Four price IDs in total, kept in the API environment only (names proposed, not created):
`STRIPE_ORG_ESENCIAL_MONTHLY_PRICE_ID`, `STRIPE_ORG_ESENCIAL_YEARLY_PRICE_ID`, `STRIPE_ORG_PROFESIONAL_MONTHLY_PRICE_ID`,
`STRIPE_ORG_PROFESIONAL_YEARLY_PRICE_ID` — each distinct from the six student price IDs (the config check already refuses
shared IDs among the student ones; extend it to all ten).

## 2. Data model (one migration, when the integration is built)

- `organization_billing` (one row per organization): `organization_id` (unique), `stripe_customer_id` (unique),
  `stripe_subscription_id`, `plan` (`esencial` | `profesional`), `billing_period`, `status` (Stripe's), `current_period_end`,
  `cancel_at_period_end`, `environment` (`sandbox` | `production`), timestamps. The **Customer belongs to the organization**,
  not to the admin who paid (billing contact = the paying admin's email; staff change, the organization stays).
- `organizations.plan_source` (`manual` | `stripe`): who set the current plan. The webhook only ever changes an organization
  whose plan it owns (`stripe`) or that has no paid plan (`none`, `pilot`); a plan set by hand (`centro`, a negotiated
  `esencial`) is never overwritten by Stripe.
- Webhook de-duplication reuses `stripe_events` (one table, both businesses).

## 3. Who can buy, and what the server decides

- `POST /orgs/:id/billing/checkout` — **organization admins only** (`requireOrgRole('admin')`, organization accounts only
  as today). The body is `{ plan: 'esencial' | 'profesional', period: 'monthly' | 'yearly' }`, nothing else: the server
  maps it to one of the four price IDs (allowlist), creates/reuses the organization's Customer, and starts a Checkout
  Session in `subscription` mode with `client_reference_id` / metadata = organization id, `tax_id_collection` and the
  billing address (B2B invoices), Stripe Tax if enabled. Centro, pilot and `none` are never purchasable.
- `POST /orgs/:id/billing/portal` — admins only: the Customer Portal for invoices, payment method, cancellation.
- No trial in Checkout: a trial would be a public pilot. A negotiated pilot stays a manual grant.
- The browser never sends a plan state: as for students, **only the verified webhook grants or removes entitlements**,
  and it re-fetches the subscription from Stripe before applying it.
- The B2B owner keeps the manual controls (plan, limits, pilot, suspension, all audited); a manual change sets
  `plan_source = manual`.

## 4. Subscription status → entitlements (same rules as the student integration)

| Stripe status | `organizations.plan` | Notes |
|---|---|---|
| `active` | the subscribed plan, `billing_period` from the price | allowances apply at once (monthly window) |
| `active` + `cancel_at_period_end` | unchanged until `current_period_end`, then `none` | the workspace shows the end date |
| `past_due` | unchanged for 7 days after the failed renewal (`PAST_DUE_GRACE_DAYS`), then `none` | `invoice.paid` restores it |
| `unpaid`, `canceled`, `incomplete_expired`, `paused`, unknown | `none` | fail closed; data stays readable and exportable |
| `incomplete` | nothing changes | first payment not confirmed |

- **Renewal** (`invoice.paid`): extends `current_period_end`; nothing else changes.
- **Plan change** (Portal or a new Checkout while subscribed is refused; changes go through the Portal with proration):
  the webhook sets the new plan; allowance overrides are dropped as for manual plan changes.
- **Failed payment** (`invoice.payment_failed`): email to the organization's admins; grace as above.
- **Cancellation**: at period end only (Portal setting), then `none`.
- **Pilot and Stripe stay separate:** a pilot is never created, extended or ended by Stripe. When a subscription
  becomes `active` on an organization that is on a pilot, the paid plan replaces the pilot (its dates are kept as a
  record). When a subscription ends, the organization returns to `none` — never to a pilot.
- **Owner usage:** the B2B owner's unlimited usage is unaffected (it is the actor's privilege, not a plan).

## 5. Security

- Webhook: raw-body signature verification, event de-duplication, re-fetch of the subscription, organization id
  taken from the subscription's metadata set by **our** server at checkout and cross-checked with the Customer.
- Checkout/portal: organization admins only, rate-limited, price chosen by the server from the allowlist.
- An organization admin can never set `plan`, `limits` or pilot dates (already enforced and tested).
- Live keys only in the Render environment; test mode first; `environment` stored so test subscriptions never count
  as revenue.

## 6. Remaining steps before configuring Stripe (in order)

1. **Legal and company:** B2B terms and a data processing agreement (subprocessors: Anthropic, Render, Resend, Stripe),
   company name/registration/address (`site.legal`), a domain email instead of examaweb@gmail.com.
2. **Tax:** decide with the accountant — prices are VAT-exclusive; enable Stripe Tax (EU VAT, reverse charge with a
   valid VAT ID, Gulf VAT where registered) and tax-ID collection.
3. **Stripe test mode:** create the two products and four prices above (EUR, tax-exclusive), a Customer Portal
   configuration for organizations (cancel at period end, plan switching between Esencial and Profesional), and a
   webhook endpoint (can be the existing one, routed by metadata).
4. **Code** (one PR): the migration in §2, the checkout/portal endpoints, the webhook branch for organizations, the
   status mapping with tests mirroring `stripe-billing.test.ts`, the workspace "Choose a plan" button for admins
   (only when the API reports org checkout as available), website copy switched from "request" to "subscribe" behind
   a build flag like `PUBLIC_WEB_CHECKOUT_AVAILABLE`.
5. **End-to-end in test mode** (test cards: success, failure, 3-D Secure; renewal with test clocks; cancellation;
   past-due grace), then live keys and the four live prices.
