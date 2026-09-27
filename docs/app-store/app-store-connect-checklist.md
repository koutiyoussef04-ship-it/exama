# Exama — App Store Connect & TestFlight checklist (manual steps)

Everything here is done by you in App Store Connect / Apple Developer. Nothing has been created, uploaded or submitted.
Android: see `docs/google-play/play-console-checklist.md`.

## Before the first TestFlight build
1. **Apple Developer Program** membership (organization account recommended if you'll sell as a company — the seller name shown on the App Store).
2. **Certificates, Identifiers & Profiles → Identifiers:** register the App ID `com.exama.app` (or let EAS create it on the first build). Capability needed later: **In-App Purchase** (enabled by default).
3. **App Store Connect → Apps → +:** New App — platform iOS, name **Exama** (must be unique on the store; have alternatives ready, e.g. "Exama – AI Study Tutor"), primary language English, bundle id `com.exama.app`, SKU e.g. `exama-ios`. Copy the app's **Apple ID** (numeric) into `apps/mobile/eas.json` → `submit.production.ios.ascAppId`.
4. **Production API** deployed over HTTPS with production env (`docs/release/eas-build.md` §3) and migrations applied; set `EXPO_PUBLIC_API_URL` for the `production` EAS environment.
5. Build and submit (`docs/release/eas-build.md` §5) → **TestFlight**: add internal testers (up to 100, no review); external testers need a short Beta App Review and a test-information note.

## App information
- Subtitle (≤ 30 chars), e.g. "Your course, your AI tutor" — localized for es/fr/ar.
- Category: **Education** (secondary: Productivity).
- Content rights: you don't show third-party content (users upload their own).
- Age rating questionnaire: no objectionable content; **User-generated content: users upload their own documents (not shared with others)**; unrestricted web access: No. Expect 4+ or 9+; decide your minimum age for the Privacy Policy (13/16).
- **Localizations:** English (primary), Spanish, French, Arabic — name, subtitle, description, keywords, "What's New", screenshots.

## Pricing, availability, subscriptions
- Price: Free (with in-app subscriptions). Availability: your chosen countries.
- **Agreements, Tax, and Banking → Paid Apps agreement** + bank + tax forms.
- Subscriptions and free trial: see `docs/app-store/apple-subscriptions.md` §1 and §4.

## App Privacy
- **Privacy Policy URL** (public page — publish `docs/legal/privacy-policy.md` once completed).
- Data collection answers: `docs/privacy/data-inventory.md` §4.
- The in-app account deletion (Account → Delete account) satisfies guideline 5.1.1(v).

## Version page (1.0)
- Screenshots: 6.9" iPhone required (the app is iPhone-only: `supportsTablet: false`, so no iPad screenshots).
- Description must mention auto-renewing subscriptions and link the **Terms of Use (EULA)** — either Apple's standard EULA or your own (`docs/legal/terms-of-use.md`, published at a URL).
- **Support URL** (publish `docs/legal/support.md`), Marketing URL optional.
- Copyright: "2026 [Company name]".
- **App Review information:** a demo account (a normal account, *not* your owner account) with a course already uploaded, contact details, and notes: "Subscriptions are auto-renewable (Student / Student Pro). Upload any text-based PDF to try the core flow. The AI only uses the uploaded material."
- The web version never sells or links to purchases inside the iOS app (no external payment links — guideline 3.1.1); a subscription bought on Android also unlocks the iOS app for the same account (allowed under 3.1.3(b) multiplatform services, as long as the iOS app also offers it via in-app purchase).
- Export compliance: already answered in the build (`ITSAppUsesNonExemptEncryption = false`, HTTPS only).

## Before submitting for review
- [ ] Apple server verification implemented (`apple-subscriptions.md` §3 — the app side is done) and purchases tested in sandbox/TestFlight. Until then the iOS paywall says purchases are coming soon, which would be rejected for a subscription app.
- [ ] Legal texts completed, `LEGAL_IS_DRAFT = false`, public URLs live, `EXPO_PUBLIC_*` legal/support values set.
- [ ] Final icon and screenshots (`docs/brand/assets.md`).
- [ ] Real-AI end-to-end run on a TestFlight build in all four languages.
