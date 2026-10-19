# Legal review pack: Privacy Policy, Terms and minimum age

**Status (2026-10-16): draft, not legally approved.** `LEGAL_IS_DRAFT` stays `true` in
`apps/mobile/src/i18n/legal.ts`, so the app and https://exama.app/privacy and /terms show a "Draft"
notice and the website pages are `noindex`. This document is engineering's input for a lawyer. It is
not legal advice. Each item says what the product does today, so the review starts from facts.

One text, three places: `apps/mobile/src/i18n/legal.ts` (en, es, fr, ar) → `npm run legal:export -w
@study/mobile` → `docs/legal/*.md` and `website/src/data/legal.generated.json` (rendered at `/privacy`,
`/terms`, `/es/…`, `/fr/…`, `/ar/…`). Tests fail if any copy differs (`apps/mobile/test/legal.test.ts`,
`website/scripts/verify-build.mjs`).

## 1. Remaining `[bracketed]` items (same in all four languages)

| Item | Where | Why it is still open | Who |
|---|---|---|---|
| Company name, postal address, contact email | `{{company}}`, `{{address}}`, `{{email}}` | not confirmed anywhere in the repo; filled from `EXPO_PUBLIC_COMPANY_*`/`EXPO_PUBLIC_SUPPORT_EMAIL` (app) and `site.legal` (website) | owner |
| AssemblyAI model training | Privacy → AI processing | AssemblyAI may use "certain files" for training unless the account opted out or uses its EU servers; the API's `ASSEMBLYAI_BASE_URL` defaults to the US endpoint and the production value isn't visible from here | owner (AssemblyAI dashboard / contract) |
| Transfer safeguards | Privacy → International transfers | the safeguard (EU–US Data Privacy Framework, SCCs…) must come from each provider's DPA, not be assumed | owner + lawyer |
| Warranty disclaimer and liability | Terms | jurisdiction-specific; mandatory consumer law limits it | lawyer |
| Governing law and courts | Terms | depends on the company's seat and markets | owner + lawyer |

Where the company details go once confirmed (same values everywhere): `EXPO_PUBLIC_COMPANY_NAME`,
`EXPO_PUBLIC_COMPANY_ADDRESS`, `EXPO_PUBLIC_SUPPORT_EMAIL` (exama-app on Render and the EAS production
profile, then rebuild) and `site.legal` in `website/src/config/site.ts`.

