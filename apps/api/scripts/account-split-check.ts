/**
 * READ-ONLY pre-flight / post-deploy check for the student / organization account split (migration 0024).
 * Changes nothing. Prints counts, and masked emails only where a person has to act.
 *
 *   npm run accounts:split-check -w @study/api          (local, apps/api/.env)
 *   npm run accounts:split-check:prod -w @study/api     (on the API server: DATABASE_URL from the environment)
 *
 * What it looks for (see docs/b2b-accounts.md):
 *   1. student accounts holding organization memberships — after the split they no longer reach those organizations;
 *   2. organizations without an admin that is an organization account — nobody could manage them in the workspace;
 *   3. organization accounts with personal (student-area) courses — no longer reachable from those accounts;
 *   4. emails with both account types and B2B owners — expected 0 before the deploy and before provisioning.
 * Works before migration 0024 too (it then reports b2b_role as not present yet).
 */
import { sql } from '../src/db/client.js';

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');
try {
  const byType = await sql<{ account_type: string; n: number }[]>`select account_type, count(*)::int as n from users group by account_type order by account_type`;
  console.log('Accounts by type:', Object.fromEntries(byType.map((r) => [r.account_type, r.n])));

  const [both] = await sql<{ n: number }[]>`select count(*)::int as n from (select email from users group by email having count(distinct account_type) > 1) x`;
  console.log(`Emails with both a student and an organization account: ${both.n}`);

  const [col] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_name = 'users' and column_name = 'b2b_role'`;
  if (col.n) {
    const [owners] = await sql<{ n: number }[]>`select count(*)::int as n from users where b2b_role = 'owner'`;
    console.log(`B2B owners: ${owners.n}`);
  } else console.log('B2B owners: column b2b_role not present yet (migration 0024 not applied)');

  const students = await sql<{ email: string; org: string; role: string }[]>`
    select u.email, o.name as org, m.role from organization_members m
    join users u on u.id = m.user_id join organizations o on o.id = m.organization_id
    where u.account_type = 'student' order by o.name`;
  console.log(`\n1. Student accounts holding organization memberships: ${students.length}`);
  for (const r of students) console.log(`   ${r.org}: ${mask(r.email)} (${r.role})`);

  const orphans = await sql<{ name: string }[]>`
    select o.name from organizations o where not exists (
      select 1 from organization_members m join users u on u.id = m.user_id
      where m.organization_id = o.id and m.role = 'admin' and u.account_type = 'organization') order by o.name`;
  console.log(`\n2. Organizations without an organization-account admin: ${orphans.length}`);
  for (const r of orphans) console.log(`   ${r.name}`);

  const personal = await sql<{ email: string; n: number }[]>`
    select u.email, count(*)::int as n from users u join documents d on d.user_id = u.id and d.organization_id is null
    where u.account_type = 'organization' group by u.email order by u.email`;
  console.log(`\n3. Organization accounts with personal courses: ${personal.length}`);
  for (const r of personal) console.log(`   ${mask(r.email)}: ${r.n} course(s)`);

  const clean = students.length === 0 && orphans.length === 0 && personal.length === 0;
  console.log(`\n${clean ? '✓ Nothing is affected by the split.' : '! Review the items above before (or right after) deploying; see docs/b2b-accounts.md.'}`);
} finally {
  await sql.end();
}
