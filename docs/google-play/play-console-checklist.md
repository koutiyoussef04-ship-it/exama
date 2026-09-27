# Exama — Google Play Console checklist (manual steps)

You do everything here in the Google Play Console, Google Cloud and your server. Nothing has been
created, uploaded or submitted. iOS: see `docs/app-store/app-store-connect-checklist.md`.

## Account and app
1. **Google Play developer account.** An organization account is recommended if you sell as a company: it needs a D-U-N-S number and shows the company as the seller.
   - A *new personal* account must run a **closed test with at least 12 testers for 14 days** before it can apply for production.
2. **Payments profile** (merchant account) with bank details and tax information. Subscriptions can't be created without it.
3. **Create app:**
   - name **Exama**;
   - default language English (United States);
   - App, Free (in-app purchases are still allowed).
4. The **package name `com.exama.app`** is set by the first upload (`app.config.ts` → `BUNDLE_ID`) and can never change. If it's taken, change `BUNDLE_ID` and set the server's `GOOGLE_PLAY_PACKAGE_NAME` to match.
5. **App signing:** let Google Play manage the app signing key. EAS generates and keeps the upload key (`eas credentials -p android`).

## First upload (you run these)
```bash
cd apps/mobile
npx eas-cli@latest build --profile production --platform android   # AAB, versionCode auto-incremented
npx eas-cli@latest submit --profile production --platform android  # → internal testing track, as a draft
```
`eas submit` needs a Play service account key (it can be the billing one, or a separate one with **Release manager** access), saved as `apps/mobile/google-play-service-account.json`. That file is git-ignored; **never commit it**. The very first AAB may have to be uploaded manually in the Console (Testing → Internal testing → Create release).

## Store listing (Grow → Store presence)
- **Main store listing**, localized for en, es, fr and ar:
  - short description (≤ 80 characters) and full description, which must mention the auto-renewing subscriptions;
  - app icon 512×512;
  - feature graphic 1024×500;
  - phone screenshots (2–8, portrait).

  The app is phone-only: no tablet screenshots are required, but Play may show it on tablets.
- Category **Education**, contact email, and website (optional).
- **Privacy policy URL:** publish `docs/legal/privacy-policy.md`.

## App content (Policy → App content)
- **Privacy policy:** URL.
- **Data safety:** answers in `docs/privacy/data-inventory.md` §4b, including an **account-deletion web link** (required).
- **Ads:** No.
- **App access:** give reviewers a demo account (a normal account, *not* the owner account) with a course already uploaded.
- **Content rating** (IARC questionnaire): education; users upload their own files, which aren't shared with other users.
- **Target audience:** choose your ages. Under-13s trigger the Families policy, so pick 13+ or 16+ in line with your Privacy Policy.
- **Government apps:** No. **Financial features:** No. **Health:** No. **News:** No.
- **Advertising ID:** the app doesn't use it. Declare "No" (the manifest has no AD_ID permission).

## Monetization (details in `docs/google-play/google-play-billing.md`)
- [ ] Subscriptions `exama_basic` (€9.99 / €79.99), `exama_student` (€14.99 / €119.99) and `exama_pro` (€24.99 / €199.99), each with base plans `monthly` and `annual` (auto-renewing), EUR prices and localized names.
- [ ] A `free-trial` offer (1 week free, new customers only) on each of the 6 base plans.
- [ ] Grace period and account hold settings.
- [ ] **License testing:** tester Gmail accounts.
- [ ] Google Cloud: Play Android Developer API enabled; a service account with a JSON key; invited in Play Console → Users and permissions with *View financial data* + *Manage orders and subscriptions*.
- [ ] Server secrets set:
  - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`;
  - `GOOGLE_PLAY_PACKAGE_NAME`;
  - `GOOGLE_PUBSUB_AUDIENCE`;
  - `GOOGLE_PUBSUB_SERVICE_ACCOUNT`.
- [ ] Pub/Sub:
  - topic, with Play's service account as publisher;
  - authenticated push subscription to `https://<api>/billing/google/notifications`;
  - Monetization setup → topic name → **Send test notification**.

## Before production
- [ ] Test purchases done on the internal testing track with a license tester: trial, subscribe, upgrade, cancel, restore on a second device, cross-store refusal, Arabic.
- [ ] Legal texts completed, `LEGAL_IS_DRAFT = false`, public URLs live.
- [ ] Final icon, feature graphic and screenshots (`docs/brand/assets.md`).
- [ ] Real-AI end-to-end run on an internal-testing build, in all four languages.
- [ ] Pre-launch report (Play runs it automatically on each upload): review the crashes and accessibility findings.
- [ ] Target API level: the build uses Expo SDK 57's target SDK, which meets Play's current requirement. Re-check it when Google raises the requirement each year.
