# Account deletion and the 30-day email restriction

Deleting an account (app: Account → Delete account; API: `DELETE /auth/me` with the password) removes the
account and everything it owns (`apps/api/src/services/account.ts`). Since 2026-10-16 it also starts a
**30-day restriction** on using that email address to sign up again (`apps/api/src/services/email-hold.ts`).

## Why

Without it, a person can delete their account and sign up again at once with the same address — a new
free trial (the `trial_used` flag is deleted with the account) and fresh monthly allowances.

## What is kept, and for how long

| | |
|---|---|
| Table | `deleted_email_holds` (migration `0015_deleted_email_holds`) |
| Columns | `email_hash` (HMAC-SHA256 keyed with `JWT_SECRET` of the normalized address), `expires_at` |
| Not kept | the address, name, user id, IP, reason, anything about the deleted account |
| Duration | exactly 30 days (`DELETED_EMAIL_HOLD_DAYS`) from the moment of the deletion (`expires_at` = deletion time + 30 × 24 h, UTC timestamp, no rounding) |
| Clean-up | expired records are ignored immediately and deleted by a purge on start-up and every 6 hours |
| Written | as the last step of the transaction that deletes the account: a refused, failed or rolled-back deletion leaves no record |

**Normalization:** `normalizeEmail` from `@study/shared`, the same rule sign-up, sign-in, password reset
and email verification use: lower case only. Distinct addresses stay distinct — `ana.lopez@gmail.com`,
`analopez@gmail.com` and `ana+exams@gmail.com` are three different addresses. Rotating `JWT_SECRET` makes
existing records stop matching (they still expire).

**Not recoverable:** the hash is keyed with the server secret, so the address can't be read back, and an
unkeyed hash of a guessed address doesn't match it (`apps/api/test/email-hold.test.ts`).

## What people see

- **Before deleting:** a highlighted note on the delete screen: for 30 days, *their address* can't be used
  to create a new account, and only a one-way coded fingerprint is kept (en, es, fr, ar).
- **After deleting:** the confirmation shows the person who deleted the account the exact date and time
  the address can sign up again (`emailReusableAt`, shown in their time zone).
- **Signing up during the restriction:** `409 signup_email_unavailable` with a generic message and no
  details: "This email address can’t be used to create an account right now. Use a different email
  address, or contact support if you think this is a mistake." It doesn't say the address had an
  account or when it frees up. Checked after the age question and after "email already taken", so those
  answers are unchanged. Note: the code differs from `email_taken`, so someone calling the API directly
  can still tell "not usable now" apart from "has an account".
- Privacy Policy (Retention and deletion) and Terms (Ending your use) state the rule in all four languages.

## Support: lifting a restriction early

For an account deleted by mistake, or when counsel decides an erasure request should end the restriction:

```
npm run account:release-email -w @study/api -- someone@example.com
```

It only deletes the matching active hash row; there is nothing else to look up.

## Tests

`apps/api/test/email-hold.test.ts` (sign-in normalization, distinct addresses stay distinct, generic 409,
exact 30-day end — restricted 1 ms before, free at the end —, only a keyed hash + end time stored and not
recoverable, purge, no record on wrong password or rolled-back transaction, support release, order of the
existing checks), `apps/api/test/stripe-billing.test.ts` (Stripe cancellation fails → no record), `apps/mobile/test/account-deletion.test.ts`
and `apps/mobile/test/legal.test.ts` (warning, exact end time, generic error, disclosures in four languages).
