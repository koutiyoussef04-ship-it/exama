# Exama — data inventory & App Privacy checklist (internal)

Audited against the code on 2026-09-27 (updated for lecture audio/video and Google Play Billing on Android; on 2026-10-15 for onboarding answers, email verification, the sign-up age group and flashcards; on 2026-10-16 for the web checkout consents, the subscription confirmation email and the 30-day deleted-email restriction). Update this file, the Privacy Policy (`apps/mobile/src/i18n/legal.ts` → `docs/legal/`) and the App Store privacy answers together whenever data handling changes.

## 1. What is collected, where it lives, why

| Data | Source | Stored where | Purpose | Deleted when |
|---|---|---|---|---|
| Email, first name | sign-up form | `users` (Postgres) | account, sign-in, support | account deletion |
| Password | sign-up form | `users.password_hash` — **bcrypt hash only** (cost 12) | sign-in | account deletion |
| Password reset codes | API (sent by email) | `password_reset_codes` — **HMAC of the 6-digit code only**, expiry (30 min), attempts, used time | resetting a forgotten password | used/expired codes are replaced by the next request; account deletion (cascade) |
| Age group (13–17, 18–24, 25–34, 35+) | sign-up form (required; minimum age 13) | `users.age_range` (CHECK constraint; NULL for accounts created before it was asked) | checking the minimum age; never in analytics, `User` responses, prices or limits | account deletion |
| "Under 13" answer at sign-up | sign-up form | **not stored or sent**: the app stops locally; it keeps only a timestamp (`signup_age_block_until`, device storage, 24 h) so the form isn't offered again right away. The API refuses `under_13` (403) before reading or writing anything | minimum age (FTC COPPA FAQ H.3: neutral screen, no back-buttoning) | after 24 h / uninstall |
| Email confirmation status; verification links | API | `users.email_verified_at`, `users.email_verification_required`; `email_verification_tokens` — **HMAC of the token only**, expiry (24 h), used time | confirming the email address | links: replaced by newer ones; account deletion (cascade) |
| Onboarding answers (field of study, exam timing, main goal, usual material, confidence) — optional | user | `user_onboarding` (fixed option ids only) | personalising the first steps; analytics categories (`onboarding_completed`) | account deletion (cascade) |
| Flashcards (question, answer, topic, source quote) and review progress (per-card results, round) | AI + user | `flashcard_decks`, `flashcards` | flashcards feature | deck / course / account deletion (cascade) |
| Deleted-email restriction | API, at account deletion | `deleted_email_holds` — **HMAC (keyed with JWT_SECRET) of the email only**, normalized like sign-in (lower case), and the exact end time; no address, name, user id or IP | stops the same address signing up again for 30 days (another free trial, fresh allowances) | ignored exactly 30 days after the deletion, purged within 6 hours; support can lift it early (`npm run account:release-email`) |
| Password change time | API | `users.password_changed_at` | invalidating older sessions after a reset | account deletion |
| Session token (JWT, 30 days) | API | device Keychain/Keystore (`expo-secure-store`); not stored on the server | stay signed in | sign-out / account deletion (server rejects tokens of deleted accounts) |
| Uploaded PDFs and PowerPoint files (.pptx) | user | server file storage `STORAGE_DIR/<userId>/<docId>.pdf` / `.pptx` | processing | course deletion / account deletion (whole user folder) |
| Extracted text chunks (PDF pages / slides incl. speaker notes), summary, topics, detected material language | PDF/PPTX + AI | `documents`, `document_chunks` | exams, practice, grounding checks | course / account deletion (cascade) |
| Lecture recordings (audio/video) and extra PDFs/PowerPoints added to a course | user | server file storage `STORAGE_DIR/<userId>/materials/<id>.upload` | transcription / text extraction | **audio/video: deleted right after transcription**; failed uploads after `MEDIA_FAILED_RETENTION_DAYS` (7); extra PDFs with the material/course/account |
| Lecture transcripts (timestamped text), structured knowledge (topics, key points, definitions, examples, exam concepts), duration, detected spoken language, file title | provider + AI | `document_chunks` (`material_id`), `course_materials` | exams, practice, planner, material screen | material / course / account deletion (cascade) |
| Questions, source quotes, answers, scores, feedback, topic mastery | AI + user | `exams`, `questions`, `answers`, `topic_mastery` | study features, progress | course / account deletion (cascade) |
| Study plans: exam date/time, minutes per day, preparedness, study weekdays, unavailable dates, device time zone, AI topic notes; daily tasks with status and timestamps | user + planner | `study_plans`, `study_tasks` | study planner | plan deletion, course deletion or account deletion (cascade) |
| Subscription state (plan, status, dates, provider, environment, Apple `originalTransactionId` or Google Play purchase token) | billing provider | `subscriptions` | entitlements | account deletion (cascade) |
| Usage ledger (counts of uploads/exams/practice questions/lecture uploads, lecture minutes) | API | `usage_ledger` | plan limits; deleting a course does **not** refund usage | account deletion (cascade) |
| Course creation record: user id, course id, time (no file, title or content) | API | `course_creations` | the Free plan's one course per account (kept when the course is deleted; removed if a course whose processing failed is deleted) | account deletion (cascade) |
| Product analytics events | app + API | `analytics_events` | product improvement, funnel, monetization reporting | on account deletion: `user_id` and the install id are removed (events stay anonymous) |
| AI usage record per AI call: user id, feature (e.g. exam generation), provider, model, token counts, latency, success/error category, estimated cost and price-table version — **no prompts, document text or AI output** | API | `ai_usage` | cost monitoring in the owner dashboard; abuse/anomaly detection | on account deletion: `user_id` is removed (the row stays anonymous) |
| Owner dashboard access log: owner account id, endpoint, customer id viewed, filter parameters (search text stored only as its length), allowed/refused, status, time | API | `admin_audit_log` | security audit of who looked at customer data | on account deletion: the viewed customer's id is removed; retention period still to be decided (§6) |
| Language preferences (app language, study language), RTL flag | user | device only (Keychain/Keystore; localStorage on web) | UI language, AI output language | uninstall |
| Daily study-plan email preference (on/off; on by default, sent only once the email address is confirmed) | user | `users.study_reminder_emails` | daily study-plan email (`docs/study-reminders.md`) | account deletion |
| Daily study-plan email log: user id, local date, status (claimed/sent/failed/skipped), attempt count, time — **no email address and no email content** | API | `study_reminder_emails` | at most one email per student per local day; retry after a failed send (max 3) | purged after 14 days; account deletion (cascade) |
| Marketing-email consent (optional): when given (server time), the version and language of the wording shown, where (sign-up or Account) — **empty for everyone who never said yes, and for every account created before it was asked** (`docs/email/marketing-consent.md`; nothing has been sent) | user (checkbox at sign-up or Account switch) | `users.marketing_consent_at`, `marketing_consent_version`, `marketing_consent_language`, `marketing_consent_source` | send marketing email only to people who explicitly agreed | cleared when the person withdraws; account deletion |
| Marketing-consent history: user id, granted/withdrawn, version, language, how (sign-up, Account, unsubscribe link), time — **no address, no name, no email content** | API | `marketing_consent_log` | demonstrate a consent and that a withdrawal was honoured | account deletion (cascade) |
| Campaign and reminder email log: user id, campaign, step, audience, version of the email, language, link path, status, attempt count, Resend message id, last delivery status (delivered/bounced/complained), times — **no email address and no email content** (`docs/email/verification-reminder.md`, `reactivation-campaign.md`; nothing has been sent) | API (operator tools) | `email_campaign_sends` | send each campaign email at most once per person; read delivery back; report results | account deletion (cascade) |
| Campaign link clicks: send id, "looks like a link scanner" flag, time — **no address, no IP, no user agent** | API (`GET /email/click/:id`) | `email_campaign_clicks` | count clicks without Resend tracking | with its send row (cascade) |
| Suppression list: **email address (lower case)** and reason (bounced / complained / manual) | API (operator tools, Resend delivery events) | `email_suppressions` | never email an address that bounced or complained | **kept after account deletion** while it is needed to avoid emailing that address; open question for counsel (`docs/legal/open-items.md` §8) |
| Old on-device study reminders (app versions before the daily email) | app | device only (`expo-notifications`) | — retired | cancelled automatically the next time the app starts |
| Random install id (UUID) | app | device only (+ sent with analytics events) | group signed-out events | uninstall; unlinked on account deletion |
| Unsent exam answers (draft) | user | app memory only | resume an exam in the same session | app restart / submit |

