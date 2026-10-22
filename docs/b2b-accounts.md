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

### Choosing which account to sign in to

Choosing a type is not authenticating: `POST /auth/login` only ever issues a session for the identity whose password matched.

- **Every "Log in" on the website is a two-way choice** ("Log in as a student" / "Log in as an organization"), on the home, student and organizations pages in all four languages. Each entry opens the app's `/start?mode=signin&account=student|organization`, and the sign-in form opens on that type. Opened directly, the form starts on the student account; the chips switch it.
- **Right password, wrong type:** when the chosen type fails but the same email and password are valid for the *other* identity, the API answers `403 wrong_account_type` with `details.accountType` and **no token**. The app shows the message and a button "Sign in to the … account instead", which re-submits with the other type; the person chooses. This reveals nothing the caller could not learn by trying the other sign-in with the password they hold: with a wrong password the answer is `401 invalid_credentials` whether or not either account exists, and an unknown email answers exactly like a wrong password.
- **Both identities:** the chips decide; the server authenticates only that one.
- **Already signed in to the other identity:** a `/start` link naming an account type that is not the current session's (for example "Log in as an organization" while a student session is open) goes to `/switch-account`, never into the current session. That screen (also reachable from Account → Switch account) signs out first, then opens the sign-in on the other type, where the person types that account's own password. Nothing is merged and no session is carried over. Links without an account type keep whatever session there is.
- **Password recovery** stays per identity (`accountType` on the request and confirm calls; the organization email's subject says so).

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

- **Creates an organization:** it needs a name and a category (`market`), one of `ORGANIZATION_CATEGORIES` in `packages/shared/src/organizations.ts`: `university`, `school`, `training_center`, `corporate`, `exam_prep`, `other` (for French-speaking markets and the Gulf). Organizations created before those categories keep `training_provider` or `academy` (`LEGACY_ORGANIZATION_MARKETS`): still valid, displayed and, for `academy`, still driving its workspace defaults (multiple-choice only, legal-reference fields), but no longer offered to new sign-ups or to `POST /orgs`. Migration 0025 only widened the database CHECK constraint to the eight values; it rewrote no row.
- **Joins one:** it sends no organization fields. The account is created without an organization, and an admin of the existing organization adds it by email.

## Plans and manual pilots

- **No automatic pilot.** A new organization (sign-up or `POST /orgs`) has `plan = 'none'`: it can sign in, see its workspace and add reviewers, but uploads, AI drafts and reprocessing answer `402 org_plan_required` until the owner assigns a plan. The workspace says so in all four languages. Migration 0026 made `'none'` a valid value and the column default.
- **Paid plans** (`ORGANIZATION_PLAN_CATALOG`): Esencial €149/month · €1,490/year (10 course uploads, 500 question drafts per month, 10 admins/editors), Profesional €349/month · €3,490/year (100 / 2,000 / 25), Centro custom (owner overrides). Prices exclude VAT. Reviewers are unlimited; at most 20 drafts per request. Billing is manual until the Stripe integration (`docs/b2b-stripe-plan.md`).
- **Pilots are negotiated, then granted by hand** by the B2B owner (owner dashboard → organization → "Grant a pilot", or `PATCH /b2b-admin/organizations/:id` / `PATCH /admin/organizations/:id` with `{ plan: 'pilot', pilotEndsAt?, limits? }`):
  - it starts at the moment of the grant (`pilot_started_at`) and ends at `pilotEndsAt` (in the future, at most 365 days away) or after 30 days;
  - its allowances are the pilot defaults (5 courses, 150 drafts, 3 admins/editors, as totals for the whole pilot) or the agreed ones in `limits`;
  - **extend:** a later `pilotEndsAt`; **end now (revoke):** `pilotEndsAt` = now — the pilot stays on record (start and end dates) and stops at once;
  - after its end: `402 org_pilot_expired` for uploads, AI drafts and reprocessing; reading, review and exports keep working. The owner extends it or assigns a plan;
  - assigning a paid plan or `none` keeps the last pilot's dates as a record (they only apply while the plan is `pilot`).
- **Who can change it:** only the B2B owner (`/b2b-admin`, audited with `params.change`) and the student-side owner tools (`/admin/organizations`, audited with the organization id and the change). An organization's own admins cannot: `PATCH /orgs/:id` only renames, `POST /orgs` ignores plan fields, and the owner endpoints answer 403/404.
- **Existing organizations** kept their plan when 0026 ran: pilots granted automatically before it run until their end date, unless the owner ends them.

## B2B owner

The B2B owner is `users.b2b_role = 'owner'` on an organization account. A database check refuses the role on any other account type.

- **Dashboard:** `/b2b-admin/*` (overview, organizations, organization detail, plan / pilot / suspension changes, organization accounts; see "Plans and manual pilots" below), in English, Spanish, French and Arabic like the rest of the app. The route's owner check (`ownerOnlyAudited` in `routes/b2b-admin.ts`) reads the role from the database on every request and answers `404` to everyone else.
- **Audit:** every request is written to `admin_audit_log` with a `b2b …` action. Changes also record what they set (`params.change`, e.g. `{"status":"suspended"}`). Refused attempts by other accounts are recorded with `allowed = false`. No passwords, tokens or hashes are ever stored there.
- **Where the owner finds it:** sign in with **Organization account** selected. The dashboard is in the workspace sidebar, under Account → Administration, and on the empty workspace screen. Hiding it elsewhere is cosmetic. Signing in with **Student account** (same email) never shows it.
- **Unlimited usage:** this applies when the B2B owner itself acts. Course uploads, draft generation, reprocessing, the organization cap and the admin/editor seat limit are not refused. Usage is still recorded in the ledger. The per-request size cap (`maxItemsPerRequest`) and the anti-abuse rate limits still apply. Other members of the same organization are bound by its plan.
- **Granting the role:** only the server command below grants it. Sign-up never does, configuration never does, and an email address never does.

### Provisioning (idempotent, no password involved)

Run on the API server (Render → exama-api → Shell), after migration 0024 has been applied:

```
npm run owner:check:prod -w @study/api -- you@example.com
npm run b2b:owner:prod -w @study/api -- --email you@example.com --check
npm run b2b:owner:prod -w @study/api -- --email you@example.com
```

`owner:check` shows both identities of the address: whether the student account resolves to owner (full) access, and whether the organization account holds the B2B owner role.

What the command does:

- **An organization account exists for the email:** it gets the role, and its password is unchanged.
- **None exists:** an organization account is created with the role and an unusable password: a random secret, hashed and discarded. It has no organization and its email is unconfirmed.
- **Already the owner:** nothing changes.
- **Never:** it never touches the student account with the same email, and never accepts, prints or stores a password. A `--password` flag is refused. Output masks the email.

If the organization account already existed (for example, created through public sign-up), the owner keeps signing in with that account's own password: choose **Organization account** on the sign-in form.

If the command created the account, the owner sets a password in the app:

1. Sign in.
2. Choose **Organization account**.
3. Choose **Forgot password?**.
4. Enter the email.
5. Enter the emailed code and a new password.

The code also confirms the email.

To revoke the role: `npm run b2b:owner:prod -w @study/api -- --email you@example.com --revoke` (the account stays).

## Upgrade and rollback

### Before deploying: read-only check

Run in the Render Shell of exama-api (it changes nothing, and masks emails):

```
npm run accounts:split-check:prod -w @study/api
```

It reports:

1. student accounts holding organization memberships;
2. organizations without an organization-account admin;
3. organization accounts with personal courses;
4. emails with both account types and B2B owners (both 0 before the deploy).

Items 1–3 are people who lose access at the split. If any are found:

- **Item 1:** the person signs up as an organization account ("Join an existing organization"). An organization admin then adds them by email. Nothing is linked automatically.
- **Item 2:** if the only admin was a student account, nobody can manage the organization in the workspace any more. After that person has created an organization account, the owner adds it explicitly, once, on the server:

  ```sql
  insert into organization_members (organization_id, user_id, role, added_by)
  select '<organization id>', u.id, 'admin', u.id from users u
  where u.email = '<their email>' and u.account_type = 'organization';
  ```

  This is a deliberate owner action for a named person, never an automatic email match.
- **Item 3:** the courses stay in the database. Tell the person to use a student account for personal study.

### What migration 0024 does

The migration runs as the API's pre-deploy step, inside one transaction:

1. Creates the `(email, account_type)` unique index **before** dropping the email-only constraint.
2. Adds the nullable `b2b_role` column (metadata only).
3. Adds the check constraint (a fast scan; every value is null).

It is safe for existing data:

- **No conflicts:** every existing email is already unique, so the new index can't conflict.
- **Locks:** the locks on `users` last as long as the index build, which is milliseconds for this table's size.

### During the deploy

The old API keeps serving until the new one is live. Old code works with the new schema:

- It selects only the columns it knows, so it ignores `b2b_role`.
- It still refuses a second account for an email, so no duplicates appear before the new code runs.

### Rollback

Code rollback to a version before this change is safe **only while no email has both account types**: `accounts:split-check` reports this. Once duplicates exist, older code would sign in to or add whichever row the database returns first.

To roll back the schema (same condition), use the statements in the migration's header.

### Read-only checks (SQL)

The same checks as the script, as SQL:

```sql
-- Student accounts holding organization memberships (they no longer reach those organizations)
select o.name, m.role, u.email from organization_members m join users u on u.id = m.user_id join organizations o on o.id = m.organization_id where u.account_type = 'student';
-- Organizations without an organization-account admin
select o.id, o.name from organizations o where not exists (select 1 from organization_members m join users u on u.id = m.user_id where m.organization_id = o.id and m.role = 'admin' and u.account_type = 'organization');
-- Organization accounts with personal (student-area) courses, no longer reachable from those accounts
select u.email, count(*) from users u join documents d on d.user_id = u.id and d.organization_id is null where u.account_type = 'organization' group by u.email;
```
