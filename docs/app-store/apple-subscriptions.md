# Exama — Apple subscriptions (StoreKit 2)

Status: **implemented and tested with a test certificate chain; not yet tested against the real App
Store.** The server verifies every App Store transaction, renewal info and notification with Apple's
official `@apple/app-store-server-library` (`SignedDataVerifier`) and Apple Root CA - G3
(`apps/api/certs/apple`). It is switched off until you set `APPLE_IAP_ENABLED=true`: until then the
catalog reports no store for iOS, the paywall shows "Subscriptions are coming soon", and the API refuses
Apple purchases (503 `apple_not_configured`). No purchase is ever trusted without verification.

Android uses Google Play Billing with the same server-side entitlement — see
`docs/google-play/google-play-billing.md`. A subscription bought in one store works on every platform
(iOS, Android, web); buying the same plan again in the other store is refused (409 `subscribed_elsewhere`).

## 1. Products (App Store Connect → your app → Subscriptions)

One **subscription group**, e.g. `Exama`. All six products in the same group, so a student can only have one at a time and changes are handled by Apple. Levels (1 = most access; upgrades take effect immediately, downgrades at the next renewal):

| Level | Reference name | Product ID | Duration | Price (EUR) |
|---|---|---|---|---|
| 1 | Exama Pro — Yearly | `com.exama.app.pro.annual` | 1 year | €199.99 |
| 1 | Exama Pro — Monthly | `com.exama.app.pro.monthly` | 1 month | €24.99 |
| 2 | Exama Student — Yearly | `com.exama.app.student.annual` | 1 year | €119.99 |
| 2 | Exama Student — Monthly | `com.exama.app.student.monthly` | 1 month | €14.99 |
| 3 | Exama Basic — Yearly | `com.exama.app.basic.annual` | 1 year | €79.99 |
| 3 | Exama Basic — Monthly | `com.exama.app.basic.monthly` | 1 month | €9.99 |

Display names for the store: **Exama Basic** ("PDFs + PowerPoints"), **Exama Student** ("All materials + personalized learning", the recommended plan), **Exama Pro** ("Maximum AI usage").

- Product ids live in one place: `packages/shared/src/billing.ts` (`PLANS[].appleProductId`). If you change them in App Store Connect, change them there.
- Prices: set the EUR price and let Apple generate the other storefronts (review them). The paywall shows **StoreKit's localized price** (`fetchProducts`) as soon as the store answers; the list prices in `PLANS` are only a fallback.
- Localizations (display name + description) for **English, Spanish, French and Arabic** for the group and each product.

### Free trial

For each of the 6 products: **Introductory Offer → Free → 1 week**, all territories.
- Apple enforces one introductory offer per Apple ID per subscription group; our server also allows one trial per Exama account (`trial_used`).
- The trial length must stay **7 days** (`TRIAL_DAYS`): trial usage limits are counted from `trialEndsAt − 7 days`.
- During the trial the server applies the **trial** limits (1 course, 3 PDF/PowerPoint uploads, 3 exams of ≤ 8 questions, 30 practice questions, 1 study plan, 1 audio/video lecture — the first 45 min of it) with every Student feature on, whichever plan the trial was started from; never paid limits.

## 2. Architecture

```
App (StoreKit 2, appAccountToken = Exama user id)
  └─ signed transaction (JWS) ─▶ POST /billing/purchase { signedTransaction }
                                  POST /billing/restore  { signedTransactions[] }
                                        │ AppleVerifier (apple-verifier.ts) verifies Apple's signature
                                        ▼
                         mapAppleTransaction → SubscriptionUpdate → applySubscriptionUpdate
                                        ▲                             (single writer + analytics)
App Store Server Notifications V2 ─▶ POST /billing/apple/notifications { signedPayload }
```

