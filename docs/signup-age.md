# Minimum age (13) and the age question at sign-up

**Rule:** you must be at least 13 to create an Exama account. There is no parental-consent path in
this release.

## The question

"Which age group are you in?": Under 13 · 13–17 · 18–24 · 25–34 · 35+. It is required, and nothing is
pre-selected. There is no "Prefer not to say": the answer is the only age signal Exama has, so declining
cannot prove the minimum age. The question is **neutral**: every age can be answered, and the screen does
not say in advance that under-13s are refused. A list without an under-13 answer, a "I am over 12"
checkbox, or announcing the cut-off on the question would not be a neutral age screen (FTC COPPA FAQ H.3).

## What happens

- **13 or over:** the account is created with `users.age_range` (`13_17`, `18_24`, `25_34`, `35_plus`),
  then email verification and onboarding run as before.
- **Under 13:** the app stops on the device and makes **no request**. The typed name, email and password
  are cleared, nothing is kept, and the app shows "Exama is for people aged 13 and over". It remembers
  only a timestamp (`signup_age_block_until`, device storage, 24 hours) so going back doesn't offer the
  form again right away (FTC staff recommend preventing "back-buttoning").
- **API (every client, including modified or older ones):** `POST /auth/register`
  - `ageRange: "under_13"` → **403 `age_requirement_not_met`**. This is checked before anything else: no
    lookup, no account, no onboarding row, no verification link, no email, no analytics, nothing echoed
    back. The same answer is given for an email that already has an account.
  - no `ageRange` (app versions from before the question) → **400 `age_range_required`** ("Please
    update Exama…"). Older apps can't create accounts until they are updated.
  - `prefer_not_to_say` or any other value → 400. No partial records are created.
- **Database:** `CHECK (age_range IS NULL OR age_range IN ('13_17','18_24','25_34','35_plus'))`
  (migration `0013_age_range`, not yet released). Existing accounts keep `NULL` and are not locked or
  asked again.
- **Privacy:** the age group is never returned by `/auth/*`, never in analytics events, and never used
  for prices or plan limits.

## Checked against FTC guidance

Point by point in `docs/legal/open-items.md` §2 (FTC COPPA FAQ, updated 2026-07-10, and the 2025 amended
Rule): neutral question, no default, no up-front cut-off, back-button protection, blocking under-13s,
deletion on actual knowledge. **Assumption:** Exama is a general-audience service (not directed to
children, not mixed audience); the reasons and the triggers for re-assessing it are listed there.

Tests: `apps/api/test/age-range.test.ts` (server rule, 403 with nothing stored, older clients, invalid
values, DB constraint, existing accounts), `apps/mobile/test/age-gate.test.ts` (answers, 24-hour marker
incl. expiry and tampering, translations, policy text), and the browser run in all four languages
(no request sent for "Under 13", marker persists, expired marker reopens the form).

## Legal notes (not legal advice; to be reviewed by a qualified lawyer)

- **US, COPPA:** applies to services directed to children under 13, or with actual knowledge that a user
  is under 13. Blocking under-13s and asking age neutrally follows FTC staff guidance for general-audience
  services. If Exama learns an account belongs to an under-13, the information must be deleted (or
  verifiable parental consent obtained); the Privacy Policy gives a contact for this.
- **EU, GDPR Art. 8:** when processing is based on **consent** for an information society service offered
  directly to a child, the child must be at least 16 (member states may lower this to 13), or a parent must
  consent. It does not set a minimum age for using a service, and it doesn't apply to processing based on
  other legal bases (for example, a contract).
- **Spain (LOPDGDD Art. 7):** minors can consent on their own from age 14; under 14, consent comes from
  parents or guardians.
- **France (Loi Informatique et Libertés Art. 45):** 15; under 15, consent-based processing needs joint
  consent from the child and a parent. The CNIL notes that for processing based on a contract, the minor
  can enter the contract within the limits of civil law.
- **Legal bases and minors in the EU:** proposed table and open questions in `docs/legal/open-items.md` §3–4.
- **Open questions for counsel:** which legal basis covers each processing activity (account, AI
  processing, analytics, emails); whether any of it relies on consent for 13–15/16-year-olds in the EU;
  contract capacity of minors under national civil law (Spain, France); app-store age-rating and
  "directed to children" assessments; other markets (for example UK Children's Code, Morocco and other
  Arabic-speaking markets); and handling of existing accounts created before the age question.