**Not collected:** location, contacts, photo library browsing (a lecture video is chosen by the student in the system photo picker; only that file is uploaded), camera, microphone recording in the app (students pick existing recordings from Files), push tokens (the app sends no push notifications; study reminders are emails), advertising identifier (IDFA), device fingerprint, IP address in the database, payment card data (Apple or Google handles payment), health, browsing history. No third-party analytics/ads SDKs. No tracking across apps/websites (ATT prompt not needed; `NSPrivacyTracking = false`).

## 2. Analytics — exactly what is sent

Contract: `packages/shared/src/analytics.ts` (strict allowlist; unknown events/properties are rejected with 400).

- **App events:** `app_opened` (platform, signed in?, app language, study language, device time zone — the daily study email uses the latest app language and time zone of a signed-in student), `upload_started` (file size), `upload_failed` (category), `course_opened` (id, status), `exam_started` / `practice_started` (ids, question count), `paywall_viewed` / `plan_selected` / `upgrade_started` (plan id, trigger, trial yes/no).
- **Material events:** `material_upload_started` / `material_upload_failed` / `material_opened` (app), `material_processing_started`, `material_transcription_completed`, `material_processing_completed`, `material_processing_failed`, `material_deleted` (server): ids, kind, format, file size, duration, billed minutes, topic/chunk counts, language, failure category, where the upload started (course screen or "Add material"), and the plan's lecture allowance type (e.g. Free's one-time lecture). **Never** file names, transcripts or extracted knowledge.
- **Planner events:** setup started, plan opened/created/recalculated, task started/completed/skipped, generation failed — ids, counts, days until exam, minutes per day, language (no topic names or plan text).
- **Server events:** sign-up/login (no properties), upload/processing (ids, sizes, page/topic counts, detected + summary language, failure category), exam generation/completion (ids, counts, score %, durations, language), monetization (`plan_id`, `provider` mock/apple/google, `environment` test/sandbox/production), web checkout (`checkout_started`: plan id, trial yes/no, provider; `checkout_completed`: provider, Stripe session mode, payment status — no amounts, card or customer details), `account_deleted` (no user id).
- **Onboarding / verification / flashcards events:** `onboarding_completed` (the five option ids), `onboarding_skipped`, `email_verified` (no properties), `flashcards_generated` (document id, requested/delivered card count, language, duration, failure category), `flashcards_round_completed` (deck id, round, counts). No age group, no card text.
- **Never in analytics:** email, name, password, tokens (including store purchase tokens), API keys, file names, PDF/slide text, questions, answers, AI output, payment details. Tested in `apps/api/test/analytics.test.ts`.
- Reports exclude mock/test purchases by default (`npm run analytics:report`, `--include-mock` to include them).

