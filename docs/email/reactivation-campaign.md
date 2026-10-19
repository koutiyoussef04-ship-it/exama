# Reactivation email campaign (`reactivation-2026-10`)

Brings back accounts that never became subscribers, in two audiences:

| Audience | Who | Goal | Versions |
|---|---|---|---|
| 1. Has a study plan | at least one study plan | come back to the plan | `exam_upcoming` (nearest exam date, “in N days”), `exam_passed` (plan for the next exam) |
| 2. No study plan | no plan at all | make the first plan | `course_ready` (has a ready course: button opens plan setup for it), `no_course` (button opens the app to add the first course) |

Languages: English, Spanish (Spain), French (formal “vous”), Arabic (right-to-left). The language is the app language the app last reported, else the plan's or course's language, else English.
Two steps: step 1 now; step 2 once, 5+ days later, only for people who did not open the app, click or make a plan since. Nothing after step 2.

Code: `apps/api/src/services/reactivation-campaign.ts` (who and how), `reactivation-emails.ts` (wording), `apps/api/scripts/reactivation-campaign.ts` (operator CLI), `GET /email/click/:sendId` in `routes/email.ts`, tables `email_campaign_sends`, `email_campaign_clicks`, `email_suppressions` (migration `0020`, additive). The server never sends these by itself: only the CLI does.

## Who is emailed

All checked from the database on every run; anything unclear means no email.

- confirmed address (an unconfirmed address is never emailed by the campaign; to reach those accounts there is a separate one-off, non-marketing reminder to confirm: `verification-reminder.md`); study emails still on (`users.study_reminder_emails` — the unsubscribe link switches it off); not on the suppression list;
- adult age group (18+). Under 18 and “no age group given” are left out;
- Free and never paid (the same `billingEligibility` the daily reminders use, fail closed): no owners, nobody with access now (paid, store or web trial, cancelled but not ended), nobody who started a web checkout. Former subscribers are held out unless `--include-lapsed`;
- account at least 3 days old and no app opening in the last 7 days; no other Exama email (daily reminder, other campaign) in the last 7 days;
- a plan whose exam is today is skipped; a Free account that cannot create another plan this month does not get the “create a plan” email.

The unsubscribe link is the existing signed one-click link (RFC 8058 header plus a link in the footer). One click turns off all study emails from Exama, including the daily reminders.

## Sending safely

1. `dry-run` prints the audience counts, the exclusions and the next batch with an **approval code** that depends on the exact people in the batch and the wording version.
2. `send` needs `REACTIVATION_CAMPAIGN_SEND=true`, `--limit`, and that code. If the audience or wording changed since the dry run, the code no longer matches and nothing is sent.
3. Never twice: a row per (campaign, step, user) is claimed before the send (unique), Resend gets an idempotency key for the same triple, and each person is re-checked (still subscribed to study emails, still not a subscriber) just before their email. A crash between claim and result leaves the row “claimed”, which is never retried automatically.
4. Pace: batches of 20, 1.1 s between emails, 60 s between batches; the run stops on HTTP 401/403/429 from Resend or after 3 failures in a row. Daily cap 60 (`--max-per-day`): the Resend free plan allows 100 emails a day for everything, including password-reset and verification emails.
5. Local evening only: 17:00–21:00 in the student's own time zone (the plan's, else the device's); no known zone: 15:00–19:00 UTC. Run it in the evening and people outside the window wait for the next run.

Environment (Render → exama-api → Environment) before a send: `CAMPAIGN_SENDER_NAME`, `CAMPAIGN_SENDER_ADDRESS`, `CAMPAIGN_SUPPORT_EMAIL` (printed in every email footer; the send refuses without them) and, only for the approved run, `REACTIVATION_CAMPAIGN_SEND=true`. `API_PUBLIC_URL` or Render's `RENDER_EXTERNAL_URL`, `WEB_APP_URL`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` already exist.

## Commands

From the exama-api Shell on Render (the database only accepts connections from inside Render): `npm run campaign:reactivation:prod -w @study/api -- <command>`; locally `npm run campaign:reactivation -- <command>` in `apps/api`.

