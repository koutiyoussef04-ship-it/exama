# Email verification

New accounts get a confirmation link by email right after sign-up (Resend, through the existing
`lib/mailer.ts`). Password reset is unchanged, except that a successful reset also confirms the email,
because the code was received at that address.

## Policy: grace period, enforced by the server, off by default

- Who is asked: accounts created after this feature (`users.email_verification_required = true`), and
  only while email can be sent (`EMAIL_PROVIDER` not `disabled` and a web app origin is known).
  Accounts created before are grandfathered: never asked, never restricted.
- `EMAIL_VERIFICATION_REQUIRED=false` (default): links are emailed and the app shows a banner, but
  nothing is blocked.
- `EMAIL_VERIFICATION_REQUIRED=true`: a new unconfirmed account keeps full access for
  `EMAIL_VERIFICATION_GRACE_HOURS` (default 72) after sign-up, so a student can finish onboarding and
  try a first course straight away. After that, `/documents/*` (courses, study plans, materials,
  exam and flashcard creation), `/exams/*` and `/flashcards/*` answer **403 `email_not_verified`** until
  the email is confirmed. Sign-in, `/auth/*`,
  onboarding, billing and Stripe, and account deletion keep working. The API refuses to start with
  `true` unless email is really configured (Resend in production) and a link origin is known, so
  nobody can be locked out by a missing setting.

## Links and tokens

- `<WEB_APP_URL>/verify-email#token=<43 chars>`: 32 random bytes, base64url. The token is in the URL
  fragment, which browsers never send to a server (no access or CDN logs). The page removes it from
  the address bar after reading it.
- Only `HMAC-SHA256(JWT_SECRET, token)` is stored (`email_verification_tokens.token_hash`, unique).
- A link expires after 24 hours and works once. Sending a new link expires the older ones.
- Tokens are never logged. The `log` email provider prints emails in development only (it is refused
  in production).

## API

| Endpoint | Auth | Result |
|---|---|---|
| `POST /auth/register` | – | as before; also emails the link in the background (`language` optional) |
| `GET /auth/email-verification` | session | `{ verified, verifiedAt, required, restrictedFrom, restricted }` |
| `POST /auth/email-verification/verify` `{token}` | – | 200 verified · 400 `verification_link_invalid` · 409 `verification_link_used` (`details.emailVerified`) · 410 `verification_link_expired` |
| `POST /auth/email-verification/resend` `{language?}` | session | 202 `{sent:true, retryAfterSeconds:60}` · 200 `{sent:false, retryAfterSeconds}` during the 60 s cooldown · 200 `{alreadyVerified:true}` · 429 after 5 an hour · 503 `email_send_failed` (no cooldown used) |
| `POST /auth/email-verification/request` `{email, language?}` | – | always 202 `{retryAfterSeconds}`, the same for unknown, unverified and verified addresses |

Rate limits are per IP (link checks 30 and requests 10 per 15 min) and per account (5 emails an hour),
in memory per API instance, like password reset.

## Database (migration `0012_email_verification.sql`, additive)

- `users.email_verified_at timestamptz NULL`
- `users.email_verification_required boolean NOT NULL DEFAULT false`: every existing row gets
  `false` (metadata-only on PostgreSQL 11+, no table rewrite)
- `email_verification_tokens` (id, user_id → users ON DELETE CASCADE, token_hash UNIQUE, expires_at,
  used_at, created_at) + index on user_id

## App and web

- `/verify-email` (signed in or out): "Check your email" with resend and countdown, "I've confirmed it";
  link results: confirmed, already used, expired, invalid, error with retry; signed out: request a
  new link by email.
- Course list: "Confirm your email" banner for new unverified accounts. If the server reports
  `restricted`, the course list redirects to `/verify-email`. Onboarding is still checked first and
  is unchanged.
- Translations: `verify.*`, `nav.verifyEmail`, `errors.codes.*` in en, fr, es and ar.

## Settings (API)

| Variable | Default | Notes |
|---|---|---|
| `WEB_APP_URL` | first `CORS_ORIGINS` entry | e.g. `https://app.exama.app` (https in production) |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | turn on only after confirming real delivery |
| `EMAIL_VERIFICATION_GRACE_HOURS` | `72` | 0–720 |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | existing | shared with password reset |

## Manual delivery test (real Resend, no settings changed)

The automated tests use the test mailer; they prove what is sent, not that it arrives. Real delivery
has to be checked by hand with an inbox you control. None of these steps changes a setting, and
`EMAIL_VERIFICATION_REQUIRED` stays `false` throughout.

**A. Before the release (checks the production key and sending domain today).** Password-reset codes
already go through the same mailer, key and sender (`EMAIL_FROM`) as the verification link.