## 3. Processors / third parties

| Service | Data it receives | Notes |
|---|---|---|
| Anthropic (Claude API) | excerpts of the uploaded material, topics, previously missed questions, written answers for grading, flashcard generation | server-side only; key never in the app. Anthropic's published API terms (privacy.claude.com, checked 2026-10-15): no training on API inputs/outputs by default; deleted within 30 days, longer only for usage-policy enforcement or legal reasons. Stated in the Privacy Policy. **Confirm the account has not opted in to any data-sharing programme and sign/accept its DPA.** |
| AssemblyAI (speech-to-text) | the lecture recordings students add (audio, or video whose audio track it extracts) | server-side only; key never in the app. We request deletion of each transcript once received (`DELETE /v2/transcript/:id`). AssemblyAI's docs (checked 2026-10-15): uploaded files deleted within 48 h by default (stated in the Privacy Policy); "certain files" may be used for model training unless you opted out, use the EU servers or have a BAA. **Still open: opt-out/EU endpoint for this account (`ASSEMBLYAI_BASE_URL` defaults to the US endpoint), DPA.** |
| Apple (App Store, StoreKit) | purchases on iOS (Apple is the seller of record) | we receive signed transactions only; no card data. The app passes the Exama user id (a random UUID) as `appAccountToken`. |
| Google (Google Play Billing, Play Developer API, Cloud Pub/Sub) | purchases on Android (Google is the merchant of record) | we receive purchase tokens and subscription state only; no card data. The app passes the Exama user id (a random UUID, no email) as `obfuscatedAccountId`; the server calls the Play Developer API with a service account. |
| Email provider (Resend, `EMAIL_PROVIDER=resend`) | the student's email address, app language, the password-reset code and the email-confirmation link; for a new web subscription: plan, price, trial end and withdrawal deadline; for the daily study-plan email: first name, course titles, today's planned tasks (activity, topic, minutes), days until the exam and up to two stored focus notes per course | password reset, email confirmation, the web subscription confirmation (durable-medium record of the contract) and the daily study-plan email (opt-out, built from the stored plan — no AI processing). Named in the Privacy Policy. **Still open: DPA, sending region, real-delivery test (`docs/email-verification.md`).** |
| Stripe (web subscriptions) | first name, email address and Exama user id (Customer), chosen plan; the student enters payment details on Stripe Checkout | we keep only the Stripe Customer/subscription ids, never card data. Checkout consents are stored **at Stripe** as Checkout Session/Subscription metadata (which statements were confirmed, the time to the minute, the Terms version, the app language) — no Exama database column; they go with the Stripe Customer when it is deleted, subject to Stripe's own retention. Deleting the Exama account deletes the Stripe Customer (cancels a web subscription immediately). Stripe also acts as an independent controller for fraud prevention and legal obligations (Stripe privacy policy). Named in the Privacy Policy and Terms. **Still open: VAT/tax set-up; the withdrawal function and refund processing (`docs/legal/open-items.md` §5).** |
| Render (hosting, Postgres, persistent disk) | everything in section 1 | region **Frankfurt (EU)** for exama-api and exama-db (checked in the Render dashboard API, 2026-10-15). Backups (Render docs): database point-in-time recovery 3 days (Hobby) or 7 days (Pro+); disk snapshots daily, kept at least 7 days. Named in the Privacy Policy. **Still open: DPA; confirm the workspace plan.** |
| Expo / EAS | build service only; no runtime data | no Expo analytics/updates SDK is used |

