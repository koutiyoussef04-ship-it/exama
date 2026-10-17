# Daily study reminder emails

One short email a day that brings a **free student who has never paid** back to their course. It replaces the
app's on-device notifications (retired: the app cancels any it scheduled earlier the next time it starts).

**No AI is used.** The email is built from data already stored: the plan's tasks for today (the same
deterministic re-plan that opening the plan runs, `apps/api/src/services/planner/schedule.ts`), the focus notes
saved when the plan was created, and the course title. Tested by making every AI call throw while the email is built.

Code: `apps/api/src/services/study-reminders.ts` (selection, content, sending),
`apps/api/src/routes/email.ts` (preferences, unsubscribe), app: `apps/mobile/src/components/reminders.tsx`
(Account → Study reminders), `apps/mobile/src/app/unsubscribe.tsx` (the page the email links to),
`apps/mobile/src/app/_layout.tsx` (reports the device time zone with `app_opened`).
Tests: `apps/api/test/study-reminders.test.ts`, `apps/mobile/test/reminders.test.ts`.

## Who gets it

All of these must hold, checked on the server at every run:

| Condition | Source |
|---|---|
| confirmed email address | `users.email_verified_at` |
| reminders switched on | `users.study_reminder_emails` (default on; off from the email's unsubscribe link or the app) |
| **exactly one course** — none or several: no email | `documents` (all of the account's courses, counted like the Free plan's course limit) |
| **Free plan, never paid, not on a trial** | `billingEligibility()`: **no `subscriptions` row in any state** (active, trialing, cancelled or expired; Stripe, Apple, Google or mock), **no `stripe_customers` row**, not an owner account, and the entitlement is plain Free. Any error while checking → no email |
| a known local time zone | the plan's time zone, else the device time zone the app last reported (`app_opened.time_zone`); none → no email |

Why so strict (fail closed): `subscriptions` holds **one row per account that is overwritten in place** — it
is the only local record of paid plans and trials, from every store. A cancelled or expired row can't prove
that no payment ever happened, so any row excludes the account for good, including a trial that ended without
paying. A `stripe_customers` row means a web checkout was started; whether it was paid can't be ruled out
from local records (e.g. a missed webhook), so it excludes the account too. Nothing the client sends is used
for this. The same check decides `sentToThisAccount` in `GET /email/preferences` (the app hides the switch
for accounts that never get the email).

## Two emails

- **The course has a study plan** → today's pending tasks per the plan (activity, topic, minutes), days until
  the exam, up to two stored focus notes and a link to the plan (`<WEB_APP_URL>/plan/<courseId>`). A day with
  nothing pending (rest day, all done, exam passed) is recorded as `skipped` and sends nothing.
- **No study plan** → a short nudge to come back to the course (`<WEB_APP_URL>/documents/<courseId>`) and,
  only while the Free plan still allows a study plan this month, a link to create one
  (`<WEB_APP_URL>/plan/setup?id=<courseId>`). No tasks are made up. A course that isn't ready (processing or
  failed) is recorded as `skipped`.

Both: HTML and plain text, course titles and notes HTML-escaped, absolute links built from `WEB_APP_URL`
(validated as an absolute origin, https in production), unsubscribe link and headers. **No offers, prices,
trial or upgrade prompts.**

**Language:** the app language the app last reported (`app_opened.app_language`), else the plan's language,
else the course's language, else English. en, es, fr, ar (Arabic right-to-left).

## When, and only once

- Sent from `STUDY_REMINDER_LOCAL_HOUR` (default **08:00**) local time: the plan's time zone (its "today" is
  computed there), else the device time zone from `app_opened`. With no valid zone the email is never sent — we
  can't know it's 08:00 there. The "day" is the student's local date in that zone.
- **At most one email per student per local day.** Before sending, the run claims the day in
  `study_reminder_emails` (primary key user + local date, `insert … on conflict do nothing`), so overlapping
  runs or two API instances during a deploy cannot both send. Resend also gets an `Idempotency-Key`
  (`study-reminder/<userId>/<date>`), so a retried request is not delivered twice.
- A failed send (provider error) is retried on the next runs, **at most 3 attempts** a day; then it gives up
  until tomorrow. Log rows are purged after 14 days and deleted with the account.
- Scheduler: **in the API process**, every 15 minutes (`startStudyReminders()` in `src/index.ts`, like the
  media purge). No queue or extra service. It needs an always-on instance — exama-api is (paid Render plan).

## Turning it off

- **Unsubscribe link** in every email → `<WEB_APP_URL>/unsubscribe#token=…`: a page that confirms, no sign-in
  needed. The token is `<userId>.<HMAC(JWT_SECRET)>` and only turns this email off for that account.
  The token sits in the URL fragment, so it isn't sent to the static host or kept in its logs.
- **One-click** (RFC 8058): `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, pointing
  at `POST <API>/email/unsubscribe?token=…`. Only added when the API has a public https origin
  (`API_PUBLIC_URL`, or Render's `RENDER_EXTERNAL_URL`). A `GET` of that URL only redirects to the
  confirmation page — opening a link (or a link scanner) never unsubscribes.
- **In the app:** Account → Study reminders (switch). Signed-in API: `GET/PATCH /email/preferences`.

## Configuration (apps/api)

| Variable | Default | Meaning |
|---|---|---|
| `STUDY_REMINDER_EMAILS_ENABLED` | `false` | master switch; nothing is sent until `true` |
| `STUDY_REMINDER_LOCAL_HOUR` | `8` | local hour (0–23) from which the day's email goes out |
| `API_PUBLIC_URL` | — | public https origin of the API for one-click unsubscribe, e.g. `https://api.exama.app`; falls back to `RENDER_EXTERNAL_URL` |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | — | the existing email set-up (`docs/email-verification.md`) |
| `WEB_APP_URL` | first `CORS_ORIGINS` entry | origin of the app, for the plan and unsubscribe links |

Missing configuration never crashes the API: when the switch is on but the email provider is disabled or
`WEB_APP_URL` is unknown, the first run logs one actionable error (`[study-reminders] not sent: …`) and the
job sends nothing.

## Production set-up (manual, not done)

1. Deploy the API (no new migration; `0016_study_reminder_emails` is already in production), then the app
   (it reports the device time zone; older app builds don't, so no-plan students on them get no email).
2. Make sure Resend is live (verified domain, `EMAIL_PROVIDER=resend`, key, `EMAIL_FROM`) — see
   `docs/email-verification.md`.
3. Set `API_PUBLIC_URL=https://api.exama.app` (optional on Render) and then `STUDY_REMINDER_EMAILS_ENABLED=true`.
4. Watch the logs the next morning (`[study-reminders] sent N, failed N, …`).
5. Legal: the Privacy Policy discloses the email; the basis and the default-on choice are in
   `docs/legal/open-items.md` §7 for counsel.
