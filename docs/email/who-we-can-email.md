# Who can Exama email? (and the safest way to reach more people)

Engineering position, written from the code and from Exama’s own legal register (`docs/legal/open-items.md`). It is **not legal advice**; the points marked *counsel* need the legal adviser the register already asks for.

## The short version

1. **Account emails may go to unconfirmed addresses; marketing may not go to anyone yet.** An email that exists to run the account the person created (confirm the address, reset a password, a legal or security notice) is a different thing from an email that invites someone to use the product again.
2. **Neither “unconfirmed” nor “confirmed” is consent.** Confirming an address proves the mailbox belongs to the person; it says nothing about agreeing to marketing. Exama’s register says it plainly: *Marketing — none today … any future marketing needs consent*. No consent is recorded anywhere, and the privacy policy does not disclose marketing. So **nobody is cleared for the reactivation campaign today**, confirmed or not.
3. **The way to reach the unconfirmed accounts is the confirmation reminder** (one email per account, ever, no marketing content). It is built; today it can reach nobody only because of two conservative gates: three accounts are younger than 24 h (their sign-up link is still valid) and ten accounts were never asked (held out until an operator includes them).
4. **The way to ever market to people is to collect consent in the app** (below), not to email them to ask: asking for marketing consent by email is itself marketing.

## Types of email

| Email | Who triggers it | Unconfirmed addresses | Disclosed in the privacy policy? | Gate in code |
|---|---|---|---|---|
| Confirmation link at sign-up | the sign-up | yes (that is its job) | yes: “account emails, such as the link to confirm it” | automatic; 60 s cooldown, 5 an hour, token 24 h, single use |
| “Send me a new link” (signed in or out) | the person | yes | yes | same limits; the answer never reveals whether an address has an account |
| Password-reset code | the person | yes; **completing a reset also confirms the address** (they proved control of the mailbox) | yes | 15-minute cooldown per account |
| **Confirmation reminder** (one-off) | operator CLI | yes — this is its purpose | yes: it is the same confirmation email, with a reminder sentence and no other content | `VERIFICATION_REMINDER_SEND`, `--limit`, approval code; one per account, ever; address vetting; bounce/complaint/suppression checks |
| Web subscription confirmation | a subscription | not applicable (subscribers) | yes | webhook |
| Daily study-plan email | the server | **no**: confirmed addresses only | yes, for people with a plan and no subscription | `STUDY_REMINDER_EMAILS_ENABLED`, preference on, plan, Free plan, local hour. *Counsel*: whether it is a service message or direct marketing is still open (`open-items.md` §7) |
| Reactivation campaign | operator CLI | **never** | **no**: marketing is not disclosed | `REACTIVATION_CAMPAIGN_SEND`, confirmed adult, Free, inactive, approval code. **Not cleared: needs consent** |
| Legal or security notice to all accounts (terms change, incident) | operator | yes, where the law requires telling account holders | n/a — not built | would be a one-off service message |

## What the law says in general (counsel to confirm for Exama’s markets)

| Rule | Account / service message | Marketing email |
|---|---|---|
| EU ePrivacy Directive Art. 13 + GDPR | outside Art. 13 (not “direct marketing”); GDPR basis: contract / legitimate interest in running and securing the account, and keeping the data accurate | **prior consent**, except the “soft opt-in”: the address was obtained “in the context of the sale of a product or a service”, used for the same company’s *similar* products, with a clear chance to refuse at collection and in every email. Whether a **free** sign-up is a “sale” differs by country |
| Spain (LSSI art. 21–22) | allowed | needs prior request or authorisation, or a **prior contractual relationship** and similar products, with an easy opt-out in every email |
| France (CPCE L.34-5, CNIL) | allowed | prior consent for consumers; exception for similar products by the same company if the person could refuse when the address was collected |
| UK (PECR reg. 22) | allowed | consent or the soft opt-in (sale or negotiation of a sale) |
| US (CAN-SPAM) | allowed | opt-out model: no deception, a physical address, a working unsubscribe honoured within 10 business days |
| Canada (CASL), Australia (Spam Act) | allowed | consent (express, or narrowly implied by a purchase) |

Exama’s apps and website are in Spanish, French and Arabic as well as English, so assume the EU/Spanish/French position: **consent first**. The campaign’s own legal checklist (`reactivation-campaign.md`) already lists the policy wording to add.

## Who can receive what, today

| Group | Confirmation reminder | Daily study-plan email | Reactivation marketing |
|---|---|---|---|
| Unconfirmed, asked at sign-up | **yes** (after 24 h, vetted) | no | **no** |
| Unconfirmed, predates verification (“legacy”) | **operator’s decision** (`--include-legacy`, vetted, small first batch) | no | **no** — and they have **no age group**, so they could never pass the adult-only rule even after confirming |
| Confirmed adult | not applicable | yes if they have a plan on a Free plan (existing) | **not cleared** (no consent). Technically eligible only if Free, inactive 7 days, account 3+ days, no other Exama email in 7 days |
| Under 18 / no age group | allowed (account message) | existing rules | **never** |
| Bounced, complained, suppressed (ours or Resend’s) | **never** | **never** | **never** |

`npm run email:audiences:prod -w @study/api` prints the live counts for each column and which rule leaves the rest out. It reads only; it sends nothing.

## Deliverability (why “as many as possible” has a limit)

- Resend warns when bounces pass roughly 4–5%. This account sends about a dozen emails a month, so **one bounce is several percent**. A confirmation email to an address that bounced earlier (one already did on 17 Oct) only adds another.
- So the reminder excludes, before anything is sent: addresses on the suppression list, any address Resend’s own log shows bounced, complained or was suppressed (read with timeouts and retries; a send refuses if the log cannot be read), invalid addresses, role addresses (`info@`, `test@`, `noreply@`…), disposable-mail domains, and domains that cannot receive mail (no MX or address record, or a null MX). If DNS gives no clear answer the address is held back for a later run.
- Accounts that predate verification have never been emailed: send **3 first**, run `sync` a few hours later, continue only if nothing bounced. The approval code is per batch, so this is a natural rhythm.
- Resend’s free plan: 100 emails a day, 3 000 a month, shared by every kind of email. The reminder and the campaign share one daily cap (default 20 / 60).

## The smallest safe changes, in order

1. **Wait for the three recent accounts** (reminder becomes available 24 h after each sign-up; no change needed). Run `email:audiences`, then `check-resend`, then the reminder `dry-run`.
2. **Decide on `--include-legacy`.** Run `inspect-legacy` first to see which addresses look real. This is the only step that reaches the ten older accounts; verification stays mandatory and is only ever completed by the owner of the mailbox.
3. **Marketing: collect consent in the app, do not email for it.** Smallest compliant design: a nullable `users.marketing_consent_at` (+ the wording version) set only by an unticked opt-in in Account (and optionally at sign-up), withdrawn by the existing one-click unsubscribe; the campaign then requires it in addition to its current rules; privacy policy and register updated. That turns “nobody cleared” into “everyone who said yes”, which is the only audience that is both legal and worth emailing. It needs a migration, the app screens in four languages and counsel’s wording; it is not built.
4. **Legacy accounts and the age group:** to ever market to them they would first need an in-app age prompt (none exists), then consent.