## 4. App Store Connect → App Privacy (suggested answers — verify before submitting)

"Data used to track you": **No**. For each type below: *Linked to the user: Yes*, *Used for tracking: No*.

| Apple category | Type | Purposes |
|---|---|---|
| Contact Info | Name, Email Address | App Functionality |
| User Content | Other User Content (uploaded PDFs and PowerPoints, answers, generated study content) | App Functionality |
| User Content | Audio Data (lecture recordings students add) | App Functionality |
| User Content | Photos or Videos (lecture videos students add) | App Functionality |
| Identifiers | User ID | App Functionality, Analytics |
| Usage Data | Product Interaction | Analytics |
| Purchases | Purchase History | App Functionality |
| Diagnostics | — (no crash reporting SDK yet; answer "No" unless you add one) | — |

If you add crash reporting (e.g. Sentry) or another SDK later, update this table and the policy.

## 4b. Google Play Console → Data safety (suggested answers — verify before submitting)

Same data as §4. Collected: **Personal info** (name, email), **Audio** (lecture recordings), **Photos and videos** (lecture videos), **Files and docs** (uploaded PDFs and PowerPoints), **App activity** (in-app interactions, other user-generated content), **Financial info → Purchase history**, **App info and performance**: none, **Device or other IDs**: the random install id (analytics). Purposes: App functionality, Analytics (app activity/ids only). Shared with third parties: **No** (processors acting for you are not "sharing" under Play's definition). Data encrypted in transit: **Yes** (HTTPS only). Users can request deletion: **Yes** — in-app (Account → Delete account) **and** you must provide a **web link** for account deletion (Play requirement): publish a page explaining how to delete the account (e.g. sign in on the web build → Account → Delete account, or email support).

## 5. Checks already enforced in code/tests

- Mock billing and mock AI refuse to start with `NODE_ENV=production`; template `JWT_SECRET` is refused (`apps/api/test/config.test.ts`).
- Owner access is resolved only from server config (`OWNER_EMAILS` / `OWNER_USER_IDS`) and never appears in any response (`apps/api/test/billing.test.ts`).
- Entitlements, limits and subscription state are computed on the server; client-sent tiers/status are ignored.
- Account deletion removes rows + files and invalidates sessions (`apps/api/test/account.test.ts`).
- No secrets in the mobile bundle: only `EXPO_PUBLIC_*` values are embedded (checked on each export — see `docs/release/eas-build.md`).

## 6. Open items (business/legal)

- [ ] Company name, address, support email, privacy/terms URLs (fill `EXPO_PUBLIC_*` and the [brackets] in the legal texts).
- [x] Minimum age: 13, enforced at sign-up (`docs/signup-age.md`). Country-specific consent ages: see `docs/legal/open-items.md`.
- [x] Backups and hosting region stated in the policy (Render, Frankfurt). [ ] Transfer safeguards per provider.
- [x] Anthropic retention/training (published API terms) stated. [ ] Confirm no data-sharing opt-in on the account.
- [ ] AssemblyAI: training opt-out or EU endpoint, DPA.
- [ ] Resend: DPA, region; real delivery test (`docs/email-verification.md`).
- [ ] Stripe: VAT; online withdrawal function and statutory-refund process (refund wording done 2026-10-16, `docs/legal/open-items.md` §5).
- [ ] Legal bases and the open questions in `docs/legal/open-items.md`.
- [ ] Google Play: public account-deletion URL (Data safety form).
- [ ] Legal review of Privacy Policy and Terms (EU consumer law if selling in the EU).
- [ ] Owner dashboard (`docs/admin-dashboard.md`): decide a retention period for `admin_audit_log` and `ai_usage` (both are kept until then; neither holds content).
