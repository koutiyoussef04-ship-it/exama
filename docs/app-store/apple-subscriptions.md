# Exama — Apple subscriptions (StoreKit 2) preparation

Status: **app side connected (expo-iap), server verification not implemented yet.** No real purchase
is possible yet, and nothing pretends to be one: with no Apple verifier configured the catalog reports
no store for iOS, the paywall shows "Subscriptions are coming soon", and the API refuses Apple purchases
(503 `purchases_unavailable` / `apple_not_configured`).

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
- During the trial the server applies the **trial** limits (1 course, 1 PDF/PowerPoint, 1 exam of ≤ 8 questions, 5 practice questions, 1 lecture ≤ 30 min) with every feature on, whichever plan the trial was started from; never paid limits.

## 2. Architecture

```
App (StoreKit 2, appAccountToken = Exama user id)
  └─ signed transaction (JWS) ─▶ POST /billing/purchase { signedTransaction }
                                  POST /billing/restore  { signedTransactions[] }
                                        │ AppleVerifier (to implement) verifies Apple's signature
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
| Notifications V2 handler | `handleAppleNotification` + route `POST /billing/apple/notifications` | done + tested with a fake verifier; returns 503 until configured |
| JWS signature verification (`AppleVerifier`) | `apps/api/src/billing/index.ts` → `appleVerifier` | **to implement** |
| StoreKit in the app | `apps/mobile/src/lib/store/native.ts` (expo-iap 5.8, shared with Google Play) | done (compiles into the iOS bundle; **not tested against the App Store** — needs a device + sandbox) |
| Analytics separation | subscription events carry `provider` + `environment` (`test` / `sandbox` / `production`) | done |

## 3. Remaining implementation (when you're ready)

**Server**
1. `npm i @apple/app-store-server-library -w @study/api`.
2. Implement `AppleVerifier` with `SignedDataVerifier(appleRootCAs, enableOnlineChecks=true, environment, bundleId, appAppleId)`; download Apple's root certificates (Apple PKI) and load them on start.
3. Set `appleVerifier` in `apps/api/src/billing/index.ts` when the Apple variables are present. Add them to the config schema (server-side only):
   `APPLE_ENVIRONMENT` (`Sandbox`/`Production`), `APPLE_APP_APPLE_ID` (numeric app id). For the App Store Server API (optional: look up transactions, send consumption info) also `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (.p8 contents). **Never in the mobile app.**
4. In App Store Connect → App Information → App Store Server Notifications: **Version 2**, production and sandbox URL `https://<your-api>/billing/apple/notifications`.

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
