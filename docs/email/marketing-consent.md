# Marketing-email consent (version `2026-10-v1`)

An optional, unticked checkbox at sign-up (and a switch in Account) that records a person's explicit yes to **marketing emails**. Written from the code; **not legal advice**. Everything marked *counsel* needs the legal adviser the register (`docs/legal/open-items.md`) already asks for.

## What the consent covers — and what it does not

| Category | Covered by this consent? | How it is controlled |
|---|---|---|
| **Marketing emails**: tips, news about new features, offers, and invitations to come back and keep studying (today: the reactivation campaign) | **Yes — only this** | the checkbox at sign-up, the switch in Account → Emails from Exama, the unsubscribe link in every such email |
| **Study reminder emails**: “Today’s study plan: …” (the day’s tasks from the plan the student made) and “Pick up where you left off: …” (a course with no plan yet) | **No.** A separate category with its own switch (Account → Study reminders) and its own unsubscribe link; on by default for Free, never-paid accounts with one course, confirmed address only. *Counsel*: whether each is a service message or direct marketing is open, and the two are **not** alike — the “pick up” email looks like re-engagement (`email-classification.md`, `open-items.md` §7) | `users.study_reminder_emails` — unchanged |
| **Account emails**: the confirmation link, the one-off confirmation reminder, password-reset codes, the web-subscription confirmation | **No.** They need no consent; they are part of running the account (disclosed in the privacy policy) | — |

So the sign-up box does **not** say “study reminders”, even though that was the first suggestion: ticking it would otherwise read as the basis for the study reminder emails (which have a different footing and their own switch), and *un*ticking it would suggest they stop (they do not). The box says exactly what it authorises and, in a second line, that the study reminder emails are separate. The category is called “study reminder emails” (the name of the Account setting) and not “daily study-plan email” because the second email in it is not a plan email.

## The wording (shown to the person; this is the consent)

`statement` is the checkbox label, `hint` the smaller line under it. Both are shown, in the app language, and a stored consent records the **version** and the **language** so the exact text can always be reproduced. The four texts are pinned to the version by a test (`apps/mobile/test/marketing-consent.test.ts`): changing a word in any language without bumping `MARKETING_CONSENT_VERSION` fails the build.

| Lang | `statement` | `hint` |
|---|---|---|
| en | Yes, Exama can email me tips, news about new features, offers, and invitations to come back and keep studying. I can unsubscribe at any time. | This is separate from your study reminder emails, which you manage in Account. |
| es | Sí, Exama puede enviarme por correo consejos, novedades sobre nuevas funciones, ofertas e invitaciones para volver a Exama y seguir estudiando. Puedo darme de baja en cualquier momento. | Es independiente de tus correos de recordatorio de estudio, que gestionas en Cuenta. |
| fr | Oui, Exama peut m’envoyer par e-mail des conseils, des nouveautés sur les nouvelles fonctionnalités, des offres et des invitations à revenir sur Exama pour continuer à réviser. Je peux me désabonner à tout moment. | Cela est distinct de vos e-mails de rappel de révision, que vous gérez dans Compte. |
| ar | نعم، يمكن لـ Exama أن ترسل إليّ بالبريد الإلكتروني نصائح للمذاكرة وأخبار الميزات الجديدة وعروضًا ودعوات للعودة إلى Exama ومواصلة المذاكرة. يمكنني إلغاء الاشتراك في أي وقت. | هذا منفصل عن رسائل تذكير المذاكرة التي تتحكم بها من الحساب. |

### Review of the wording (clarity and specificity)

Done as an engineering review; **it has not been reviewed by a lawyer or a native speaker in every language**:

