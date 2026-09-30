# Exama

> Turn your university course material into a personal AI tutor — in English, Spanish, French or Arabic.

One Expo codebase for **iOS, Android and web**. Bundle id / package `com.exama.app`, version 1.0.0. Subscriptions: App Store on iOS, Google Play on Android, Stripe on the web (off until configured), one server-side entitlement that unlocks every platform.

**Release docs:** [EAS builds & production config](docs/release/eas-build.md) · [Apple subscriptions](docs/app-store/apple-subscriptions.md) · [App Store Connect checklist](docs/app-store/app-store-connect-checklist.md) · [Google Play Billing](docs/google-play/google-play-billing.md) · [Play Console checklist](docs/google-play/play-console-checklist.md) · [Data inventory / App Privacy](docs/privacy/data-inventory.md) · [Legal templates](docs/legal/) · [Brand assets](docs/brand/assets.md)

Upload a PDF → the AI reads it → generate an exam → answer → AI grades → weak topics are identified → personalized follow-up questions target them → mastery is tracked over time.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | **Expo (React Native) + TypeScript + Expo Router** | One codebase for iOS + Android + web. EAS builds/submits to the stores without Xcode/Android Studio. |
| API | **Node + Hono + TypeScript** | Small and fast. Keeps AI keys and processing server-side. Runs on any Node host. |
| DB | **Postgres + Drizzle ORM** | Relational data (users → documents → exams → answers → mastery). Typed queries, SQL migrations. Works with any managed Postgres (Neon, Supabase, RDS). |
| Auth | **Email/password (bcrypt) + JWT**, token in SecureStore | Simple, no vendor lock-in. Isolated in `apps/api/src/auth/` so it can be swapped for Clerk / Supabase Auth / Better Auth. |
| AI | **`StudyAI` interface** over an **`LLMProvider`** (Anthropic now) + an offline **mock** | Change providers by adding one file. Mock lets you run everything without an API key. |
| Files | **`FileStorage` interface** (local disk now) | Add an S3/R2 driver for production. |
| Shared | `packages/shared` (zod + types) | One contract for app and API. |

## Project structure

```
study-app/
├─ apps/
│  ├─ api/                     Node/Hono backend
│  │  ├─ src/
│  │  │  ├─ index.ts           server entry
│  │  │  ├─ app.ts             routes + error handling
│  │  │  ├─ config.ts          env validation
│  │  │  ├─ auth/              password hashing, JWT, requireAuth middleware
│  │  │  ├─ db/                Drizzle schema, client, migrate script
│  │  │  ├─ routes/            auth, documents, exams (thin HTTP layer)
│  │  │  ├─ services/          business logic: documents, exams, progress, account deletion
│  │  │  ├─ ai/                StudyAI interface, LLM impl + prompts, mock, language helpers, providers/
│  │  │  ├─ billing/           entitlements, limits, subscriptions, providers (mock, apple, google)
│  │  │  ├─ storage/           FileStorage interface + local disk
│  │  │  └─ lib/               pdf extraction/chunking, errors
│  │  ├─ drizzle/              generated SQL migrations
│  │  └─ test/                 end-to-end test of the core loop
│  └─ mobile/                  Expo app (app.config.ts, eas.json, assets/)
│     ├─ scripts/export-legal.ts   writes docs/legal/*.md from the in-app legal text
│     ├─ test/                 i18n, RTL, API-URL, legal and no-hardcoded-strings tests
│     └─ src/
│        ├─ app/               screens (file-based routes)
│        │  ├─ _layout.tsx     providers + auth-guarded stack
│        │  ├─ sign-in.tsx, sign-up.tsx
│        │  ├─ index.tsx       course list + "Add material"
│        │  ├─ documents/[id].tsx  summary, topics, mastery, start exam / weak-area practice
│        │  └─ exams/[id].tsx  one-question-per-screen exam + results
│        ├─ (account, paywall, language, delete-account, support, legal/[doc]).tsx
│        ├─ components/ui.tsx  small design system (RTL-aware)
│        ├─ config/            API URL selection (dev vs release guards), public app config
│        ├─ i18n/              i18next setup, locales (en/es/fr/ar), legal texts, RTL handling
│        └─ lib/               api client, auth, preferences (languages), billing, store (App Store / Google Play via expo-iap; none on web)
├─ packages/shared/            request schemas + response types, languages, billing catalog, analytics contract
├─ docs/                       release, App Store, privacy, legal, brand
└─ docker-compose.yml          local Postgres
```

