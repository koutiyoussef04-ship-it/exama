# Exama — data inventory & App Privacy checklist (internal)

Audited against the code on 2026-09-27 (updated for lecture audio/video and Google Play Billing on Android). Update this file, the Privacy Policy (`apps/mobile/src/i18n/legal.ts` → `docs/legal/`) and the App Store privacy answers together whenever data handling changes.

## 1. What is collected, where it lives, why

| Data | Source | Stored where | Purpose | Deleted when |
|---|---|---|---|---|
| Email, first name | sign-up form | `users` (Postgres) | account, sign-in, support | account deletion |
| Password | sign-up form | `users.password_hash` — **bcrypt hash only** (cost 12) | sign-in | account deletion |
| Session token (JWT, 30 days) | API | device Keychain/Keystore (`expo-secure-store`); not stored on the server | stay signed in | sign-out / account deletion (server rejects tokens of deleted accounts) |
| Uploaded PDFs and PowerPoint files (.pptx) | user | server file storage `STORAGE_DIR/<userId>/<docId>.pdf` / `.pptx` | processing | course deletion / account deletion (whole user folder) |
| Extracted text chunks (PDF pages / slides incl. speaker notes), summary, topics, detected material language | PDF/PPTX + AI | `documents`, `document_chunks` | exams, practice, grounding checks | course / account deletion (cascade) |
| Lecture recordings (audio/video) and extra PDFs/PowerPoints added to a course | user | server file storage `STORAGE_DIR/<userId>/materials/<id>.upload` | transcription / text extraction | **audio/video: deleted right after transcription**; failed uploads after `MEDIA_FAILED_RETENTION_DAYS` (7); extra PDFs with the material/course/account |
| Lecture transcripts (timestamped text), structured knowledge (topics, key points, definitions, examples, exam concepts), duration, detected spoken language, file title | provider + AI | `document_chunks` (`material_id`), `course_materials` | exams, practice, planner, material screen | material / course / account deletion (cascade) |
| Questions, source quotes, answers, scores, feedback, topic mastery | AI + user | `exams`, `questions`, `answers`, `topic_mastery` | study features, progress | course / account deletion (cascade) |
| Study plans: exam date/time, minutes per day, preparedness, study weekdays, unavailable dates, device time zone, AI topic notes; daily tasks with status and timestamps | user + planner | `study_plans`, `study_tasks` | study planner | plan deletion, course deletion or account deletion (cascade) |
| Subscription state (plan, status, dates, provider, environment, Apple `originalTransactionId` or Google Play purchase token) | billing provider | `subscriptions` | entitlements | account deletion (cascade) |
| Usage ledger (counts of uploads/exams/practice questions/lecture uploads, lecture minutes) | API | `usage_ledger` | plan limits; deleting a course does **not** refund usage | account deletion (cascade) |
| Product analytics events | app + API | `analytics_events` | product improvement, funnel, monetization reporting | on account deletion: `user_id` and the install id are removed (events stay anonymous) |
| Language preferences (app language, study language), RTL flag | user | device only (Keychain/Keystore; localStorage on web) | UI language, AI output language | uninstall |
| Random install id (UUID) | app | device only (+ sent with analytics events) | group signed-out events | uninstall; unlinked on account deletion |
| Unsent exam answers (draft) | user | app memory only | resume an exam in the same session | app restart / submit |

**Not collected:** location, contacts, photo library access, camera, microphone recording in the app (students pick existing recordings from Files), advertising identifier (IDFA), device fingerprint, IP address in the database, payment card data (Apple or Google handles payment), health, browsing history. No third-party analytics/ads SDKs. No tracking across apps/websites (ATT prompt not needed; `NSPrivacyTracking = false`).

## 2. Analytics — exactly what is sent

Contract: `packages/shared/src/analytics.ts` (strict allowlist; unknown events/properties are rejected with 400).

- **App events:** `app_opened` (platform, signed in?, app language, study language), `upload_started` (file size), `upload_failed` (category), `course_opened` (id, status), `exam_started` / `practice_started` (ids, question count), `paywall_viewed` / `plan_selected` / `upgrade_started` (plan id, trigger, trial yes/no).
- **Material events:** `material_upload_started` / `material_upload_failed` / `material_opened` (app), `material_processing_started`, `material_transcription_completed`, `material_processing_completed`, `material_processing_failed`, `material_deleted` (server): ids, kind, format, file size, duration, billed minutes, topic/chunk counts, language, failure category, where the upload started (course screen or "Add material"), and the plan's lecture allowance type (e.g. Free's one-time lecture). **Never** file names, transcripts or extracted knowledge.
- **Planner events:** setup started, plan opened/created/recalculated, task started/completed/skipped, generation failed — ids, counts, days until exam, minutes per day, language (no topic names or plan text).
- **Server events:** sign-up/login (no properties), upload/processing (ids, sizes, page/topic counts, detected + summary language, failure category), exam generation/completion (ids, counts, score %, durations, language), monetization (`plan_id`, `provider` mock/apple/google, `environment` test/sandbox/production), `account_deleted` (no user id).
- **Never in analytics:** email, name, password, tokens (including store purchase tokens), API keys, file names, PDF/slide text, questions, answers, AI output, payment details. Tested in `apps/api/test/analytics.test.ts`.
- Reports exclude mock/test purchases by default (`npm run analytics:report`, `--include-mock` to include them).

## 3. Processors / third parties

| Service | Data it receives | Notes |
|---|---|---|
| Anthropic (Claude API) | excerpts of the uploaded material, topics, previously missed questions, written answers for grading | server-side only; key never in the app. **Check the retention/training terms of your Anthropic account and state them in the Privacy Policy.** |
| AssemblyAI (speech-to-text) | the lecture recordings students add (audio, or video whose audio track it extracts) | server-side only; key never in the app. We request deletion of each transcript once received (`DELETE /v2/transcript/:id`). **Check how long AssemblyAI keeps uploaded media files, and its training terms, for your account; choose the EU endpoint (`ASSEMBLYAI_BASE_URL`) for EU data residency; sign its DPA.** |
| Apple (App Store, StoreKit) | purchases on iOS (Apple is the seller of record) | we receive signed transactions only; no card data. The app passes the Exama user id (a random UUID) as `appAccountToken`. |
| Google (Google Play Billing, Play Developer API, Cloud Pub/Sub) | purchases on Android (Google is the merchant of record) | we receive purchase tokens and subscription state only; no card data. The app passes the Exama user id (a random UUID, no email) as `obfuscatedAccountId`; the server calls the Play Developer API with a service account. |
| Hosting / database / file storage | everything in section 1 | **to be chosen** — name them and the region in the Privacy Policy |
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
- [ ] Minimum age for your markets; data retention of backups; international transfers.
- [ ] Anthropic data-retention terms for your account.
- [ ] AssemblyAI: retention of uploaded media, training terms, DPA, region (US/EU).
- [ ] Hosting provider and region.
- [ ] Google Play: public account-deletion URL (Data safety form).
- [ ] Legal review of Privacy Policy and Terms (EU consumer law if selling in the EU).