- **Specific**: names the four things (tips, news about new features, offers, invitations to come back), the channel (email) and the sender (Exama). No “partners”, no “third parties”, no “and more”.
- **Unbundled and optional**: a separate checkbox, unticked, above the Create account button; the terms notice below the button is a different sentence and does not mention it; the form submits the same either way (tested).
- **Honest about what it is not**: the hint says the study reminder emails are separate. (Version `2026-10-v1` was revised once, **before** its first release: the hint first said “daily study-plan email”, which does not describe the “pick up where you left off” email. No consent had been recorded, so the version still means one text.) The suggested wording “study reminders and helpful emails about my learning progress” was **not** used: it would have claimed to authorise a category that has its own basis and switch, and “emails about my learning progress” are not something Exama sends.
- **Withdrawal is stated** in the sentence itself, and is possible two ways: the link in every marketing email and the Account switch.
- **Wording choices to confirm** (*counsel*, and a native-speaker pass for fr/ar/es): “offers” (broad: covers future promotions; the campaign emails themselves carry no prices or discounts); “invitations to come back” (promotional by nature — that is the point of classing it as marketing); the Arabic register and the form “رسائل Exama”; the French “nouveautés sur les nouvelles fonctionnalités” (slightly redundant; kept literal to “news about new features”).

## What is stored

On `users` (migration `0021_marketing_consent`): `marketing_consent_at` (server time), `marketing_consent_version`, `marketing_consent_language`, `marketing_consent_source` (`signup` or `account`, set by the server). All four are NULL (no consent) or all set with valid values (a database CHECK), so a half-written or invented consent cannot exist. A **withdrawal clears them**.

`marketing_consent_log` (append only): one row per grant or withdrawal with when, the version and language, and the way (`signup`, `account`, `unsubscribe_link`). It exists to demonstrate a consent and to show a withdrawal was honoured. No address, no name, no email content. Deleted with the account.

## How a consent is recorded (and how it cannot be)

- **Sign-up**: the app sends `marketingConsent: { version, language }` **only when the box is ticked**. Omitted, `null` or `false` records nothing. Anything else (`true`, a string, a missing or unknown version, an unsupported language, extra fields such as a client-chosen timestamp or source) is refused with 400 and **no account is created**. The consent is written in the same transaction as the account.
- **Account switch**: `PATCH /email/preferences { marketing: { consent: true, version, language } }` to give it, `{ marketing: { consent: false } }` to withdraw it. A PATCH that does not mention `marketing` (for example switching the daily plan email) cannot change it; an empty PATCH is refused.
- **Time and source are the server’s**: the database’s `now()` and a source chosen by the route.
- **Idempotent**: granting when already consented changes nothing (no refreshed time, no second history row); withdrawing twice records one withdrawal. A sign-up retry for an existing email is a 409 and touches nothing.
- **Never inferred**: confirming the email address, signing in, resetting a password, changing the study-reminder preference, being an existing account, or any activity does not grant, refresh or restore consent. `services/marketing-consent.ts` is the only code that writes it.

## Withdrawal and unsubscribe

Every marketing email carries the unsubscribe links from `marketingUnsubscribeLinks()` — the page link and the RFC 8058 one-click link — with `category=marketing`. One click withdraws the consent. The campaign re-checks consent for every recipient **immediately before** each email, so a withdrawal between the dry run and the send is honoured.

**A behaviour change you should know about.** Before this feature, the campaign’s unsubscribe link was the daily-study-email link, so clicking it also switched off the study reminder emails (the old footer even said so: “it also turns off Exama’s daily study emails”). No campaign email had ever been sent, so nobody relied on that. Now the link stops the **marketing category only**; the footer says the study reminder emails are a separate setting, and the unsubscribe page offers, as an explicit second button, to stop the study reminder emails too (`category=all`). Reasons and consequences:

- It matches the premise of two categories: one control does not silently switch off a different service the person did not complain about.
- The study reminder emails’ own link behaves exactly as before (study reminders only), so links in emails already sent keep working with their old meaning.
- Risk: someone who wanted “no more email at all” and clicks only the first button keeps getting the study reminder emails until they use their own link or the second button. The second button and the footer sentence exist to make that choice visible; spam complaints are the thing to watch in `report`.

