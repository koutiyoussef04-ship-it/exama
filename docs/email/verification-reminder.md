# Verification reminder (`verification-reminder-2026-10`)

Reaches accounts whose email address was never confirmed, with **one** reminder to confirm it. It is the way back to those people: the reactivation campaign (`reactivation-campaign.md`) only ever emails confirmed addresses, and that stays true.

## What it is, and what it is not

- It is the sign-up email again, as a reminder: same button, same link (`<web app>/verify-email#token=…`), same single-use 24-hour token. One sentence, the link, the expiry note, and the words “this is the only reminder we’ll send”. No study plan, no offer, no “come back”, no unsubscribe footer (it is an account message, sent once per account).
- It is **not marketing** and it does **not** touch the marketing consent question: nobody becomes eligible for the campaign by receiving it. Verification stays mandatory and is never granted by the tool. Only the student opening the link marks the address confirmed (`users.email_verified_at`), through the existing endpoint.
- English, Spanish (Spain), French and Arabic (right-to-left), in the app language the app last reported, else English. Wording version `2026-10-v1`.

Code: `apps/api/src/services/verification-reminders.ts` (who and how), `sendVerificationReminder` and the wording in `apps/api/src/services/email-verification.ts` (token, cooldown, send), `apps/api/scripts/verification-reminders.ts` (operator CLI). Reminders are recorded in `email_campaign_sends` (campaign `verification-reminder-2026-10`, segment `unverified`); **no migration**. Nothing under `src/` imports the tool, so the server, the scheduler and the pre-deploy migration can never send one: **deploying sends nothing** (a test enforces it).

## Existing protections it reuses (read from the code, not copied)

| Protection | Where | Effect on a reminder |
|---|---|---|
| Token: 32 random bytes, only an HMAC stored, single use, **24 h** expiry, a newer link expires older ones | `issueToken` | every reminder is a new token; the sign-up link is already expired or replaced |
| **60 s cooldown** per account, stored in `email_verification_tokens.created_at` (holds across processes) and serialised with an advisory lock | `issueToken` | a link issued a moment ago blocks the reminder; nothing is sent |
| **5 emails an hour** per account (in memory, per process) | `emailLimiter` | applies inside the CLI process; the one-per-account rule is what really bounds it |
| A failed send deletes the new token | `sendVerificationReminder` | no orphan link; the claim becomes `failed` and a later run retries (3 attempts) |
| Verification is optional until `EMAIL_VERIFICATION_REQUIRED=true` and the 72 h grace ends | `stateOf` | the reminder changes none of this |

Added by the reminder: one row per account **across all reminder campaigns** (unique claim before the send, Resend idempotency key `campaign/step/user`, last-moment recheck that the account is still unconfirmed, has no link from the last 24 h and was not reminded), a daily cap shared with the reactivation campaign (default 20; Resend’s free plan allows 100 for everything), batches of 20 with 1.1 s gaps and 60 s pauses, stop on HTTP 401/403/429 or 3 failures in a row, its own lock `VERIFICATION_REMINDER_SEND=true` (the reactivation switch does not unlock it) and an approval code tied to the exact batch.

## Who gets it

All read from the database on every run; anything unclear means no email.

| Rule | Reason |
|---|---|
| address **not** confirmed | the whole point; confirmed accounts are never touched |
| asked at sign-up (`email_verification_required`) | accounts that predate verification were never asked; they are **held out unless `--include-legacy`** |
| not on `email_suppressions` | bounces, complaints, manual |
| no earlier Exama email to the address bounced, was reported or was suppressed, **from Resend’s own delivery log** (`GET /emails`) | the sign-up email stores no Resend id, so the log is the only source for its outcome. A second email to a bounced address only adds a bounce, and this account sends very few emails. If the log cannot be read, **a send refuses** (the dry run says so) |
| account older than 24 h and younger than `--max-age-days` (30) | the sign-up link has had its day; no surprise email about an old account |
| no verification link sent in the last 24 h | the student may be about to use it, or just asked for a new one |
| never reminded (any `verification-reminder-*` campaign) | one per account, ever |
| local daytime (09:00–20:00 in the time zone the app reported; unknown: 08:00–19:00 UTC) | an account message, not the campaign’s evening window; `--any-time` overrides |

Age does **not** gate it (it is the same account message a 13–17 sign-up already got), but the dry run reports how many unconfirmed accounts are adult, under 18 or without an age group, because only confirmed adults can ever join the campaign.

## Which people are legally eligible for what

This is the engineering position, not legal advice; the open points need the legal adviser the campaign runbook already asks for.

| Group | Verification reminder | Reactivation campaign |
|---|---|---|
| Unconfirmed, asked at sign-up | **Yes** (default): a service message about the account they created, to the address they gave, no marketing content, once | **No**, never: an unconfirmed address is not proven to belong to the person |
| Unconfirmed, predates verification | **Operator’s decision** (`--include-legacy`): same message, but they were never asked before. Reasonable for recent sign-ups; leave out if in doubt | **No** until they confirm |
| Confirmed adult with a plan | not applicable | existing rules; purpose already in the privacy policy (daily study-plan email) |
| Confirmed adult without a plan | not applicable | **blocked on the legal decision** in `reactivation-campaign.md` (not in the privacy policy yet) |
| Under 18, or no age group | allowed (account message) | **never** |
| Bounced, complained, suppressed | **never** | **never** |

Two things to know before sending:

1. **Confirming has a side effect the email does not mention:** a confirmed account with a study plan and a Free plan becomes eligible for the existing daily study-plan email (already disclosed, one-click unsubscribe). Confirmation is not marketing consent; the campaign’s own conditions still apply afterwards, and an account that just got the reminder is held out of the campaign for 7 days (frequency cap).
2. A reminder can still reach someone who mistyped their address at sign-up. That is the risk the original email already carries; it is why there is one reminder, no marketing content, and the bounce check.

## Commands

From the exama-api Shell on Render (the database only accepts connections from inside Render): `npm run campaign:verification-reminder:prod -w @study/api -- <command>`; locally `npm run campaign:verification-reminder -- <command>` in `apps/api`.

| Command | What it does |
|---|---|
| `dry-run [--limit 5] [--max-age-days 30] [--include-legacy] [--any-time] [--list]` | counts, exclusions, Resend delivery log summary, what each person would get, next batch and approval code; sends nothing |
| `preview --out ./reminder-previews` | writes the email in the four languages (placeholder link) |
| `send --limit 5 --approval CODE [--include-legacy]` | sends that batch; needs `VERIFICATION_REMINDER_SEND=true` |
| `sync` | reads each reminder’s status back from Resend; every address Resend recorded a bounce or complaint for (any Exama email, including the sign-up email) goes on the suppression list |
| `report` | sent, delivered, bounced, complaints, confirmed after the reminder, still unconfirmed |

Suggested order: `dry-run` (read the numbers) → `sync` (puts earlier bounces on the suppression list) → `dry-run` again → `send --limit 5` for the first batch → next day `sync`, `report` → continue only if nothing bounced.

## What a send needs (it never sends by itself)

1. The code is deployed. That alone sends nothing.
2. You run `dry-run` and read it.
3. You run `send` with `VERIFICATION_REMINDER_SEND=true` set for that command only, `--limit`, and the approval code from the dry run. If the audience or wording changed since, the code no longer matches and nothing is sent.

`REACTIVATION_CAMPAIGN_SEND` stays unset; it is a different switch for a different tool.
