# How Exama classifies its emails (2026-10-19)

Engineering review, written from the code as it is. It is **not legal advice**: every point marked *counsel* needs the legal adviser the register (`docs/legal/open-items.md`) already asks for. Nothing below says a message is lawful; it says how the code treats it and why, and what is still open.

## Short version

Three kinds of email, three **independent** controls. Changing one never changes another (each row is tested).

| Kind | Examples | Needs consent? | Control the person has | Off switch affects |
|---|---|---|---|---|
| **1. Account emails** (transactional) | confirmation link, new link, password-reset code, web-subscription confirmation, the one-off confirmation reminder | no | none: they are how the account works | nothing else; no preference or consent gates them |
| **2. Study reminder emails** | “Today’s study plan: …”; “Pick up where you left off: …” | **not asked today** (on by default, opt-out). Classification **open** (*counsel*), and the two emails in it are **not** alike — see below | Account → Study reminders (switch); the unsubscribe link in each email | study reminder emails only |
| **3. Marketing emails** | the reactivation campaign (tips, news, offers, invitations to come back) | **yes, explicit and recorded** (`marketing-consent.md`) | the sign-up checkbox, Account → Emails from Exama (switch), the unsubscribe link in each email | marketing only; never account emails, never study reminders |

What each control does and does **not** do (tests in `apps/api/test/marketing-consent.test.ts`, `study-reminders.test.ts`, `reactivation-campaign.test.ts`):

| Action | Changes | Does not change |
|---|---|---|
| Marketing unsubscribe link, or Account switch off | marketing consent (withdrawn at once, even for emails already selected: re-checked before each send) | study reminder switch; account emails |
| Study-reminder unsubscribe link, or Account switch off | the study reminder switch | marketing consent; account emails |
| “Stop my study reminder emails too” (`category=all`), an explicit second choice on the unsubscribe page | both of the above | account emails |
| Ticking the sign-up box, or never ticking it | marketing consent only | study reminders (on either way), account emails |
| Confirming the address, signing in, activity | nothing | consent, preferences |

Account emails are never suppressed by either setting (tested: with marketing withdrawn and study reminders off, a password-reset code is still sent).

## How each message was judged

Not by its label. By what it actually is:

1. **Trigger**: something the person did or asked for (made a plan, asked for a code), or something the server decided on its own?
2. **Content**: information from the person’s own data that they are using, or a promotion — a feature pitch, an offer, an upgrade, a reason to come back?
3. **Who is picked**: everyone who has the thing the email is about, or a commercial segment?
4. **Expectation**: what the person was told, where, and when (sign-up, plan creation, privacy policy).
5. **Control**: can they stop it in one step, and does stopping it do only what they expect?

General frame (*counsel* to confirm for Exama’s markets): ePrivacy Directive art. 13 and, in Spain, LSSI arts. 20–22 treat **commercial communications / direct marketing** by email as needing prior consent (with a narrow existing-customer exception for similar products and an easy refusal in every message), while a message that only delivers what the person asked the service to do is generally outside that rule; GDPR art. 6 (basis), art. 13 (what the person is told) and art. 21 (right to object to direct marketing) apply to the data use either way. Whether a *reminder* is a service message or a promotion depends on the factors above, not on the word “reminder”.

## The messages

| # | Email | Trigger | Content | Who gets it | Control | Engineering class | Legal review? |
|---|---|---|---|---|---|---|---|
| A1 | Confirmation link (sign-up) | sign-up | the link, nothing else | the new address | — | account | no, beyond the policy sentence already there |
| A2 | “Send me a new link” | the person | same | same | — | account | no |
| A3 | Password-reset code | the person | the code | the address asked about | — | account | no |
| A4 | Web-subscription confirmation | a subscription | plan, price, trial end, withdrawal terms | the subscriber | — | account (information the person must receive) | no |
| A5 | **Confirmation reminder** (one-off, operator CLI, never run by the server) | operator, for unconfirmed accounts | the same confirmation email with a reminder sentence, no other content | unconfirmed addresses, once; vetted | — | account (completes a sign-up the person began) | **yes, medium**: sent unprompted, including to accounts that predate verification (never asked) and possibly to 13–17-year-olds (register §8.1) |
| S1 | **“Today’s study plan: …”** | the student made a plan (a dated list of tasks) | that day’s tasks and focus notes **from their own plan**; no offers, prices or upgrade prompts; unsubscribe in the footer and header | Free, never-paid accounts with exactly one course and a plan | Account → Study reminders; unsubscribe link; **on by default** | study reminder, nearest to a service message (content the person created and uses) | **yes, medium**: (a) on by default, not asked for at plan creation; (b) only to never-paid accounts — a paying student’s plan would be as useful, so the segment looks commercial; (c) disclosed in the policy, but check the wording is enough (register §7) |
| S2 | **“Pick up where you left off: …”** | **the server’s own decision**: the account has one ready course and **no study plan** | “Your course is waiting”, a button back to the course, and (while the Free plan allows) a **pitch for a feature** (“Have an exam coming up? A study plan spreads …” + “Create a study plan”) | the same Free, never-paid accounts, **every local day**, with **no end and no check that the person has been inactive** | Account → Study reminders; unsubscribe link; **on by default** | **re-engagement; not a service message on the facts above.** Server-initiated, promotes use of the product and one of its features, repeats daily without limit, aimed at non-paying accounts. The subject says “where you left off” but nothing checks that they left anything | **yes — highest priority** (see below) |
| M1 | **Reactivation campaign** (`reactivation-2026-10`) | operator CLI, never by the server | “come back”, “make your first plan”, up to two emails | accounts with **explicit marketing consent**, confirmed, adult, Free, inactive 7 days, not suppressed | marketing unsubscribe link; Account switch | **marketing** | **yes**: the consent wording, the privacy-policy sentence, minors, sender identity (`marketing-consent.md`) |
| — | Trial-ending and receipt emails | Stripe | — | subscribers | Stripe | sent by Stripe, not by this code (register §6) | outside this review |