| Command | What it does |
|---|---|
| `dry-run [--step 1\|2] [--limit 5] [--list] [--any-time]` | counts, exclusions, next batch and approval code; sends nothing |
| `preview --out ./campaign-previews` | writes all 32 emails (HTML and text) |
| `send --step 1 --limit 5 --approval CODE` | sends that batch |
| `sync` | reads each email's latest status back from Resend; hard bounces and complaints are suppressed from then on |
| `report [--days 14]` | delivery, clicks, returns, plans, unsubscribes, subscriptions per step and audience |
| `suppress --email a@b.c` | never email this address |

Audience counts without deploying anything: `docs/email/reactivation-audience-counts.sql` (read-only SQL, psql).

## Suggested roll-out

1. Day 0, evening: canary of 5 (the batch is spread over audiences and languages). Next morning: `sync`, `report`. Continue only if there are no complaints, no bounce and the unsubscribe rate is under about 3%.
2. Then daily batches of up to 60 until step 1 is done. `sync` before each batch.
3. Step 2 five days after each step-1 email, with its own dry run and approval code.
4. Stop at once on any spam complaint, a bounce rate above 5%, or an HTTP error from Resend.

## Measuring

- Delivered / bounced / complained: from Resend through `sync` (Resend open and click tracking are off on `exama.app`; opens are not measured on purpose — Apple Mail pre-loads images).
- Clicks: first-party, on the email button (`/email/click/:sendId`). Requests that look like link scanners or have no user agent are counted separately, so “clicked” is a floor on people and an upper bound only when scanners are ignored.
- Returned: an app opening while signed in after the email (needs the client `app_opened` events). Plan created: a study plan created after the email. Studied: an exam or practice started. Subscribed: a subscription row created after the email. Unsubscribed: study emails switched off now.
- There is no control group, so the report shows what happened after the emails, not what they caused. With a few hundred recipients, hold out a random 10% for that.

## Legal and consent — decide before sending

The campaign sends marketing-style emails (“come back”, “create your first plan”) to people who registered and never subscribed. No marketing-consent flag exists in the database; the only email preference is `study_reminder_emails` (default on).

- **Exama’s own legal register says marketing needs consent** (`docs/legal/open-items.md` §3: “Marketing — none today … any future marketing needs consent”). No consent is recorded anywhere, so **nobody is cleared to receive this campaign today**, whatever the technical rules say. `npm run email:audiences:prod -w @study/api` shows “passes the technical rules: n” next to “cleared: none” so the two are never confused. (An earlier version of this page said audience 1 “fits” the privacy policy; that was too generous: the daily study-plan email it relies on is itself still *counsel*’s to classify as a service message, `open-items.md` §7, and a “come back” email is promotional.)
- The privacy policy currently says the address is used for account emails and for the daily study-plan email for people **with a plan and no subscription**. Neither audience is a disclosed *marketing* use.
- In Spain (LSSI art. 21) and under the ePrivacy rules, commercial email without prior consent is allowed only for similar products to existing customers, with an easy opt-out in every email. Whether a free sign-up counts is a legal question; this should be confirmed with counsel (or the data-protection adviser), and the privacy policy updated **before** anyone is emailed. The safer route is consent collected in the app (`who-we-can-email.md`, “The smallest safe changes”). Suggested sentence for “How we use it” if counsel accepts the existing-customer route:
  - EN: “If you have an account but haven’t created a study plan or come back for a while, we may send you up to two emails inviting you to use Exama. You can unsubscribe with one click in any of them or in Account.”
  - ES: «Si tienes una cuenta pero no has creado un plan de estudio o llevas un tiempo sin volver, podemos enviarte hasta dos correos invitándote a usar Exama. Puedes darte de baja con un clic en cualquiera de ellos o en Cuenta.»
  - FR : « Si vous avez un compte mais n’avez pas créé de plan de révision ou n’êtes pas revenu(e) depuis un moment, nous pouvons vous envoyer jusqu’à deux e-mails pour vous inviter à utiliser Exama. Vous pouvez vous désabonner en un clic dans chacun d’eux ou dans Compte. »
  - AR: «إذا كان لديك حساب ولم تنشئ خطة مذاكرة أو لم تعد منذ فترة، فقد نرسل إليك رسالتين على الأكثر ندعوك فيها إلى استخدام Exama. يمكنك إلغاء الاشتراك بنقرة واحدة في أيٍّ منهما أو من الحساب.»
- Legal pages are still drafts with placeholders (company name, address); the sender identity in the email footer must be the real legal entity.
- Under-18s and accounts with no age group are excluded. Deleting an account deletes its campaign rows.