**Missing but not bracketed** (the text doesn't mention them yet): the GDPR legal bases (§3), the
controller's identity and DPO/EU representative if required (§4.7), and the subscription points in §5.

### Subscription terms vs. the code (audit 2026-10-15)

| Topic | What the code does | Terms today | Action |
|---|---|---|---|
| 3-day web trial | Stripe: `trial_period_days: 3` (`STRIPE_TRIAL_DAYS`), full access to the selected plan during the trial, card collected, nothing charged during the trial, one trial per Exama account across sources (`trial_used`) | matches | — |
| Trial across stores | Apple/Google decide introductory-offer eligibility per Apple ID / Google account; an Exama account that used a web trial can still be given a store trial (the app just doesn't advertise it) | "once per account on the web; store trials follow Apple/Google rules" (2026-10-16) | — |
| Web cancellation | done in Stripe's Customer Portal; whether it cancels **at period end** or **immediately** is a Stripe Dashboard setting, not code (`docs/stripe/stripe-web-billing.md` recommends period end) | "you keep access until the end of the period you have paid for" (2026-10-16) | **confirm the Portal is set to cancel at period end** — the Terms now promise it |
| Account deletion with a web subscription | deletes the Stripe Customer → subscription cancelled **immediately**, no proration or refund of the unused period | Terms and the delete screen say the remaining period is not refunded and to withdraw first if still within 14 days (2026-10-16) | — |
| Refunds (web) | none issued by code; manual in the Stripe Dashboard only | statutory withdrawal (EU/EEA/UK) + mandatory remedies only; no voluntary refunds (section 5) | decide how statutory refunds are processed (section 5) |
| Trial-ending / renewal reminders | Stripe Dashboard emails (not code) | not mentioned | turn on in Stripe; recommended in the EU |
| Stripe in production | `render.yaml` ships `STRIPE_ENABLED=false`; the live value isn't readable from here | Terms and website describe web subscriptions | confirm Stripe is enabled (test → live) before the Terms go live, or the Terms overstate what the web offers |

Filled in this round from verified facts: hosting provider and region (Render, Frankfurt, read from the
Render API), backups (Render docs), Anthropic retention and training (Anthropic's published API terms),
AssemblyAI deletion of uploads (AssemblyAI docs), Stripe web payments (the code), and where data is
hosted vs. which providers may process it outside the EU.

## 2. Age screen vs. FTC guidance (COPPA)

Checked against the FTC's *Complying with COPPA: Frequently Asked Questions* (updated 2026-07-10) and
the amended Rule (Federal Register, April 2025; compliance date 2026-04-22).

| FTC guidance | Exama | Evidence |
|---|---|---|
| Age question must be neutral; must not default to 13+ (H.3, D.7; amended §312.2) | five answers including "Under 13", none pre-selected, answer required | `apps/mobile/test/age-gate.test.ts`; e2e: 5 answers, none selected (en/fr/es/ar) |
| Don't offer only 13+ choices or an "I am over 12" checkbox (H.3) | "Under 13" is a real choice | same |
| Don't announce the cut-off before the question (H.3) | the question and hint don't mention 13; the cut-off appears only after "Under 13" is chosen. The Terms (linked under the form) state it, as the Terms must | `sign-up.tsx`, locales |
| Prevent back-buttoning, e.g. with a cookie (H.3, D.7) | 24-hour device marker (timestamp only) | unit test; e2e: revisit stays blocked; expired/tampered marker reopens the form |
| A general-audience service may block under-13s (H.3) | sign-up stops on the device, no request sent; the API refuses `under_13` (403) for any client | `apps/api/test/age-range.test.ts`; e2e: zero `/auth/register` requests |
| Actual knowledge of an under-13 user → delete or get parental consent (A.12, H.6, B.4) | nothing is stored for an "Under 13" answer; the policy gives a contact to report an under-13 account, which support deletes | policy "Children"; **process: see 4.6** |
| Mixed-audience services may not collect personal information before age (amended §312.2) | not applicable if general audience (below). For reference: before the answer, the sign-up screen sends nothing, but the app may already have sent an `app_opened` analytics event with a random install id | see 4.4 |

### Audience assumption (to be confirmed by counsel)

Exama is treated as a **general-audience service**, not "directed to children" and not "mixed
audience". Reasons, using the FTC's factors (D.1): exam preparation from the student's own course
material (secondary and university level); no child-oriented content, characters, games or rewards;
no marketing to children or primary/middle schools; pricing and copy aimed at students who buy their
own subscriptions. Under that classification, COPPA applies only with actual knowledge that a user is
under 13 (A.12), age screening is optional, and if age is asked, it must be neutral and under-13s
handled (H.3) — which the implementation does.

Re-assess (and talk to counsel) if any of these happens: marketing to under-13s or their schools,
content for primary/middle-school curricula, many "Under 13" answers in practice, or app-store
listings in a children's or family category. A **mixed-audience** service may not block children
altogether (D.6) and would need a parental-consent flow, which this release deliberately doesn't have.

The FTC also says teens are not covered by COPPA but warrants "strong, more flexible" protections
(A.9). US state laws on teens' data (California and others) are outside this review.

## 3. Legal bases (GDPR Art. 6) — proposed, for counsel to confirm

The Privacy Policy does **not yet state legal bases**, which Art. 13(1)(c) GDPR requires. They should be
added only after counsel confirms this table.

| Processing | Data | Candidate basis | Notes and minors |
|---|---|---|---|
| Account, sign-in, security, account emails (confirmation link, reset code) | name, email, password hash, verification status | contract (6(1)(b)); security: legitimate interest (6(1)(f)) | EDPB: contract covers only what is objectively necessary for the service the user signed up for. **Minors' capacity to contract is national civil law** (France: Recommendation 1 of the CNIL lets a minor contract within civil-law limits; Spain: needs advice) |
| Age group | `13_17` … `35_plus` | legitimate interest (enforcing the minimum age, protecting children) or contract | never used for ads, prices or limits; not in analytics |
| Course processing, exams, grading, flashcards, AI processing (Anthropic), transcription (AssemblyAI) | uploaded material, recordings, answers | contract (core service the student asks for) | recordings can contain third parties' voices (lecturers, classmates): the Terms ask students to have permission; counsel to confirm Exama's position |
| Subscriptions and payments (Apple, Google, Stripe) | plan, transaction ids; Stripe: name, email | contract; accounting and tax records: legal obligation (6(1)(c)) | paid subscriptions by 13–17-year-olds: capacity to contract and consumer law (see 4.2) |
| Product analytics | events with ids/counts, random install id stored on the device or in the browser | legitimate interest (GDPR) — **plus the ePrivacy rule on storing/reading the install id on the device** | **There is no opt-out today and the install id has no expiry.** The CNIL's consent exemption for audience measurement requires informing users, a way to object, first-party-only use and a tracker lifetime of at most 13 months. Counsel to decide: consent banner vs. exemption (add opt-out + expiry). Balancing tests weigh minors' interests more heavily |
| Optional study preferences (onboarding) | field, exam date, goal, material, confidence | consent **or** legitimate interest — to decide | **This is the main GDPR Art. 8 point:** if the basis is consent, under 16 by default in the EU, under 15 in France (joint consent with a parent) and under 14 in Spain (LOPDGDD art. 7) need parental consent. Exama's `13_17` group can't tell a 14-year-old from a 16-year-old, so either avoid consent as the basis, skip this step for `13_17`, or collect finer age bands |
| "Under 13" device marker (24 h, timestamp only) | none about the person | legitimate interest; ePrivacy: arguably necessary to enforce the requested sign-up rule — counsel to confirm | holds no answer, name or email |
| Daily study-plan email (`docs/study-reminders.md`) | first name, email, course titles, today's planned tasks and stored focus notes; a per-day send log | legitimate interest (6(1)(f)) in helping the student follow the plan they made, **or** contract — to decide | on by default, only to confirmed addresses, one-click unsubscribe in every email and a switch in Account. Content is the student's own plan, no offers or upgrade prompts. It goes only to students **without** a subscription, so counsel should confirm it is a service message, not direct marketing (ePrivacy Art. 13 would need prior consent or the soft opt-in). Minors: weigh in the balancing test |
| Marketing emails (tips, news about new features, offers, invitations to come back) | email, wording version and language, time and source of the consent, history of grants and withdrawals (`users.marketing_consent_*`, `marketing_consent_log`) | **consent** (GDPR 6(1)(a); ePrivacy Art. 13), given by an optional, unticked checkbox at sign-up or an Account switch — implemented 2026-10-19, **no marketing has been sent**; no advertising, no ads ids, no tracking across apps/sites | never inferred from sign-up, verification or activity; accounts that existed before have none; withdrawable by the link in every marketing email and in Account; separate from the daily study-plan email. See `docs/email/marketing-consent.md` (*counsel*: the wording in four languages, the policy sentence, minors 13–15) |
| Confirmation reminder (one email per unconfirmed account, `docs/email/verification-reminder.md`) | email, language, time of the reminder (`email_campaign_sends`: user id, status — no address, no content) | contract / legitimate interest, same as the confirmation email it repeats (6(1)(b), 6(1)(f)) | an account message, not marketing: the same link and wording plus “this is the only reminder”; one per account; to addresses the person gave; bounces are suppressed. Accounts that predate verification only on an explicit operator decision. *Counsel: confirm it is outside ePrivacy Art. 13* |
| Reactivation campaign (`docs/email/reactivation-campaign.md`) | same log as the confirmation reminder plus first-party click counts | **consent** (see the marketing row above) | built, **not sent**: it emails only accounts with explicit marketing consent (re-checked before each email), confirmed, adult and passing the other rules; sending is locked by `REACTIVATION_CAMPAIGN_SEND`. The soft opt-in is not relied on |
| Support requests | what the person sends | contract / legitimate interest | — |

## 4. Other open questions for counsel

1. **Users aged 13–15/16 in the EU (Spain under 14, France under 15, default 16).** Confirm that no
   processing relies on the minor's own consent, or design parental consent / finer age bands for it.
   The age question cannot currently distinguish 13–15 from 16–17.
2. **Paid subscriptions by minors.** Whether 13–17-year-olds can validly enter a paid subscription in
   each market (civil-law capacity, consumer law), for store purchases and for Stripe web checkout.
3. **Self-declared age.** Is a self-declared, neutral age question enough for the markets in scope
   (EU Digital Services Act Art. 28 guidance on minors, UK Age Appropriate Design Code, US state laws),
   or is stronger age assurance expected?
4. **Analytics before sign-up.** An `app_opened` event with a random install id can be sent before the
   age question. Acceptable for a general-audience service? Opt-out and expiry needed (section 3)?
5. **Shared devices.** The 24-hour marker blocks sign-up for everyone on that device/browser for a day.
   Proportionate? (It holds no personal data.)
6. **Reports of under-13 accounts.** Write the internal procedure: verify the report, delete the account
   (there is no admin tool; deletion is done with the user's password in the app or directly in the
   database), and record that it was done. Existing accounts have no age group and are not re-asked.
7. **Art. 13 completeness.** Legal bases, controller identity, DPO/EU representative if required,
   retention of analytics while the account exists, and the right to withdraw consent if any basis is
   consent.
8. **Transfers.** Confirm each provider's DPA and transfer mechanism (Anthropic, AssemblyAI, Resend,
   Stripe; Apple and Google act as merchants of record).
9. **Web subscriptions.** The refund and withdrawal wording and the checkout consents (section 5),
   trial-ending reminders, VAT (`docs/stripe/stripe-web-billing.md`).
10. **Other markets.** Morocco and other Arabic-speaking markets, UK, others where the app is listed.

## 5. Refund and withdrawal policy (web, 2026-10-16) — implemented locally, for counsel to confirm

**Policy chosen by the owner:** the strictest lawful one — no voluntary refunds outside statutory
rights, no automatic refunds or credits for service problems, full compliance with mandatory consumer
rights. App Store / Google Play purchases follow Apple's and Google's terms (they are the merchants).

### What the Terms now say (all four languages, `apps/mobile/src/i18n/legal.ts`)

- **Subscriptions and free trial:** 3-day web trial (full access to the selected plan) once per account; store trials follow the stores;
  what checkout asks you to confirm; the confirmation email; cancel in the Portal and keep access until
  the end of the paid period; deleting the account cancels a web subscription immediately.
- **Right of withdrawal (consumers in the EU, the EEA and the UK):** 14 days from the conclusion of the
  contract (the day the subscription or trial starts at checkout); how to withdraw (a clear statement,
  e.g. by email, to `{{company}}`, `{{address}}`, `{{email}}`); reimbursement within 14 days by the same
  means of payment, no fees; because the customer asked for the service to start immediately, a
  proportionate amount is due for the paid service provided up to the withdrawal; the free trial is
  free; the model withdrawal form (Directive 2011/83/EU Annex I(B)).
- **Refunds:** apart from withdrawal and other mandatory rights, payments are not refundable — no
  refunds of unused time after cancelling, partial periods, unused allowances, a plan no longer wanted,
  or the remaining period on account deletion.
- **If something doesn't work:** no automatic refunds, credits or extensions for interruptions,
  maintenance, delays, errors or imperfect AI output; report it and we try to fix it; the consumer keeps
  the mandatory remedies (EU/EEA/UK: bringing into conformity, proportionate price reduction, or ending
  the contract with a refund for the affected period if the problem is not minor). "Nothing in these
  terms limits those rights."
- The old `[State the refund and withdrawal policy…]` placeholder is gone. `LEGAL_UPDATED` is now the
  shared `LEGAL_VERSION` (`2026-10-16`), the version recorded with each checkout.

### What checkout now does (code, tested)

1. **Two separate, unticked boxes** on the web paywall, required before the button works (and again
   after a plan or interval change): (a) automatic renewal at the stated price until cancelled; (b) the
   express request to start now, with the proportionate-payment consequence of withdrawing (Directive
   2011/83/EU Art. 8(8) and 14(3); without this request the consumer would owe nothing for the
   withdrawal period, Art. 14(4)). The renewal box covers the "express affirmative consent" that
   California's automatic-renewal law asks for.
2. **The server refuses checkout without both** (`400 checkout_consent_required`); nothing is created at
   Stripe.
3. **Record of consent** in the Checkout Session and Subscription metadata: `exama_consent`,
   `exama_consent_at` (UTC, minute), `exama_terms_version`, `exama_language`. No database change.
4. **A notice next to Stripe's Subscribe button** (`custom_text.submit`) in the customer's language
   repeating renewal, immediate start and the Terms.
5. **Confirmation on a durable medium**: one email per new web subscription (Art. 8(7)) with plan,
   price as charged by Stripe, trial end, both confirmations, the withdrawal deadline, the model
   withdrawal form, the no-refund rule and links to the Terms and Privacy Policy. Not repeated on trial
   conversion or plan changes. If sending fails it is logged (without the address) and **not retried**.

### Decisions that need the owner (and counsel)

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| 1 | **Online withdrawal function** (Directive 2023/2673 → new Art. 11a of Directive 2011/83/EU, applies from 19 June 2026; Germany §356a BGB) | contracts concluded online must offer a clearly labelled "withdraw from contract here" function and a confirmation step, with an acknowledgement on a durable medium. **Not built.** Email withdrawal alone is unlikely to be enough for EU consumers | build it before EU web sales: a button in Settings → Subscription (signed in) plus a public form; decide whether a non-logged-in path is required |
| 2 | **Processing statutory refunds** | Art. 13: within 14 days of the withdrawal, same means of payment. Code issues no refunds; today it would be manual in the Stripe Dashboard | decide manual vs. API; define the proportionate amount (days used ÷ days in the period × price paid, nothing for the trial) and who does it |
| 3 | **When the withdrawal period starts with a free trial** | the Terms say: from the day the trial starts at checkout. Commission guidance treats a free trial converting to paid as possibly two contracts, which could start a new 14-day period at conversion | counsel; the safe option is to also allow withdrawal for 14 days after the first charge |
| 4 | **Scope**: EU/EEA/UK consumers only (as written) or everyone | strictest-lawful = only where law requires; other markets have their own rules (point 8) | keep as written unless counsel advises otherwise |
| 5 | **Stripe Customer Portal: cancel at period end** | the Terms promise access until the end of the paid period | confirm in the Dashboard (test and live) |
| 6 | **Germany §312k BGB cancellation button** | if selling to German consumers, a permanently available "cancel contracts here" button on the website, without logging in | decide markets; build together with point 1 |
| 7 | **Terms on a durable medium** | the confirmation email links the Terms; some regimes expect the contract terms themselves to be provided | counsel: link vs. PDF/attached text |
| 8 | **Morocco and other markets** | Moroccan Law 31-08 has its own distance-selling withdrawal right (commonly cited as 7 days, Art. 36); not reviewed here | counsel |
| 9 | **US automatic-renewal laws** | California also requires online cancellation (Portal: yes), notices before a free trial converts and annual-renewal reminders in some cases | turn on Stripe's trial-ending and renewal reminder emails |
| 10 | **Company details** | the withdrawal section and the model form need `{{company}}`, `{{address}}`, `{{email}}` — a withdrawal notice must be addressed to a real trader | owner (section 1) |
| 11 | **Liability and governing law** | still bracketed; the liability clause must not cut into the remedies above | lawyer |
| 12 | **Stripe `consent_collection.terms_of_service`** | adds Stripe's own required Terms checkbox; needs the Terms URL in the Dashboard | optional; the app already records consent |
| 13 | **Failed confirmation emails** | logged, not resent; the customer then has no durable confirmation | accept for launch or add a retry |

The UK DMCC Act subscription-contract rules (cooling-off, reminders) were not shown to be in force when
checked; re-check before UK launch.

## 6. Deleted-email restriction (2026-10-16) — implemented locally, for counsel to confirm

What it does (`docs/account-deletion.md`): after an account is deleted, the same email address
(normalized like sign-in: lower case only; dots and `+tags` are distinct addresses) can't sign up again
for exactly 30 days from the deletion. Only an HMAC (keyed with a server secret) of the address and the
end time are kept; expired records are ignored at once and purged within hours; a failed deletion leaves
no record. Sign-up answers with a generic message that doesn't reveal the deletion or the date. The
delete screen warns before deleting, the confirmation shows the exact end time to the person who
deleted, and the Privacy Policy (Retention and deletion) and Terms (Ending your use) state the rule in all
four languages.

| # | Decision | Notes |
|---|---|---|
| 1 | **Legal basis** | proposed: legitimate interest (Art. 6(1)(f)) in preventing abuse of the free trial and allowances. A keyed hash is still personal data (pseudonymous), so the balancing test and the 30-day period should be documented. Add it to the §3 table when the legal bases are written into the policy |
| 2 | **Erasure and objection requests** | if someone asks for full erasure after deletion, does the restriction yield (Art. 17(3) / Art. 21 objection)? Support can lift it at once (`npm run account:release-email`); decide the rule |
| 3 | **What the API reveals** | the generic error has its own code (`signup_email_unavailable`), distinct from `email_taken`. The app's message reveals nothing, but someone calling the API directly can tell "can't be used now" from "has an account" — and today the only cause is a recent deletion. Fully indistinguishable would mean answering exactly like `email_taken`, which misleads the person who just deleted (they'd be told an account exists). Decide whether the current level is enough |
| 4 | **Store guidelines** | Apple 5.1.1(v) and Google Play require in-app deletion, which is unchanged; a re-registration restriction is not prohibited, but keep the warning visible before deletion |

## 7. Daily study-plan email (2026-10-16) — implemented locally, for counsel to confirm

What it does (`docs/study-reminders.md`): one email per local day (default 08:00 in the plan's time
zone) to students who have a study plan, a confirmed email address, reminders switched on (the default)
and **no** active subscription or trial. The content is today's tasks from the stored plan — no AI call,
no offers. Every email has an unsubscribe link (one-click, RFC 8058 `List-Unsubscribe`) and the app has a
switch (Account → Study reminders). The Privacy Policy's "how we use your email" sentence discloses it in
all four languages. Disabled in production until `STUDY_REMINDER_EMAILS_ENABLED=true`.

| # | Decision | Notes |
|---|---|---|
| 1 | **Default on vs. opt-in** | on by default (opt-out). If counsel classes it as direct marketing, switch the default to off (`users.study_reminder_emails` default) and ask in the app instead — the code needs no other change |
| 2 | **Legal basis** | see the §3 table; add it when the legal bases are written into the policy |
| 3 | **Minors (13–17)** | same email for every age group; confirm the balancing test |

## 8. Confirmation reminder and reactivation campaign (2026-10-19) — built, not sent; for counsel to confirm

What exists (`docs/email/verification-reminder.md`, `docs/email/reactivation-campaign.md`, `docs/email/who-we-can-email.md`): two operator-run tools, **never run by the server**, locked by separate environment switches that are off. Nothing has been sent by either.

| # | Decision | Notes |
|---|---|---|
| 1 | **Is the one-off confirmation reminder a service message?** | Engineering view: yes (same email as the disclosed confirmation link, no promotional content, once). Confirm it is outside ePrivacy Art. 13, including for accounts that predate verification (they were never asked) and for 13–17-year-olds |
| 2 | **Marketing consent** | **Implemented** (migration `0021_marketing_consent`): an unticked, optional sign-up checkbox and an Account switch, recorded with server time, wording version/language and source; the campaign requires it. Asking by email is not allowed (that is marketing). Open: the wording and the policy sentence (§9) |
| 3 | **Soft opt-in for a free sign-up** | Doubtful in Spain/France; do not rely on it without counsel |
| 4 | **Privacy policy** | Add the confirmation reminder to “account emails”; add marketing only together with the consent flow |
| 5 | **Suppression list** | `email_suppressions` keeps the **address** of anyone who bounced or complained so they are not emailed again; it is not deleted with the account. Confirm this is acceptable (legitimate interest in not re-contacting an objector) and whether to hash it |
| 6 | **Accounts that predate verification** | No age group (the question shipped with verification) and no way to set one: they can never be in an adult-only marketing audience without an in-app age prompt |

## 9. Marketing-email consent (2026-10-19) — implemented locally, for counsel to confirm

What it does (`docs/email/marketing-consent.md`): an optional checkbox, **unticked by default and not required**, above the Create account button, separate from the terms notice below it; the same wording as an Account → Emails from Exama switch. Ticking it records, server-side, the time, the **version and language of the wording shown** and the source; nothing else ever records it. It covers marketing emails only — **not** the daily study-plan email (its own switch) and not account emails.

| # | Decision | Notes |
|---|---|---|
| 1 | **Wording**, four languages (`apps/mobile/src/i18n/locales`, `marketing.statement` and `marketing.hint`, pinned to `MARKETING_CONSENT_VERSION`) | Check specificity (“tips, news about new features, offers, and invitations to come back”), that the hint line (the daily plan email is separate) may sit beside rather than inside the consent, and native-speaker quality in fr/ar/es |
| 2 | **Privacy policy** | Add the marketing consent and its withdrawal, and say the daily study-plan email is separate. Suggested sentence in `marketing-consent.md`. Not applied: legal text |
| 3 | **Minors** | The box is shown to every age group; a 13–17 consent is recorded but the campaign never emails under-18s. GDPR Art. 8 (Spain 14, France 15, default 16): hide it for minors, or record it as inert, or require parental authorisation |
| 4 | **Unconfirmed accounts** | A consent given at sign-up before the address is confirmed is recorded, but marketing also requires a confirmed address (a second step, like double opt-in) |
| 5 | **Unsubscribe semantics** | A marketing email’s unsubscribe now stops marketing only (the daily plan email is separate; the page offers to stop it too). Before, the campaign link also switched off the daily plan email. No marketing email was ever sent, so nobody relied on the old behaviour |
| 6 | **Existing accounts** | No consent; they can opt in only through the Account switch (or a future one-time in-app card). Never by email |
| 7 | **Consent log retention** | `marketing_consent_log` is kept with the account and deleted with it; decide whether proof of a withdrawal must outlive the account |

## Sources (checked 2026-10-15; consumer-law sources 2026-10-16)

- FTC, Complying with COPPA: FAQ — https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- FTC, COPPA Rule amendments (Federal Register, 2025) — https://public-inspection.federalregister.gov/2025-05904.pdf
- GDPR (Regulation 2016/679), Art. 6, 8, 13 — https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- EDPB, Contractual necessity for online services (summary of Guidelines 2/2019, March 2026) — https://www.edpb.europa.eu/system/files/documents/2026-03/edpb-summary-guidelines2-2019-contractual-necessity-online-services_en.pdf
- CNIL, Recommendation 4 (parental consent under 15) — https://www.cnil.fr/en/recommendation-4-seek-parental-consent-children-under-15
- CNIL, Sheet 16: analytics on websites and applications — https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications
- Légifrance, Loi Informatique et Libertés Art. 45 — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037823135
- AEPD, FAQ Menores y educación (LOPDGDD art. 7) — https://www.aepd.es/preguntas-frecuentes/10-menores-y-educacion
- Anthropic Privacy Center: API data retention; model training — https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data, https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- AssemblyAI, Data retention and model training — https://www.assemblyai.com/docs/data-retention-and-model-training
- Render, Postgres recovery and backups; Persistent disks — https://render.com/docs/postgresql-backups, https://render.com/docs/disks
- Stripe Privacy Policy — https://stripe.com/privacy
- Directive 2011/83/EU on consumer rights (consolidated; Art. 8, 9, 11a, 13, 14, 16, Annex I) — https://eur-lex.europa.eu/eli/dir/2011/83/oj/eng
- Directive (EU) 2023/2673 (withdrawal function, Art. 11a) — https://eur-lex.europa.eu/eli/dir/2023/2673/oj/eng
- Directive (EU) 2019/770 on digital content and digital services (remedies) — https://eur-lex.europa.eu/eli/dir/2019/770/oj/eng
- CJEU C-641/19, PE Digital (withdrawal from a service contract, proportionate amount) — https://curia.europa.eu/juris/liste.jsf?num=C-641/19
- BGB §312k (cancellation button), §356a (withdrawal function) — https://www.gesetze-im-internet.de/bgb/__312k.html, https://www.gesetze-im-internet.de/bgb/__356a.html; IHK Braunschweig, Widerrufs-Button verpflichtend seit Juni 2026 — https://www.ihk.de/braunschweig/beratung-und-service/rechtsthemen/wirtschaftsrecht-von-a-bis-z/internet-und-recht2/widerrufs-button-verpflichtend-seit-juni-2026-7103310
- California Business and Professions Code §17600–17606 (automatic renewal) — https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=7.&part=3.&chapter=1.&article=9.
