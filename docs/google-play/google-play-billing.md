# Exama — Google Play Billing (Android subscriptions)

Status: **implemented, not tested against Google.** The server code, the app code, and the tests (with a
fake Google API) are in place. No real Play purchase has been made. Until you set
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` on the server, Android shows "Subscriptions are coming soon" and the
API refuses Play purchases.

## 1. How it fits the existing billing

One Exama account has one entitlement, whichever store sold it. The server stays the source of truth.

| Platform | Store | Proof sent to the API | Verified with |
|---|---|---|---|
| iOS | App Store (`apple`) | StoreKit 2 signed transaction (JWS) | Apple's signature (verifier still to implement) |
| Android | Google Play (`google`) | purchase token + product id | Play Developer API `purchases.subscriptionsv2.get` |
| Web | none | — | a subscription bought in either app works here too |
| development | mock (`BILLING_MOCK_ENABLED`) | plan id | nothing (refused in production) |

```
Android app (expo-iap, obfuscatedAccountId = Exama user id)
  └─ purchaseToken ─▶ POST /billing/purchase { store:'google', purchaseToken, productId }
                      POST /billing/restore  { store:'google', purchases:[…] }
                            │ subscriptionsv2.get (service account)  → verify product, account, not linked elsewhere
                            ▼
              mapGoogleSubscription → applySubscriptionUpdate (single writer + analytics)
                            │
                            └─ then acknowledge (server) → app finishTransaction (acknowledges again, harmless)
Google Play RTDN ─▶ Pub/Sub push (OIDC) ─▶ POST /billing/google/notifications → re-reads the token from Google
```

- **The catalog is per platform.** `GET /billing/plans?platform=ios|android|web` returns the store that
  sells there (`provider`) and whether purchases are available. Older iOS builds without `?platform` still
  get the iOS answer.
- **Acknowledgement.** Google refunds a purchase that isn't acknowledged within 3 days. The server
  acknowledges only **after** the subscription is stored. A purchase that was refused (another account,
  or a subscription already active in the App Store) is never acknowledged, so Google refunds it.
  If acknowledging fails after storing, access is kept. The app's `finishTransaction` and the next
  notification retry it.
- **Cross-store rule.** While an App Store subscription still gives access, a Play purchase is refused with
  409 `subscribed_elsewhere`, and the reverse. The paywall prevents this upfront: it shows "Your subscription
  is managed by App Store / Google Play" instead of the buy button.
- **Trial.** Each base plan has a 7-day `free-trial` offer. The app only requests the trial offer when the
  server says the account is eligible (`entitlement.trialEligible`). Google also hides offers the Google
  account isn't eligible for.
- **Plan changes** (Basic ↔ Student ↔ Pro, monthly ↔ yearly) replace the current Play subscription (`with-time-proration`), so a student is never billed twice; the replaced token's later expiry notification is ignored.
- **Pending payments** (cash, some local payment methods): no access until Google confirms. The
  confirmation arrives as an RTDN and is applied then.
- **States:**

  | Google state | Exama state |
  |---|---|
  | `ACTIVE`, `IN_GRACE_PERIOD` | active / trialing |
  | `CANCELED` | cancelled (access until expiry) |
  | `ON_HOLD`, `PAUSED`, `EXPIRED` | expired |
  | refunds/revocations | expired (via RTDN) |

| Piece | File |
|---|---|
| Plans → Play product ids and base plans | `packages/shared/src/billing.ts` (`googleProductId`, `googleBasePlanId`, `GOOGLE_TRIAL_OFFER_ID`) |
| Play Developer API client (service-account JWT, no SDK) | `apps/api/src/billing/providers/google-play-api.ts` |
| Mapping, account link, provider, RTDN auth and handling | `apps/api/src/billing/providers/google.ts` |
| Store registry, per-platform store | `apps/api/src/billing/index.ts` |
| Order of operations, cross-store rule | `apps/api/src/billing/purchases.ts` |
| Routes | `apps/api/src/routes/billing.ts` |
| App: one store client for iOS and Android | `apps/mobile/src/lib/store/native.ts` (`native.web.ts` = none on the web) |
| Offer selection and store prices | `apps/mobile/src/lib/store/offers.ts` |
| Tests | `apps/api/test/google-billing.test.ts`, `apps/mobile/test/store.test.ts` |

## 2. Play Console setup (you)

1. **Monetize → Products → Subscriptions.** Create 3 subscriptions (the product id can't be changed later):

   | Product id | Name | Base plans (id → period, price EUR) |
   |---|---|---|
   | `exama_basic` | Exama Basic | `monthly` → 1 month, €9.99 · `annual` → 1 year, €79.99 |
   | `exama_student` | Exama Student | `monthly` → 1 month, €14.99 · `annual` → 1 year, €119.99 |
   | `exama_pro` | Exama Pro | `monthly` → 1 month, €24.99 · `annual` → 1 year, €199.99 |

   Both base plans are **auto-renewing**. Set the grace period (e.g. 7 days) and account hold as you prefer; the server handles all of them.
2. On **each** of the 6 base plans, add an offer with id **`free-trial`**: eligibility "New customer acquisition — never had this subscription", one phase **Free, 1 week**.
3. Localize the product names and descriptions in en/es/fr/ar.
4. **Service account for the API:**
   1. Google Cloud console (project linked to Play): enable the **Google Play Android Developer API** and create a service account.
   2. Create a **JSON key** for it.
   3. Play Console → **Users and permissions** → invite the service account's email with **View financial data** + **Manage orders and subscriptions** for the app.
   4. Put the key in the server's secret manager as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (raw JSON or base64). **Never in the app or the repository.**
5. **Real-time developer notifications:**
   1. Cloud Pub/Sub: create a topic (e.g. `play-billing`) and grant `google-play-developer-notifications@system.gserviceaccount.com` the **Pub/Sub Publisher** role on it.
   2. Create a **push** subscription to `https://<your-api>/billing/google/notifications` with **authentication enabled**, using a service account of yours. Set:
      - `GOOGLE_PUBSUB_AUDIENCE` = the audience you entered (default: the push URL);
      - `GOOGLE_PUBSUB_SERVICE_ACCOUNT` = that service account's email.
   3. Play Console → **Monetization setup** → set the topic name and click **Send test notification**. The API answers 204 and ignores test messages.
6. Server environment: set `GOOGLE_PLAY_PACKAGE_NAME` (`com.exama.app`) and the three variables above, then restart. `GET /billing/plans?platform=android` should now return `"provider":"google","purchasesAvailable":true`.

## 3. Testing (you, on a real Android device)

- Play Billing only works in a build **installed from Google Play**. Upload a production build to the **internal testing** track (`eas build -p android --profile production`, then `eas submit -p android`), add yourself as a tester and install it from the Play Store link.
- **Setup → License testing:** add the tester Gmail accounts. Their purchases are free test purchases; the server records them as `environment: sandbox`, and they're excluded from revenue reports. Test renewals are fast: 5 minutes for a monthly subscription.
- **Check:**
  - trial purchase → trial limits;
  - cancel in Play → "won't renew";
  - resubscribe;
  - upgrade Student → Pro;
  - restore on a second device;
  - a purchase with an App Store subscription already active → refused and refunded;
  - "Manage subscription" opens Play;
  - Arabic paywall.
