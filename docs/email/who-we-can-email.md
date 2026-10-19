# Who can Exama email? (and the safest way to reach more people)

Engineering position, written from the code and from Exama’s own legal register (`docs/legal/open-items.md`). It is **not legal advice**; the points marked *counsel* need the legal adviser the register already asks for.

## The short version

1. **Account emails may go to unconfirmed addresses; marketing goes only to people who said yes.** An email that exists to run the account the person created (confirm the address, reset a password, a legal or security notice) is a different thing from an email that invites someone to use the product again.
2. **Neither “unconfirmed” nor “confirmed” is consent.** Confirming an address proves the mailbox belongs to the person; it says nothing about agreeing to marketing. Exama’s register says plainly that marketing needs consent. Consent is now collected explicitly: an **optional, unticked checkbox at sign-up** and a switch in Account (`marketing-consent.md`), recorded only when the person says yes. Every account that existed before has **no** consent, and nothing infers one.
3. **The way to reach the unconfirmed accounts is the confirmation reminder** (one email per account, ever, no marketing content). It is built; the number it can reach today is limited only by two conservative gates (accounts younger than 24 h, and accounts that predate verification, which need an explicit operator choice).
4. **Marketing eligibility = explicit consent + confirmed address + every existing safety rule** (adult, Free, inactive, not suppressed or bounced, not unsubscribed…). The study reminder emails are a **separate category**, not covered by the consent and not affected by it — and one of them, “Pick up where you left off”, needs its own classification review (`email-classification.md`).

## Types of email

| Email | Who triggers it | Unconfirmed addresses | Disclosed in the privacy policy? | Gate in code |
|---|---|---|---|---|
| Confirmation link at sign-up | the sign-up | yes (that is its job) | yes: “account emails, such as the link to confirm it” | automatic; 60 s cooldown, 5 an hour, token 24 h, single use |
| “Send me a new link” (signed in or out) | the person | yes | yes | same limits; the answer never reveals whether an address has an account |
| Password-reset code | the person | yes; **completing a reset also confirms the address** (they proved control of the mailbox) | yes | 15-minute cooldown per account |
| **Confirmation reminder** (one-off) | operator CLI | yes — this is its purpose | yes: it is the same confirmation email, with a reminder sentence and no other content | `VERIFICATION_REMINDER_SEND`, `--limit`, approval code; one per account, ever; address vetting; bounce/complaint/suppression checks |
| Web subscription confirmation | a subscription | not applicable (subscribers) | yes | webhook |
| Study reminder: “Today’s study plan” | the server | **no**: confirmed addresses only | yes, for people with a plan and no subscription | `STUDY_REMINDER_EMAILS_ENABLED`, preference on, plan, Free plan, local hour. *Counsel*: whether it is a service message or direct marketing is still open (`open-items.md` §7) |
| Study reminder: “Pick up where you left off” (a course, no plan yet) | the server | **no**: confirmed addresses only | **no**: the policy describes only the plan email | same gates but **no plan**; daily, no end, no inactivity check, includes a feature pitch. Looks like re-engagement: **highest-priority legal review** (`email-classification.md`) |
| Reactivation campaign | operator CLI | **never** | **no**: marketing is not in the policy yet (*counsel*: add it, `marketing-consent.md`) | `REACTIVATION_CAMPAIGN_SEND`, **explicit marketing consent**, confirmed adult, Free, inactive, approval code; consent is re-checked before every email |
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

| Group | Confirmation reminder | Study reminder emails | Reactivation marketing |
|---|---|---|---|
| Unconfirmed, asked at sign-up | **yes** (after 24 h, vetted) | no | **no** |
| Unconfirmed, predates verification (“legacy”) | **operator’s decision** (`--include-legacy`, vetted, small first batch) | no | **no** — and they have **no age group**, so they could never pass the adult-only rule even after confirming |
| Confirmed adult | not applicable | yes if Free and never paid with one course (a plan: “Today’s study plan”; no plan: “Pick up where you left off”) — on by default, own switch | **only with explicit marketing consent** (ticked at sign-up or switched on in Account, not withdrawn), and only if Free, inactive 7 days, account 3+ days, no other Exama email in 7 days. Confirmed without consent: **no** |
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
3. **Marketing: consent collected in the app, never by email — built** (`marketing-consent.md`): an optional, unticked checkbox at sign-up and an Account switch, stored as `users.marketing_consent_*` (server time, wording version and language, source) with an append-only history, withdrawable by the link in every marketing email. The campaign now requires it. Existing accounts have none and can opt in only through the Account switch (an optional one-time in-app card is described but not built). **Still to do before any send: counsel’s review of the wording and the privacy-policy sentence.**
4. **Legacy accounts and the age group:** to ever market to them they would first need an in-app age prompt (none exists), then consent.
