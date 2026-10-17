# Daily study-plan emails

One short email a day that tells a student what their study plan has for today. It replaces the app's
on-device notifications (retired: the app cancels any it scheduled earlier the next time it starts).

**No AI is used.** The email is built from data already stored: the plan's tasks for today (the same
deterministic re-plan that opening the plan runs, `apps/api/src/services/planner/schedule.ts`) and the focus notes
saved when the plan was created. Tested by making every AI call throw while the email is built.

Code: `apps/api/src/services/study-reminders.ts` (selection, content, sending),
`apps/api/src/routes/email.ts` (preferences, unsubscribe), app: `apps/mobile/src/components/reminders.tsx`
(Account → Study reminders), `apps/mobile/src/app/unsubscribe.tsx` (the page the email links to).
Tests: `apps/api/test/study-reminders.test.ts`, `apps/mobile/test/reminders.test.ts`.

## Who gets it

All of these must hold:

| Condition | Source |
|---|---|
| has at least one study plan whose exam has not passed, with pending tasks today | `study_plans`, `study_tasks` |
| **no active subscription and no running trial** | the server entitlement (`getEntitlement`: paid, trial or owner access are excluded) — checked at send time, so a student who subscribes stops getting it the same day and gets it again if the subscription ends |
| confirmed email address | `users.email_verified_at` (unconfirmed addresses never get it) |
| reminders switched on | `users.study_reminder_emails` (default on; off from the email's unsubscribe link or the app) |

A day with nothing planned (all done, a rest day) is recorded as `skipped` and sends nothing.

## When, and only once

- Sent from `STUDY_REMINDER_LOCAL_HOUR` (default **08:00**) in the plan's own time zone — the device zone
  saved with the plan. With several plans, the most recently updated plan's zone; **UTC** if none is valid.
  The "day" is the student's local date in that zone.
- **At most one email per student per local day.** Before sending, the run claims the day in
  `study_reminder_emails` (primary key user + local date, `insert … on conflict do nothing`), so overlapping
  runs or two API instances during a deploy cannot both send. Resend also gets an `Idempotency-Key`
  (`study-reminder/<userId>/<date>`), so a retried request is not delivered twice.
- A failed send (provider error) is retried on the next runs, **at most 3 attempts** a day; then it gives up
  until tomorrow. Log rows are purged after 14 days and deleted with the account.
- Scheduler: **in the API process**, every 15 minutes (`startStudyReminders()` in `src/index.ts`, like the
  media purge). No queue or extra service. It needs an always-on instance — exama-api is (paid Render plan).

## Content

Subject and body in the plan's language (en, es, fr, ar — Arabic right-to-left): today's tasks per course
(activity, topic, minutes), days until each exam, up to two stored focus notes per course, a link to the
plan, and the unsubscribe link. HTML and plain text; course titles and notes are HTML-escaped. No offers,
prices or upgrade prompts.

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

1. Deploy the API with migration `0016_study_reminder_emails` (runs with the existing migrate step).
2. Make sure Resend is live (verified domain, `EMAIL_PROVIDER=resend`, key, `EMAIL_FROM`) — see
   `docs/email-verification.md`.
3. Set `API_PUBLIC_URL=https://api.exama.app` (optional on Render) and then `STUDY_REMINDER_EMAILS_ENABLED=true`.
4. Watch the logs the next morning (`[study-reminders] sent N, failed N, …`).
5. Legal: the Privacy Policy discloses the email; the basis and the default-on choice are in
   `docs/legal/open-items.md` §7 for counsel.
