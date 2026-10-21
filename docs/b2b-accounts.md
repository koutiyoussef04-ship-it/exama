# Student and organization accounts, and the B2B owner

## Two separate identities

A student account and an organization account are separate identities, even with the same email address.

- `users` is unique on `(email, account_type)` (migration `0024_separate_account_identities`). The old unique constraint on `email` alone is gone.
- Each identity has its own:
  - password
  - sessions
  - password-reset codes
  - email verification
  - 30-day deletion hold
  - memberships
  - data
- Nothing is linked, shared or granted because two addresses match.

### How an email is resolved

Every signed-out lookup by email goes through `findAccount(email, accountType?)` in `apps/api/src/services/accounts.ts`.

- **Account type given:** the app's sign-in, forgot-password and sign-up forms send it. Exactly that identity is used.
- **Account type absent:** older app versions and old emails send none. The student account is used if the email has one, otherwise the organization account. Every account that existed before the split keeps signing in as before.

### Sessions

Tokens carry an `act` claim (the account type), and `requireAuth` refuses a token whose claim doesn't match the account. Tokens issued before the claim existed have none and stay valid.

### Isolation rules

All of these are enforced on the server.

- **Organizations:** only organization accounts are members. `getMembership`, `listMemberships` and `listMembers` ignore student accounts, including any membership row left over from before the split.
- **Adding members:** adding a member by email matches organization accounts only. An address that only has a student account gets `404 user_not_found`.
- **Student areas:** `/documents`, `/exams` and `/flashcards` answer `403 student_account_required` to organization accounts.
- **Student billing:** `/billing/purchase`, `/restore`, `/stripe/checkout`, `/stripe/portal`, `/cancel` and `/mock/state` also answer `403 student_account_required` to organization accounts. `/billing/status` stays readable.
- **Student owner:** `OWNER_EMAILS` matches student accounts only (`isOwner`, and the admin dashboard's category SQL). `OWNER_USER_IDS` matches the exact account id.
- **Deletion holds:** holds are per account type. Student holds keep their original hash, so existing holds still match. Organization holds hash `deleted-email-hold:organization:<email>`. To lift an organization hold, run `npm run account:release-email -w @study/api -- someone@example.com --organization`.

### Organization sign-up

An organization sign-up either:

- **Creates an organization:** it needs a name and a market, as before.
- **Joins one:** it sends no organization fields. The account is created without an organization, and an admin of the existing organization adds it by email.

## B2B owner

The B2B owner is `users.b2b_role = 'owner'` on an organization account. A database check refuses the role on any other account type.

- **Dashboard:** `/b2b-admin/*` (overview, organizations, organization detail, plan / pilot / suspension changes, organization accounts). `requireB2BOwner` reads the role from the database on every request and answers `404` to everyone else. Requests are written to `admin_audit_log` with a `b2b …` action. The app shows the dashboard under Account → Administration and in the workspace sidebar. Hiding it elsewhere is cosmetic.
- **Unlimited usage:** this applies when the B2B owner itself acts. Course uploads, draft generation, reprocessing, the organization cap and the admin/editor seat limit are not refused. Usage is still recorded in the ledger. The per-request size cap (`maxItemsPerRequest`) and the anti-abuse rate limits still apply. Other members of the same organization are bound by its plan.
- **Granting the role:** only the server command below grants it. Sign-up never does, configuration never does, and an email address never does.

### Provisioning (idempotent, no password involved)

Run on the API server (Render → exama-api → Shell), after migration 0024 has been applied:

```
npm run b2b:owner:prod -w @study/api -- --email you@example.com --check
npm run b2b:owner:prod -w @study/api -- --email you@example.com
```

What the command does:

- **An organization account exists for the email:** it gets the role, and its password is unchanged.
- **None exists:** an organization account is created with the role and an unusable password: a random secret, hashed and discarded. It has no organization and its email is unconfirmed.
- **Already the owner:** nothing changes.
- **Never:** it never touches the student account with the same email, and never accepts, prints or stores a password. A `--password` flag is refused. Output masks the email.

The owner then sets a password in the app:

1. Sign in.
2. Choose **Organization account**.
3. Choose **Forgot password?**.
4. Enter the email.
5. Enter the emailed code and a new password.

The code also confirms the email.

To revoke the role: `npm run b2b:owner:prod -w @study/api -- --email you@example.com --revoke` (the account stays).

## Upgrade and rollback

Migration 0024:

1. Creates the `(email, account_type)` unique index **before** dropping the email-only constraint.
2. Adds `b2b_role` and its check.

It runs automatically as the API's pre-deploy step.

Rollback works only while no email has both account types. The statements are in the migration's header.

Read-only checks to run in production after deploying:

```sql
-- Student accounts holding organization memberships (they no longer reach those organizations)
select o.name, m.role, u.email from organization_members m join users u on u.id = m.user_id join organizations o on o.id = m.organization_id where u.account_type = 'student';
-- Organizations without an organization-account admin
select o.id, o.name from organizations o where not exists (select 1 from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'admin' and u.account_type = 'organization');
-- Organization accounts with personal (student-area) courses, no longer reachable from those accounts
select u.email, count(*) from users u join documents d on d.user_id = u.id and d.organization_id is null where u.account_type = 'organization' group by u.email;
```