| Piece | File | State |
|---|---|---|
| Plan/product catalog | `packages/shared/src/billing.ts` | done |
| Client purchase boundary (`StoreClient`) | `apps/mobile/src/lib/store/index.ts` | mock + App Store + Google Play |
| Restore purchases button | paywall | done (calls the active `StoreClient`) |
| Manage subscription | Account → "Manage subscription" (opens the store that bills it: `https://apps.apple.com/account/subscriptions` or Google Play) | done |
| Transaction → subscription mapping (trial, active, cancelled, grace period, expired, refunded) | `apps/api/src/billing/providers/apple.ts` | done + tested (`apps/api/test/apple.test.ts`) |
| Account association | same file: `appAccountToken` must equal the signed-in user id; bundle id must match `APPLE_BUNDLE_ID`; one `originalTransactionId` ↔ one account (unique index) | done + tested |
| Notifications V2 handler | `handleAppleNotification` + route `POST /billing/apple/notifications` | done + tested (renewal, auto-renew off, refund, expiry, forged); returns 503 until `APPLE_IAP_ENABLED=true` |
| JWS signature verification (`AppleVerifier`) | `apps/api/src/billing/providers/apple-verifier.ts` (Apple's `SignedDataVerifier`: chain to Apple Root CA - G3, Apple OIDs, ES256, bundle id, App Apple ID, environment; OCSP revocation checks with `APPLE_ONLINE_CHECKS`) | done + tested (`apps/api/test/apple-verifier.test.ts`, test CA in `test/fixtures/apple`) |
| StoreKit in the app | `apps/mobile/src/lib/store/native.ts` (expo-iap 5.8, shared with Google Play) | done (compiles into the iOS bundle; **not tested against the App Store** — needs a device + sandbox) |
| Analytics separation | subscription events carry `provider` + `environment` (`test` / `sandbox` / `production`) | done |

## 3. Switching it on

**Server** (`apps/api/.env` on the server — never in the app):
1. Check `apps/api/certs/apple/AppleRootCA-G3.cer` against Apple's published fingerprint (see the README in that folder).
2. `APPLE_IAP_ENABLED=true`
3. `APPLE_APP_APPLE_ID=<numeric Apple ID>` (App Store Connect → App Information → Apple ID). Required in production; without it only Sandbox purchases are accepted.
4. `APPLE_ALLOW_SANDBOX=true` (default) — App Review and TestFlight buy in the Sandbox. Sandbox purchases are recorded as `environment: sandbox` and excluded from revenue reports.
5. `APPLE_ONLINE_CHECKS=true` (default) — the server calls Apple's OCSP responder to check the certificates aren't revoked, so it needs outbound HTTPS to `ocsp.apple.com`.
6. App Store Connect → App Information → App Store Server Notifications: **Version 2**, production and sandbox URL `https://<your-api>/billing/apple/notifications`.

The App Store Server API (looking up transactions with an `.p8` key) is not needed and not used: StoreKit 2 sends signed transactions, and notifications carry signed data.

**App** — done in `apps/mobile/src/lib/store/native.ts` (expo-iap; needs an EAS build, StoreKit does not run in Expo Go):
`fetchProducts` for the 6 product ids → localized prices; `requestPurchase` with `appAccountToken = user.id`;
the JWS goes to `api.applePurchase` (`{ store: 'apple', signedTransaction }`); `finishTransaction` **only after**
the server accepted it; restore = `restorePurchases` + `getAvailablePurchases` → `api.appleRestore`.
Keep "Restore purchases", "Manage subscription", and the Terms/Privacy links on the paywall (App Review 3.1.2).

**Testing:** StoreKit configuration file in Xcode or Sandbox testers (App Store Connect → Users and Access → Sandbox), then TestFlight (TestFlight purchases are free sandbox purchases). In sandbox a 1-week trial lasts ~3 minutes and monthly renewals ~5 minutes.

## 4. App Store Connect checklist for subscriptions

- [ ] Agreements, Tax, and Banking: **Paid Apps agreement** active (required before products can be tested).
- [ ] Subscription group + 6 products as above, with localizations (en/es/fr/ar) and a review screenshot of the paywall each.
- [ ] 1-week free introductory offer on each product.
- [ ] Server Notifications V2 URL (production + sandbox).
- [ ] In-app: the paywall shows price, period, trial terms, auto-renewal notice, Terms of Use and Privacy Policy links, and Restore purchases (already in place).
- [ ] App description: include the auto-renewal wording and links to the Terms of Use (EULA) and Privacy Policy.
- [ ] App Review notes: explain the owner/test account if you give reviewers one (never share your owner account — create a normal account; reviewers purchase in sandbox).