## Data model

`users` → `documents` (a course: status, summary, `topics` = PDF topics + topics added by materials) → `document_chunks` (page-grouped PDF text and timestamped lecture transcripts; `material_id` says which)
`course_materials` (lectures and extra PDFs added to a course: kind, format, status, duration, billed minutes, structured knowledge)
`exams` (standard | follow_up, focus topics, score) → `questions` (mcq | short_answer, topic) → `answers` (score 0–1, feedback)
`topic_mastery` (user × document × topic, recency-weighted mastery) → drives weak areas (< 70%) and follow-ups.

## API

```
POST /auth/register · POST /auth/login · GET /auth/me · DELETE /auth/me { password }   (account deletion)
POST /auth/password-reset/request { email, language? } → 202 always · POST /auth/password-reset/confirm { email, code, password } → signed in
GET  /documents · POST /documents (multipart "file", optional "title", "language") · GET/DELETE /documents/:id · POST /documents/:id/reprocess
GET  /documents/:id/progress        topic mastery, weak topics, exam history
POST /documents/:id/exams           { kind: "standard" | "follow_up", questionCount, language? }
GET  /exams/:id · POST /exams/:id/submit { answers: [{ questionId, answer }] }
GET  /health                         { ok, ai: { provider, model } }
POST /events                         client analytics events (allowlisted, auth optional)
GET  /billing/plans?platform=ios|android|web · GET /billing/status · POST /billing/purchase|restore · POST /billing/cancel, /billing/mock/state (mock only)
GET|POST|PATCH|DELETE /documents/:id/study-plan      study planner (POST = create, uses AI)
POST /documents/:id/study-plan/recalculate|regenerate  re-plan (free) | rebuild with AI (counts)
POST /documents/:id/study-plan/tasks/:taskId/complete|skip
POST /billing/apple/notifications    App Store Server Notifications V2 (503 until Apple is configured)
POST /billing/stripe/checkout        web: { plan, interval } → { url } of Stripe Checkout (503 until Stripe is configured)
POST /billing/stripe/portal          web: { url } of the Stripe Customer Portal (own customer only)
POST /billing/stripe/webhook         Stripe webhook: signature-verified, idempotent — the only thing that grants web access
POST /billing/google/notifications   Google Play real-time notifications, Pub/Sub push with OIDC (503 until Play is configured)
GET  /documents/:id/materials        course materials (original PDF first, then added lectures/PDFs)
POST /documents/:id/materials        add material: raw file as the body (streamed), headers X-Exama-Title / X-Exama-Language
GET  /documents/:id/materials/:mid   status + extracted knowledge (poll while processing)
POST /documents/:id/materials/:mid/retry · DELETE /documents/:id/materials/:mid
Errors: { error, code } — `code` is stable and translated by the app (src/lib/errors.ts)
```

## Run locally (Windows, macOS, Linux)

