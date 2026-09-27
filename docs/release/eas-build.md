# Exama — EAS builds (iOS, Android, web), TestFlight / Play and production configuration

Nothing in this repository uploads, builds in the cloud or submits to Apple on its own. Every command
below is run by you, when you decide to.

## 1. Identifiers and versions

| Setting | Value | Where |
|---|---|---|
| App name | **Exama** | `apps/mobile/app.config.ts` (`name`) |
| iOS bundle identifier / Android package | **`com.exama.app`** | `app.config.ts` → `BUNDLE_ID` (both platforms) |
| URL scheme | `exama` | `app.config.ts` (`scheme`) |
| Marketing version | **1.0.0** | `app.config.ts` → `VERSION` |
| Build number (iOS `CFBundleVersion`) / versionCode | managed by EAS | `eas.json`: `"appVersionSource": "remote"` + `"autoIncrement": true` (production) |

- **Bumping the version:** change `VERSION` in `app.config.ts` (e.g. `1.0.0` → `1.0.1` for fixes, `1.1.0` for features) before an App Store release.
- **Build numbers** are stored on EAS servers and incremented automatically for every production build, so they can't go backwards or collide. To set a starting value once: `npx eas-cli@latest build:version:set -p ios`.
- If `com.exama.app` is already taken in App Store Connect, pick another reverse-DNS id (e.g. `com.<yourcompany>.exama`) and change **only** `BUNDLE_ID` in `app.config.ts` and `APPLE_BUNDLE_ID` in the API's environment.

## 2. Environments

`APP_ENV` selects the build flavour. It is set per profile in `apps/mobile/eas.json`.

| Profile | `APP_ENV` | API URL | Dev/test UI |
|---|---|---|---|
| (local `npx expo start`) | `development` | `EXPO_PUBLIC_API_URL`, else the PC serving the app (LAN, port 4000), else localhost | shown when the server runs mock billing |
| `development` | `development` | same as above | same |
| `preview` (internal testing) | `preview` | **required**, `https://`, public host | hidden |
| `production` (TestFlight / App Store) | `production` | **required**, `https://`, public host | hidden |

Guards (see `apps/mobile/src/config/api-url.js`, tested in `apps/mobile/test/api-url.test.ts`):

- `app.config.ts` **fails the build** for `preview`/`production` if `EXPO_PUBLIC_API_URL` is missing, not `https`, or points to `localhost`, `127.x`, `10.x`, `192.168.x`, `172.16–31.x`, `*.local` or an Expo tunnel.
- At runtime a release bundle (`__DEV__ === false`) never falls back to a LAN/localhost address; with a bad URL it shows a configuration error screen instead.
- Test-mode billing controls, the subscription state switcher and the "Test mode — no payment is taken" banner are hidden in release builds even if a server had mock billing on (and a production server refuses to start with mock billing).
- Console logging goes through `src/lib/log.ts`, which is silent in release builds.

## 3. Environment variables

### Mobile (`apps/mobile`, all public — they are embedded in the app)

| Variable | Required | Example |
|---|---|---|
| `APP_ENV` | set by `eas.json` | `production` |
| `EXPO_PUBLIC_API_URL` | preview/production | `https://api.exama.app` |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | recommended | `support@exama.app` |
| `EXPO_PUBLIC_PRIVACY_URL` | recommended (App Store needs a public URL anyway) | `https://exama.app/privacy` |
| `EXPO_PUBLIC_TERMS_URL` | recommended | `https://exama.app/terms` |
| `EXPO_PUBLIC_COMPANY_NAME` | recommended | `Exama Ltd` |
| `EXPO_PUBLIC_COMPANY_ADDRESS` | recommended | `…` |
| `EAS_PROJECT_ID` | after `eas init` | UUID |

Set them in the EAS dashboard (Project → Environment variables, environments `preview` and
`production`, visibility "Plain text") or add them to the profile's `env` in `eas.json`.
**Never put secrets here** — no API keys, database URLs, JWT secrets or Apple keys.

### API server (`apps/api/.env` or your host's secret manager — never in the app)

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (enables the production guards below) |
| `DATABASE_URL` | managed Postgres URL |
| `JWT_SECRET` | 32+ random characters (template value is refused) |
| `AI_PROVIDER` | `anthropic` (`mock` is refused in production) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (if needed), `AI_MODEL` | your values |
| `BILLING_MOCK_ENABLED` | empty/`false` (`true` is refused in production) |
| `OWNER_EMAILS` / `OWNER_USER_IDS` | your owner account |
| `APPLE_BUNDLE_ID` | `com.exama.app` |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.exama.app` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API service-account key (secret) — `docs/google-play/google-play-billing.md` |
| `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Play real-time notifications push authentication |
| `CORS_ORIGINS` | only if you serve the web build; empty = no browser origins in production |
| `STORAGE_DIR` | a persistent volume (or implement the S3/R2 `FileStorage`) |
| `PLAN_LIMITS_OVERRIDE`, `PLAN_FEATURES_OVERRIDE` | optional (per-tier limits / features) |

The production API must be served over HTTPS (e.g. behind your host's load balancer/TLS) and have
`npm run db:migrate` run against the production database before the first build is tested.

## 4. One-time setup (you)

1. `npm install` at the repo root.
2. `npx eas-cli@latest login` (Expo account), then in `apps/mobile`: `npx eas-cli@latest init` and put the project id in `EAS_PROJECT_ID` (or let `eas init` write `extra.eas.projectId`).
3. Replace the provisional icons (see `docs/brand/assets.md`).
4. Create the app in App Store Connect (see `docs/app-store/app-store-connect-checklist.md`) and put its Apple ID in `eas.json` → `submit.production.ios.ascAppId`.
5. Deploy the API with the production variables above and set `EXPO_PUBLIC_API_URL` for `preview`/`production`.

## 5. Building (only when you decide to)

```bash
cd apps/mobile
npx eas-cli@latest build --profile production --platform ios      # TestFlight/App Store build
npx eas-cli@latest build --profile production --platform android  # Play Store build (AAB)
npx eas-cli@latest submit --profile production --platform ios     # uploads the build to App Store Connect/TestFlight
npx eas-cli@latest submit --profile production --platform android # uploads to Play internal testing (draft); needs google-play-service-account.json
npx expo export --platform web                                     # static web build (dist/) for any static host
```

- Android `preview`/`development` builds are APKs for sideloading; `production` is an AAB for Play.
- In-app purchases need an EAS build (expo-iap is native code; Expo Go shows "purchases aren't available here").
  Play Billing only works in a build installed from a Play test track; App Store purchases in a
  TestFlight/sandbox build.
- The `development` profile allows plain-http API calls on Android (LAN dev server); `preview` and
  `production` require https and never get that flag.

EAS manages signing (distribution certificate + provisioning profile) when you let it.
Apple purchases need a development/production build (not Expo Go) once StoreKit is connected — see
`docs/app-store/apple-subscriptions.md`.

## 6. Local checks before a build

```bash
npm run typecheck && npm test                    # repo root: API + mobile + shared
cd apps/mobile
for p in ios android web; do APP_ENV=production EXPO_PUBLIC_API_URL=https://api.example.com npx expo export --platform $p --output-dir /tmp/exama-$p; done   # release bundles compile
APP_ENV=production npx expo config                # must FAIL: no API URL
```