1. On https://app.exama.app, choose *Forgot password?* and enter the email of your own existing account.
2. Within a few minutes, a code email from `no-reply@exama.app` should arrive. Check the spam folder too.
3. In the Resend dashboard → *Emails*, the message should show **Delivered** (not *Bounced* or *Failed*).
4. In the received email, *Show original* (Gmail) or *View source*: `SPF: PASS`, `DKIM: PASS` and,
   if a DMARC record exists, `DMARC: PASS`.
5. You don't need to use the code; it simply expires.

**B. After the release is deployed (checks the verification email itself).**

1. Sign up on https://app.exama.app with a new address you control (for example `you+exama-test1@gmail.com`),
   age group 18–24. Use a second provider too (Outlook or iCloud) if you can.
2. The "Confirm your email for Exama" email should arrive within a few minutes, in the app's language at sign-up
   (repeat once with the app set to French, Spanish or Arabic).
3. Open the link on the same device, then on a different one: the first shows *Email confirmed*,
   the second *already used* (still confirmed). The course list banner disappears.
4. Sign up once more and use *Send a new link* on the "Check your email" screen: a second email arrives;
   only the newest link works, and the button waits 60 seconds before it can be used again.
5. Resend dashboard → *Emails*: every message **Delivered**. Server logs (Render → exama-api → Logs):
   no `[email-verification]` or `[mail]` errors. Tokens never appear in the logs.
6. Delete the test accounts (Account → Delete account). Deleting starts the 30-day restriction
   (`docs/account-deletion.md`) on that exact address only — `you+exama-test2@gmail.com` and your main
   address are unaffected. To reuse the same test address sooner, lift it with
   `npm run account:release-email -w @study/api -- you+exama-test1@gmail.com` (run where the production
   `DATABASE_URL` and `JWT_SECRET` are set, e.g. the Render shell).

Turn on `EMAIL_VERIFICATION_REQUIRED` only after A and B pass, and announce it first.

## Audit of the current behaviour (2026-10-16, no settings changed)

Read from the code in this working tree, `render.yaml` and the Render deploy list (read-only); confirmed by
the 15 tests in `email-verification.test.ts` and `email-verification-enforced.test.ts` (all pass).

**Production today:** exama-api runs commit `f2a3190` ("add personalized student onboarding", deployed
2026-10-15), which predates email verification. **No verification email is sent and nothing is restricted
in production** until the combined release is deployed.

**After the combined release, with the settings in `render.yaml`** (`EMAIL_PROVIDER=resend`,
`EMAIL_FROM=Exama <no-reply@exama.app>`, `CORS_ORIGINS=https://app.exama.app`; `WEB_APP_URL` and
`EMAIL_VERIFICATION_REQUIRED` not set):

| Question | Behaviour |
|---|---|
| Who is asked | accounts created after the release only (`email_verification_required` is set at sign-up; the migration gives every existing account `false`). Re-registering after the 30-day restriction creates a new account, which is asked |
| When the email is sent | right after sign-up, in the background, in the app language (en/es/fr/ar). Sign-up never waits for it or fails because of it |
| Link | `https://app.exama.app/verify-email#token=…` (from `CORS_ORIGINS`, as `WEB_APP_URL` is unset). Opens in the browser, signed in or not, on any device |
| Token | 32 random bytes; only an HMAC is stored; valid 24 h; single use; a newer link expires older ones; never logged |
| Resend | signed in: 60 s cooldown, 5 an hour per account, 10 requests / 15 min per IP; signed out: same answer for any address |
| What the student sees | a "Confirm your email" banner on the course list until confirmed. **Nothing is blocked**: `EMAIL_VERIFICATION_REQUIRED` is unset → `false`, so `restrictedFrom` is null and `restricted` is always false |
| If set to `true` later | after 72 h (`EMAIL_VERIFICATION_GRACE_HOURS`), `/documents*` (courses, materials, study plans, exam creation), `/exams/*` and `/flashcards/*` answer 403 `email_not_verified`; the course list redirects to the verification page. Sign-in, account, onboarding, billing and account deletion keep working. The API refuses to start with `true` unless Resend is configured and a link origin is known |
| Other ways to verify | a successful password reset also confirms the email (the code proved access to the inbox) |
| Email fails to send | logged without the address or token; the unused link is removed so the student can ask again at once; resend answers 503 `email_send_failed` |
| If email is turned off | `EMAIL_PROVIDER=disabled` (or no link origin): nobody is asked, no banner, nothing restricted |

**Gaps and caveats (none blocks the release):**

1. Real delivery through Resend has not been verified by us — run checks A and B above.
2. Rate limits and the signed-out cooldown are in memory per API instance: they reset on every deploy or
   restart, and would multiply if the API ran more than one instance (it runs one today).
3. There is no way to change an account's email address, so there is no re-verification flow.
4. The verification state is not shown on the Account screen (only the course-list banner).
5. `WEB_APP_URL` is implicit (taken from `CORS_ORIGINS`); setting it explicitly to `https://app.exama.app`
   on Render would remove the dependency on the order of `CORS_ORIGINS`. Not changed.
