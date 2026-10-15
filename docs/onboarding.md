# Student onboarding (five questions)

Shown once to a **new account** right after sign-up, on web, iOS and Android (one Expo codebase).
The original mobile questions could not be recovered from the repository or its Git history, so this
is a new design. Everything below is what the code actually does.

## The questions

Option ids are stable (`packages/shared/src/onboarding.ts`); the visible text lives in
`apps/mobile/src/i18n/locales/*` under `onboarding.*` (English, French, Spanish, Arabic).

| # | Question | Options (ids) | Used for |
|---|----------|---------------|----------|
| 1 | What are you studying? | business, tech_engineering, health, law, humanities_social, science, other | Analytics only (nothing is tailored to it yet) |
| 2 | When is your next exam? | within_7_days, one_to_two_weeks, three_to_four_weeks, over_a_month, none_scheduled | Wording of the "all set" screen; with Q3, whether the study plan comes first |
| 3 | What do you want Exama to help you with most? | understand, exams, practice, weak_topics, study_plan | With Q2: study plan shown above the first exam on the first course screen |
| 4 | What do you usually study from? | pdf, pptx, audio, video, notes, mix | Pre-selects PDF/PowerPoint in "Add material"; reminds lecture-first students that a course starts from a PDF/PowerPoint |
| 5 | How confident do you feel about your next exam? | not_confident, some_topics, fairly, very | Starting choice of "How prepared are you?" when creating a study plan (still editable) |

Question 4 differs from the first proposal: "YouTube or other lecture links" was dropped because Exama
cannot read links, and offering it would imply support that does not exist. Grading, usage limits and
subscriptions never depend on these answers.

## Behaviour

- One question per screen, "Question n of 5", large radio cards, Back/Continue (answers kept), Finish on
  the last question. Every question is required; **Skip for now** closes the questionnaire for good.
- A draft (current step + answers) is kept per account on the device, so a refresh or closed tab resumes
  where the student left off. It is cleared on completion or skip.
- If saving fails (offline, server error) the answers stay on screen with a translated error; pressing
  Finish again retries. Saving is idempotent.
- If the onboarding state cannot be read, the student is not blocked; the server keeps it `pending`.

## Storage and API

New table `user_onboarding` (migration `0011_onboarding.sql`, additive, no backfill, `users` unchanged):
`user_id` (PK, cascade delete), `status` (`pending` | `completed` | `skipped`), `answers` (jsonb of the
five option ids, validated by a strict zod schema: no free text), `finished_at`, `created_at`, `updated_at`.

- A `pending` row is created in the same transaction as the account (`POST /auth/register`). Accounts
  created before this feature have no row, read as `none`, and are never asked.
- `GET /onboarding` → `{ status: 'pending'|'completed'|'skipped'|'none', answers, finishedAt }`
- `PUT /onboarding` `{ answers }` → saves (upsert, one row per user; saving again replaces the answers
  and keeps the original completion time, which is how a future "edit my answers" would work)
- `POST /onboarding/skip` → `pending` → `skipped`; never touches saved answers; no-op for `none`
- Analytics (server side, categories only): `onboarding_completed` (the five option ids), `onboarding_skipped`

## Code map

- Contract: `packages/shared/src/onboarding.ts`
- API: `apps/api/src/services/onboarding.ts`, `apps/api/src/routes/onboarding.ts`, hook in `routes/auth.ts`
- Client logic (pure, unit tested): `apps/mobile/src/lib/onboarding.ts`; hook `lib/use-onboarding.ts`
- Screen: `apps/mobile/src/app/onboarding.tsx`; gate in `app/index.tsx` (redirect while `pending`)
- Personalization hooks: `app/plan/setup.tsx`, `app/add-material.tsx`, `app/documents/[id].tsx`
- Tests: `apps/api/test/onboarding.test.ts`, `apps/mobile/test/onboarding.test.ts`