Prereqs: **Node 22 LTS** (https://nodejs.org) and **Postgres 16+**, via either:
- **Docker Desktop** → `docker compose up -d` (user/password `postgres`/`postgres`, matches the default `DATABASE_URL`), or
- **Postgres Windows installer** (https://www.postgresql.org/download/windows/) → put the password you chose into `DATABASE_URL`.

Run from the project root (PowerShell or cmd):

```bash
npm install
npm run setup            # creates apps/api/.env (random JWT_SECRET); never overwrites an existing one
npm run db:migrate       # creates the database if missing + applies migrations
npm run dev:api          # API → http://localhost:4000/health
npm run dev:mobile       # second terminal: press "w" for web, or scan the QR with Expo Go
```

On a physical phone, see **Test on an Android phone (Expo Go)** below.

## Test on an Android phone (Expo Go)

The app runs in **Expo Go** as-is (every native module it uses ships with Expo Go), so no APK build is needed.

- **How the phone finds the API:** Expo Go loads the app from your PC's LAN IP (e.g. `192.168.1.23:8081`); the app reuses that same host with port **4000** for the API. Nothing is hard-coded. The sign-in screen shows `Server: http://…:4000` in development so you can see which address it uses.
- **Override** (tunnel mode, or Expo picked the wrong network adapter): create `apps/mobile/.env` with `EXPO_PUBLIC_API_URL=http://<PC Wi-Fi IPv4>:4000` and restart Expo. Or force Expo's host: `$env:REACT_NATIVE_PACKAGER_HOSTNAME="<PC Wi-Fi IPv4>"` before `npm run dev:mobile`.
- **Secrets stay on the server:** the app bundle only contains `EXPO_PUBLIC_*` values from `apps/mobile/.env` (just the API URL). `apps/api/.env` (API key, workspace ID, JWT secret, DB URL) is never read by Expo.
- **Windows Firewall:** the phone must reach TCP 4000 (API) and 8081 (Expo). Set your Wi-Fi network to *Private* and allow Node when Windows asks, or run once in an **Administrator** PowerShell:
  `New-NetFirewallRule -DisplayName "Exama dev" -Direction Inbound -Protocol TCP -LocalPort 4000,8081 -Action Allow -Profile Private`
- Guest/campus Wi-Fi often blocks phone↔PC traffic; use a home network or your phone's hotspot.

## Use the real AI (Anthropic)

1. Open **`apps/api/.env`** (server-only; git-ignored; never bundled into the app).
2. Set:
   ```
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...your key...
   AI_MODEL=claude-sonnet-5
   ```
3. `npm run ai:check` — runs every AI step (summary, topics, exam, grading, follow-up) on the sample PDF and prints PASS/FAIL checks plus the actual questions and feedback. Add your own PDF: `npm run ai:check -- "C:\path\to\notes.pdf"`.
4. Restart `npm run dev:api`. The startup log and `GET /health` show the active provider/model (never the key).

`AI_PROVIDER=mock` (the default) keeps everything working offline. There is no silent fallback: if Anthropic is selected and fails, the app shows a clear error instead of fake questions.

### How the AI is used and kept grounded

| Step | Who does it |
|---|---|
| PDF summary + topic extraction | AI (`analyzeDocument`) |
| Exam + follow-up question generation | AI (`generateQuestions`); follow-ups get the weak topics + the student's past wrong answers |
| Grading | MCQ: exact match on the server. Short answers: AI, judged against the stored source excerpt + model answer |
| Weak-topic identification | Server: per-topic running mastery of the AI-graded scores (< 70% = weak) — deterministic and auditable |

Every prompt says to use **only** the uploaded material and to treat material/student text as data (prompt-injection guard). Each generated question must include a **verbatim source quote**; the server checks it against the PDF text and discards questions that aren't grounded, off-list topics and malformed MCQs. The quote is shown to the student on the results screen.

### Multilingual AI

- **Study language** (Account → Study language): *same as app* (default), English, Spanish, French, Arabic, or *same as my course material*. Independent from the app language — e.g. app in Spanish, PDF in French, exams in Spanish.
- The app sends the resolved language with each upload (`language`) and exam request; the API stores it on the course (`documents.ai_language`, `summary_language`) and exam (`exams.language`), so grading feedback uses the exam's language.
- The **material's language is detected** during analysis (`documents.source_language`) and shown on the course screen. The material is never translated before processing.
- Grounding is unchanged: each question's `sourceQuote` must be copied **verbatim in the material's original language**, and the server still checks it against the PDF text. Topic labels stay exactly as extracted; technical terms may be kept in the original language.
- The mock AI tags output with the language (`[mock:es]`) so the whole flow is testable offline (`apps/api/test/multilingual.test.ts`).

### Errors

AI failures return JSON `{ error, code }`: `ai_auth` (bad key, 502), `ai_rate_limited` / `ai_unavailable` (503), `ai_bad_request` (e.g. wrong model id, 502), `ai_bad_output` (502). Details go to the server log only. Failed PDF processing can be retried from the app ("Try again") without re-uploading.

## Subscriptions & limits

**Plans** (catalog: `packages/shared/src/billing.ts`; the apps show the store's localized prices):

| | Free | **Basic** | **Student** (recommended) | **Pro** |
|---|---|---|---|---|
| Price | €0 | €9.99/month · €79.99/year | €14.99/month · €119.99/year | €24.99/month · €199.99/year |
| In one line | try it | PDFs + PowerPoints | All materials + personalized learning | Maximum AI usage |
| PDFs and PowerPoints (.pptx), course understanding, exams, practice | ✓ | ✓ | ✓ | ✓ |
| Courses at once | 1 | 3 | 15 | 50 |
| Audio/video lectures | 1 lecture (first 45 min), once per account | — | ✓ | ✓ |
| Practice | across course topics | across course topics | adaptive (weak topics, your mistakes) | adaptive |
| Weak-topic analysis | — | — | ✓ | ✓ |
| Study planner | even | even | adaptive (priorities + re-plans on results) | adaptive |

Plus the **7-day trial** (once per account: Student features; 1 course · 3 exams · 30 practice questions · 1 lecture up to 45 min — never below Free) and the **owner** account (unlimited, free, server config only). Features per tier live in `apps/api/src/billing/features.ts` (override: `PLAN_FEATURES_OVERRIDE`) and are enforced by the API (`GET /billing/status` → `features`, `accessPlan`).

**Access is decided only by the API** (`GET /billing/status`): owner config → subscription state → plan features and limits → usage (this month, or the whole trial). The resolver's states: `free`, `trial`, `basic_monthly`, `basic_yearly`, `student_monthly`, `student_yearly`, `pro_monthly`, `pro_yearly`, `expired`, `owner` (reported to apps as `complimentary`, so the owner bypass is never revealed). The app just displays it; a 402 response (`code: limit_reached | premium_required`) opens the paywall.

| Limit | Free (per month) | **Trial (whole 7 days)** | Basic (per month) | Student (per month) | Pro (per month) |
|---|---|---|---|---|---|
| Courses at once | 1 | 1 | 3 | 15 | 50 |
| PDF / PowerPoint uploads | 3 | 3 | 10 | 30 | 100 |
| Exams generated | 3 | 3 | 15 | 40 | 150 |
| Practice questions | 12 | 30 | 120 | 300 | 1200 |
| Max questions per exam | 8 | 8 | 12 | 15 | 20 |
| AI study plans (create / rebuild) | 1 | 1 | 3 | 10 | 30 |
| Lecture uploads (audio/video) | **1 per account** | 1 | — | 30 | 80 |
| Lecture minutes | **45 per account** | 45 | — | 300 | 720 |
| Longest lecture processed | 45 min (first 45 of a longer one) | 45 min (first 45) | — | 120 min | 180 min |

**Free's lecture is once per account, not per month** (`lectureAllowance: 'once'` in `GET /billing/status`): for the `free` tier the lecture counters cover the account's whole history, so deleting the course, uploading the same file again, retrying, or a lecture already used during a trial or an earlier subscription never gives it back. A longer lecture is accepted and only its **first 45 minutes** are transcribed and used (`minutesToReserve` in `billing/entitlements.ts`; AssemblyAI `audio_end_at`); the material keeps its full length (`original_duration_seconds`, migration `0009`) and the app explains it ("This lecture is 60 minutes. Free includes the first 45 minutes.") with a link to Student for complete lectures. Minutes are reserved before the file is stored or transcribed, so there is no way to get more than 45 minutes processed. The trial works the same way. Retrying the *same* failed lecture is allowed; a new one gets 402 and the app opens the Student paywall (`free_lecture_used`). Basic stays without audio/video (`lectureAllowance: 'none'`).

**The trial is its own tier (`trial`)** — the full feature set, but it never gets paid limits, including after cancelling (it keeps trial limits until it ends). Its counters cover the whole trial and never reset. When the trial ends the account falls back to Free (`trialEnded: true` drives the "trial ended" upsell); converting to a paid plan switches to that plan's monthly limits.

**Anti-abuse:** usage lives in an append-only server ledger (`usage_ledger`), so deleting a course, reinstalling the app or signing in again restores nothing. Allowance is reserved *before* any AI call, under a per-user Postgres advisory lock, so parallel requests can't slip past a limit (a failed AI generation releases its reservation). `trial_used` is permanent per account — even the test-mode "Free" reset keeps it.

Tune in `apps/api/src/billing/limits.ts`, or without a deploy via `PLAN_LIMITS_OVERRIDE` (JSON, tiers `free`/`trial`/`basic`/`student`/`pro`) in `apps/api/.env`, e.g. `{"trial":{"practiceQuestionsPerMonth":10}}`.

**Owner access:** set `OWNER_EMAILS` and/or `OWNER_USER_IDS` in `apps/api/.env`. Matching accounts always resolve to full access (status `complimentary`, no limits, no expiry), whatever their subscription row says. Check with `npm run owner:check -- you@example.com`.

**Providers:** billing is behind `BillingProvider` (`apps/api/src/billing/providers/`). Every provider emits a normalized `SubscriptionUpdate`; `applySubscriptionUpdate` is the only writer and also records the monetization analytics.
- `mock` (development only, `BILLING_MOCK_ENABLED=true`): trials/subscriptions/cancel/restore without payment, plus a state switcher on the Account screen. Refused when `NODE_ENV=production`.
- `apple` (iOS): expo-iap in the app; the server verifies every signed transaction, renewal info and App Store Server Notification V2 with Apple's `SignedDataVerifier` (certificate chain to Apple Root CA G3 in `apps/api/certs/apple/`, bundle id, App Apple ID, environment; `apps/api/src/billing/providers/apple-verifier.ts`) and handles renewals, expiry, cancellation (auto-renew off), refunds and revocations. Off until `APPLE_IAP_ENABLED=true` (production also needs `APPLE_APP_APPLE_ID`); until then Apple purchases are refused and the iOS paywall shows "coming soon". Tested with a local test certificate chain — not yet against real App Store / sandbox purchases. See [docs/app-store/apple-subscriptions.md](docs/app-store/apple-subscriptions.md).
- `google` (Android): Play Billing via expo-iap + Play Developer API verification, server-side acknowledgement, plan changes as replacements, real-time notifications. Tested against a fake Google API; enabled by `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. See [docs/google-play/google-play-billing.md](docs/google-play/google-play-billing.md).
- **Web** subscribes through **Stripe Checkout** when `STRIPE_ENABLED=true` (7-day trial owned by Stripe, card collected at checkout, billing managed in the Stripe Customer Portal; access is granted only by the signed webhook). Setup, access rules and the Dashboard checklist: [docs/stripe/stripe-web-billing.md](docs/stripe/stripe-web-billing.md). With Stripe off, web has no purchases: the paywall explains how to subscribe in the iOS/Android app (Account → Upgrade; store links from `EXPO_PUBLIC_APP_STORE_URL` / `EXPO_PUBLIC_PLAY_STORE_URL`, the Play link falls back to the package name), and a subscription from either store works there. A subscription can only exist in one source at a time (409 `subscribed_elsewhere` / `already_subscribed`); the paywall shows where it's managed.
- In release builds the app never shows test-mode controls, and a production server refuses to start with mock billing.

API: `GET /billing/plans` (public) · `GET /billing/status` · `POST /billing/purchase` · `POST /billing/restore` · `POST /billing/cancel` (mock) · `POST /billing/mock/state` (mock).

## Study planner

Course → **Create study plan**: exam date (+ optional time), minutes per day (30/60/120/180+), how prepared the student feels, optional study weekdays and unavailable dates. Exama then plans every day until the exam and adapts as the student works.

- **Deterministic scheduler** (`apps/api/src/services/planner/schedule.ts`, pure and unit-tested): available days → phases (learn → practice with mock exams → review → final review; compressed for short windows, exam-day = light review only) → each day filled up to the daily minutes. Time per topic grows with weakness (1 − mastery, proven weak topics weigh 1.5×) and importance; strong topics get a single light refresh. With plenty of time, sessions shrink (≥ 20 min); with too little, the weakest/most important topics are planned and the rest are listed as *not covered*.
- **AI** is used once per creation/rebuild (`StudyAI.planTopics`): each topic's importance (1–3) and a short "what to focus on" note in the study language, grounded in the course; the server validates it (known topics only, clamped values, bounded text). Dates, durations and capacity are never left to the model.
- **Adaptive, no AI:** completing/skipping a task, any graded exam/practice on the course, editing preferences and the first visit of each day re-plan future days deterministically. Yesterday's unfinished tasks become *missed* and their topics come back as *catch-up* — never as an impossible catch-up day. Practice/mock tasks start a normal practice set/exam (normal allowances) and complete themselves when submitted.
- **Readiness** (shown once there are results) = importance-weighted mastery (85 %) + plan progress (15 %) — an internal indicator, labelled as such, not a probability.
- Data: `study_plans` (one per course, preferences + AI topic notes) and `study_tasks` (date, topic, activity, phase, minutes, reason, status, timestamps, linked exam). Migration `0005_study_planner`. Course content is not copied.
- Tests: `apps/api/test/planner.test.ts` (scheduler) and `apps/api/test/study-plan.test.ts` (API, ownership, limits, adaptation, missed days, languages).

## Password reset

Sign in → **Forgot password?** → email → a 6-digit code by email → code + new password → signed in.
- Codes are random, stored only as an HMAC (keyed with `JWT_SECRET`), valid **30 minutes**, **single use**, **5 wrong tries** at most; a new request cancels older codes (`password_reset_codes`, migration `0008`).
- **No account enumeration:** `/request` always answers 202 with the same body, whether the email exists or not.
- **Rate limits:** 10 requests and 20 confirmations per IP per 15 min, 3 emails per account per hour.
- A reset sets `users.password_changed_at`; every token issued before it stops working (`pwc` claim).
- Email: `EMAIL_PROVIDER=log` (development: the email is written to the API log), `resend` (`RESEND_API_KEY`, `EMAIL_FROM`), or `disabled` (production default until configured — reset emails are then not sent). Emails in the student's app language (en/es/fr/ar). Code: `apps/api/src/services/password-reset.ts`, `apps/api/src/lib/mailer.ts`; tests `apps/api/test/password-reset.test.ts`.

## Daily study reminders

Account → **Study reminders** (off by default), or the one-time offer on the study-plan screen. On/off and a time (30-minute steps, default 18:00, device time zone). Permission is asked only when the student turns reminders on; if it's refused the app works normally and shows how to allow it.
- **Local notifications** (`expo-notifications`), no server push: at most one per day, only on days with something to do — the day's study-plan tasks (nearest exam first; "exam coming up" in the last 3 days), or without a plan a single nudge when an unfinished set or weak topics are waiting. Nothing is sent when there's nothing to do. Scheduled a week ahead and rebuilt when the app opens, a plan changes or the student signs out (cleared).
- Tapping opens the plan or the course. Web: not available (the Account screen says so).
- Analytics: `reminder_enabled`, `reminder_disabled`, `reminder_time_changed` (platform + hour only) and `reminder_opened` (platform + kind) — never course names or content.
- Code: `apps/mobile/src/lib/reminders-core.ts` (pure, tested in `apps/mobile/test/reminders.test.ts`), `reminders.ts`, `components/reminders.tsx`.

## Lecture audio & video (course materials)

Course → **Course materials → Add material**, or from the course list: **Add material** (same selector) → **PDF / PowerPoint / Audio / Video** → a new course (PDF/PowerPoint) or one of your courses. Everything added feeds the same course: its text becomes part of `document_chunks` and its topics are merged into the course, so exams, practice, weak-topic analysis and the study planner use it once it's ready.

- **Formats** (detected from the file's bytes, never its name or declared type — `apps/api/src/lib/media-probe.ts`): PDF, MP3, M4A, WAV, MP4, MOV. Duration and "has an audio track" are read from the headers without ffmpeg and without loading the file. Upload limit `MEDIA_MAX_UPLOAD_MB` (1 GB), PDFs `MAX_UPLOAD_MB`.
- **Upload:** the raw file is streamed to storage (the phone uses expo-file-system's native upload task, with progress; a 1 GB video never sits in memory on either side).
- **Pipeline** (`apps/api/src/services/materials/`): processing → transcribing → analyzing → ready/failed, in a background runner with a global concurrency limit, per-job timeout and restart recovery. The student can leave the screen; the app polls.
- **Transcription** is a separate provider interface (`apps/api/src/transcription/`): Claude reads text but does not transcribe audio. `assemblyai` (real, REST) or `mock` (deterministic, used by tests). Video is sent as-is; AssemblyAI extracts the audio. The provider is told to stop at the reserved minutes and is asked to delete its transcript afterwards. Another provider (e.g. one with per-request size limits that needs chunking) implements the same `transcribe()` and returns timestamped segments.
- **Knowledge extraction** (Claude, one call per material, `StudyAI.extractKnowledge`): topics, subtopics, key points, definitions, examples, likely exam concepts and related topics, in the student's study language. Every topic must come with a verbatim quote that really occurs in the transcript, otherwise it is dropped (`apps/api/src/lib/knowledge.ts`). Existing course topic names are reused, and a course holds at most 30 topics. Transcript-only: slides shown but not spoken aren't captured, and the app says so.
- **Planner:** new topics never rebuild a plan automatically. The plan shows "new material" with an **Update plan** button (free, no AI). Removing a material re-plans the future without its topics.
- **Billing:** lecture uploads and minutes are reserved before transcription, under the same per-user lock as other limits. Minutes are settled to the real length afterwards and given back if transcription fails; the upload itself still counts. If the AI step fails, the retry reuses the saved transcript and isn't charged again. Extra PDFs use the PDF allowance. The owner has no monthly caps, only the 240-minute per-file safety cap. Costs and the reasoning for the limits: [docs/materials/cost-model.md](docs/materials/cost-model.md).
- **Protection:** sign-in and course ownership on every route; burst limit per student (`MEDIA_UPLOADS_PER_HOUR`); at most `MEDIA_MAX_ACTIVE_PER_USER` materials processing per student; at most 30 materials per course; hard per-file length cap; processing timeout; safe storage keys (`<userId>/materials/<uuid>.upload`, never executed or served).
- **Storage:** audio/video is deleted as soon as it's transcribed; the transcript is kept as course text. A failed upload keeps its file for `MEDIA_FAILED_RETENTION_DAYS` (7) so the student can retry. Deleting the material, course or account removes everything, and processing jobs are stopped first.
- **Real provider check:** `npm run transcription:check` (sends a 16-second clip; needs `ASSEMBLYAI_API_KEY`). `npm run ai:check` now also checks lecture knowledge extraction with Claude.

## Languages & RTL

- UI languages: **English, Spanish, French, Arabic** (`apps/mobile/src/i18n/locales/`; English is the typed source of truth, so a missing key is a type error). Default: the device language if supported, else English. Change it in Account → Language (or the globe on the sign-in screen); saved on the device.
- **Arabic is right-to-left:** switching to/from Arabic asks to restart the app once so iOS/Android mirror the whole layout (`I18nManager`); arrows/chevrons flip, text aligns to the start, letter-spacing is disabled for Arabic, and dates use Western digits to match scores and prices.
- Server errors carry stable `code`s that the app translates; the paywall, legal pages, dialogs, accessibility labels and empty/loading/error states are all translated.
- Tests: `npm test -w @study/mobile` checks every language has every key and plural form, placeholders match, RTL rules, persistence, and that screens contain no hardcoded English.

## Account deletion

Account → Delete account: warning, "I understand" checkbox, password (verified by the server) and a final confirmation. `DELETE /auth/me` deletes the user row (cascading to courses, chunks, exams, answers, mastery, subscription and usage rows), removes the user's whole file folder, anonymizes their analytics events (user id and install id cleared), and every existing token stops working immediately. An App Store subscription is not cancelled by this — the screen warns and links to "Manage subscription". Tested in `apps/api/test/account.test.ts`.

## Product analytics

First-party events in the `analytics_events` table (same Postgres), written through one `track()` function (`apps/api/src/analytics/`). A hosted tool can be added later as another sink without touching call sites.

- **Server-recorded (authoritative):** `signup_completed`, `login_completed`, `upload_succeeded`, `document_processing_completed`, `course_deleted`, `exam_generation_started`, `exam_generation_completed`, `exam_completed`, `practice_completed`.
- **App-recorded (via `POST /events`, strict allowlist):** `app_opened`, `upload_started`, `upload_failed`, `course_opened`, `exam_started`, `practice_started`, `paywall_viewed`, `plan_selected` and `upgrade_started` (with `tier` basic/student/pro and `period`).
- **Monetization (server):** `trial_started`, `subscription_started` (+ `change`: new/upgrade/downgrade/period_change), `subscription_cancelled`, `subscription_expired`, `subscription_restored` — each with `plan_id`, `tier` (basic/student/pro), `period` (monthly/yearly), `provider` (`mock`/`apple`/`google`) and `environment` (`test`/`sandbox`/`production`) so test purchases are excluded (`analytics:report` excludes them unless `--include-mock`). `account_deleted` is recorded without a user id.
- **Study planner:** `study_plan_setup_started`, `study_plan_opened`, `study_plan_task_started` (app); `study_plan_created`, `study_plan_task_completed`, `study_plan_task_skipped`, `study_plan_recalculated`, `study_plan_generation_failed` (server) — ids, counts, days until exam, minutes/day, language; never topic names or plan text.
- **Language metadata:** `app_opened` carries the app and study language; uploads, processing and exam generation carry the AI/material language.
- **Stored:** event name, time, user id (if signed in), random per-install id, and ids/counts/scores/durations/categories. Contract: `packages/shared/src/analytics.ts`.
- **Never stored:** emails, names, passwords, keys, file names, PDF text, questions, answers or AI output.

```bash
npm run analytics:report              # funnel, drop-off, failures, retention — last 30 days
npm run analytics:report -- --days 7
```
The SQL behind it is in `apps/api/analytics/queries.sql` (paste into pgAdmin; replace `$1` with a number of days).

## Checks

```bash
npm run typecheck        # all packages (API, mobile + its tests, shared)
npm test                 # mobile unit tests (i18n, RTL, API URL, legal) + API tests (needs Postgres + migrated DB): mock end-to-end loop, Anthropic provider
                         # contract tests + full loop against a local fake Anthropic API, config/key checks
npm run ai:check         # real Anthropic smoke test (needs your key; costs a few cents)
npm run transcription:check   # real AssemblyAI smoke test (needs ASSEMBLYAI_API_KEY; < 1 cent)
```

## Deliberate MVP shortcuts (and the upgrade path)

- **Background processing** runs in-process (fire-and-forget + status column; resumed on restart) → move to a job queue (pg-boss) when volume grows.
- **Context selection** uses page chunks + keyword matching → add embeddings (pgvector) when documents get large.
- **Local disk storage** → use a persistent volume or add an S3/R2 driver before deploying.
- **Stateless 30-day JWT, no refresh tokens** → add refresh tokens or adopt a hosted auth provider. (Password reset exists; changing the password invalidates older tokens.)
- **Scanned (image-only) PDFs** aren't supported yet → OCR later.
- **No email verification / rate limiting** on sign-up and login yet (password reset is rate-limited) → add before a public launch (limits abuse of the free plan).
- **Lecture processing** runs in the API process (see above) → a separate worker/queue when volume grows. Burst limits are per process (in memory).
- **Transcript-only video understanding:** slides/diagrams on screen aren't read. The `KnowledgeTopic.basis` field and pipeline stages leave room for a later frame-sampling + vision step.
- **Uploads keep going only while the app is open:** on iOS a short trip to the background is fine; Android may stop an upload when the app is backgrounded (the app then shows the upload as failed; pick the file again). Processing itself runs on the server, and screens refresh when the app comes back to the foreground.
- **No push notifications from the server** (e.g. "your lecture is ready") → the app shows status when opened. Daily study reminders exist, but they are local notifications scheduled on the device.
- **PowerPoint:** `.pptx` is supported (slide text, tables and speaker notes; no dependency, parsed on the server). Old binary `.ppt` files and image-only slides aren't: save as `.pptx`/PDF.
- No social features — by design.