## Eligibility for the reactivation campaign

An account is emailed only if **all** hold (`reactivation-campaign.ts`): explicit marketing consent on record (not withdrawn) · confirmed address · not suppressed or bounced or complained · adult age group · Free and never paid, no owner · not new, not recently active, no other Exama email in 7 days · (step 2) did not return, click or make a plan. Consent is checked again just before each send. Verified without consent → excluded (`no_marketing_consent`). Consent without a confirmed address → excluded (`not_verified`): the confirmation acts as the second step of a double opt-in. The study-reminder switch plays **no** part: someone who said yes to marketing and switched study reminders off stays eligible, and one who never said yes stays out whatever that switch says (the two categories are independent, tested).

Sending stays locked by `REACTIVATION_CAMPAIGN_SEND`, a per-run limit and an approval code. Deploying, migrating and testing send nothing.

## Existing accounts

The migration gives **nobody** a consent: the columns are added empty, with no default, and a test checks every pre-existing row afterwards. Existing accounts stay out of marketing until they say yes themselves. The safe way to ask them:

1. **In the app, never by email** (asking for marketing consent by email is itself marketing). Account → Emails from Exama already shows the switch, off, with the full wording; turning it on is the explicit yes, recorded with source `account`.
2. Optional, if the volume is worth it: a **one-time, dismissible, in-app card** (not a blocking dialog) on the home screen of signed-in accounts that have no consent record and have not seen it, with the same wording and two equal buttons (“Yes” / “No thanks”), remembering the choice on the device. Not built; it needs its own copy and a decision about frequency.
3. Existing accounts that predate the age question have no age group and can never pass the campaign’s adult-only rule, so a consent from them would be inert until an in-app age prompt exists (`who-we-can-email.md`).

Nothing treats verification, activity or account age as consent.

## What still needs legal review before any marketing email is sent

1. **The wording above in all four languages** (and whether the hint line belongs inside the consent text or beside it).
2. **Privacy policy**: add a sentence that, if the person ticks the box or turns the switch on, Exama emails tips, news, offers and invitations to come back, that they can withdraw at any time, and that the study reminder emails are separate. Suggested sentence (EN): “If you tick the box when you sign up, or switch on Emails from Exama in Account, we also send you tips, news about new features, offers and invitations to come back. You can withdraw this at any time with the link in every such email or in Account. This is separate from the study reminder emails.” Not applied: the policy is legal text for counsel to approve (`apps/mobile/src/i18n/legal.ts`).
3. **Minors**: the box is shown to every age group and a consent from 13–17 is recorded, but the campaign never emails under-18s. In several EU countries a 13–15-year-old cannot consent on their own (GDPR Art. 8; Spain 14, France 15, default 16). Decide whether to hide the box for under-18 answers or keep it recorded-but-inert.
4. **Legal basis wording** in the register (consent, GDPR 6(1)(a) and ePrivacy Art. 13) and the record-keeping period for the consent log.
5. **The unsubscribe decoupling** above, and the suppression list (`email_suppressions` keeps an address after account deletion).
6. **Sender identity** in the campaign footer (legal entity and address) is still a placeholder setting (`CAMPAIGN_SENDER_*`).

## How to check it

`npm run email:audiences:prod -w @study/api` shows, among other counts, how many accounts have consent and how many could be emailed. Tests: `apps/api/test/marketing-consent.test.ts` (sign-up ticked and unticked, tampering, retries, verification, withdrawal, existing accounts, database constraints, deletion, migration on a fresh and on an existing database), `apps/api/test/reactivation-campaign.test.ts` (consent in the audience and re-checked before each send, marketing unsubscribe links), `apps/mobile/test/marketing-consent.test.ts` (wording pinned, four languages, right-to-left, the checkbox, the Account switch, the unsubscribe page).