### S2 in detail: the message most likely to be classed as marketing

What the code does today (`study-reminders.ts`, `runStudyReminders`; confirmed in production logs: the daily run is on and sending since 2026-10-18):

- **Not tied to an unfinished exam or to a request.** There is no check that the student started an exam, practice set or plan. The trigger is only: confirmed address, switch on (default), Free and never paid, exactly one course, no plan, course ready.
- **Daily, no end.** One per local day (08:00 local or later) until the student makes a plan, adds a second course, pays, or switches it off. No cap on the number, no “stop after N”.
- **No inactivity condition.** A student who studied this morning gets it too.
- **A feature pitch inside.** The second paragraph promotes study plans.
- **Not what the control says.** The Account switch is labelled “Daily plan email” and describes “an email with what your study plan has for that day”. The no-plan email is not that. The privacy policy likewise discloses a daily email “if you have a study plan and no subscription”; accounts with **no** plan receive an email the policy does not describe.

None of this makes S2 unlawful by itself — that is for counsel. But on the factors above it looks like re-engagement, and the existing opt-out default and disclosure were written for S1, not for it. **It has been live in production since 2026-10-18** (not changed by this work).

Options, for the owner to choose (not applied):

1. **Treat S2 as marketing.** It would then need marketing consent and the marketing unsubscribe, and S1 alone stays under the study switch. Smallest change that matches the classification; one extra condition in the selection plus the footer links; users who ticked the box (or switched it on) would still get it.
2. **Make it a real study reminder.** Send it only after something the student did and asked for — for example an exam or practice set **started and not finished** (“Continue your exam: …”), once, with no feature pitch — and say so in the policy and the switch description. This is the “continue where you left off” email in its legitimate form. Not built.
3. **Pause S2 until counsel has seen it** (a flag to turn only this variant off; S1 continues). Least risky while the question is open.
4. **Leave it.** Then correct the policy sentence and the Account switch description so they describe it, and decide on default-on.

Whatever is chosen, the two controls stay independent.

## Wording consequences (done)

The sign-up checkbox, the unsubscribe page and the campaign footer now say **“study reminder emails”** (the name of the Account setting) and not “daily study-plan email”, because the second email in that category is not a plan email. The consent wording is still version `2026-10-v1`: the hint line was corrected **before** the first release (no consent had been recorded), so one version still means one text. The hash test (`apps/mobile/test/marketing-consent.test.ts`) pins it.

## What changed in the code because of this review

- The campaign no longer reads the study-reminder switch: before, switching study reminders off silently removed a person who had said yes to marketing (`opted_out`). It is removed from the audience, the last-moment re-check and the exclusion list; the campaign depends only on marketing consent, a confirmed address and its own safety rules.
- The campaign `report` counted “unsubscribed” as “study switch off”. A marketing unsubscribe would have read as 0, hiding exactly the signal the roll-out watches. It now counts a withdrawal of marketing consent after the send (from `marketing_consent_log`, or consent gone).
- Tests added for: study reminders needing no marketing consent (both emails, accounts that never consented and accounts that withdrew); the study switch not touching consent and the reverse; a study reminder never granting, refreshing or withdrawing consent; account emails unaffected by both settings; the campaign ignoring the study switch.

## Open items for counsel (from this review)

1. **S2** as above: classification, default-on, frequency, the pitch, the missing disclosure, the Account switch description.
2. **S1**: default-on vs opt-in (register §7.1), the never-paid-only segment, the legal basis wording.
3. **A5**: the confirmation reminder as a service message (register §8.1).
4. **M1 and the consent wording** in four languages; the privacy-policy sentence (`marketing-consent.md`).
5. **Minors**: S1 and S2 go to every age group; marketing consent is recorded for 13–17 but the campaign never emails them.
6. A possible future **“continue your unfinished exam”** email (option 2) would need its own review before it is built.
