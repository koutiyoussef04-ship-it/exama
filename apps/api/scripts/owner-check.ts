/**
 * Shows, for one email address, both of its identities (student and organization accounts are separate):
 *   - the STUDENT account: whether it resolves to owner (full) access — OWNER_EMAILS / OWNER_USER_IDS, server config;
 *   - the ORGANIZATION account: whether it holds the B2B owner role (users.b2b_role, granted only by `npm run b2b:owner`).
 *
 *   npm run owner:check -- you@example.com            (local, apps/api/.env)
 *   npm run owner:check:prod -w @study/api -- you@example.com   (on the API server: DATABASE_URL etc. from the environment)
 *
 * Changes nothing about the accounts (reading the student entitlement may mark an already-lapsed subscription as expired,
 * exactly as any request of that student would). Prints the user ids (to use in OWNER_USER_IDS if you prefer ids).
 */
import { and, count, eq } from 'drizzle-orm';
import { getEntitlement, isOwner } from '../src/billing/entitlements.js';
import { config } from '../src/config.js';
import { db, sql } from '../src/db/client.js';
import { organizationMembers, users } from '../src/db/schema.js';
import { findAccount } from '../src/services/accounts.js';

const email = process.argv.slice(2).find((a) => !a.startsWith('--'))?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner:check -- you@example.com');
  process.exit(1);
}
try {
  console.log(`Owner configured: OWNER_EMAILS ${config.OWNER_EMAILS.length} entr${config.OWNER_EMAILS.length === 1 ? 'y' : 'ies'}, OWNER_USER_IDS ${config.OWNER_USER_IDS.length}`);

  // Student identity: owner (full) access comes from server configuration and applies to the student account only.
  const student = await findAccount(email, 'student');
  if (!student) console.log('Student account:      ✖ none with this email');
  else {
    const owner = await isOwner(student.id);
    const e = owner ? null : await getEntitlement(student.id);
    console.log(`Student account:      ${student.id}`);
    console.log(`  resolves to:        ${owner ? '✓ OWNER — full access (status "complimentary")' : `✖ not owner — ${e!.status} / ${e!.tier}`}`);
  }

  // Organization identity: the B2B owner role (dashboard /b2b-admin, unlimited organization usage when acting).
  const org = await findAccount(email, 'organization');
  if (!org) console.log('Organization account: ✖ none with this email (npm run b2b:owner creates one without a usable password)');
  else {
    const [m] = await db.select({ n: count() }).from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId)).where(and(eq(organizationMembers.userId, org.id), eq(users.accountType, 'organization')));
    console.log(`Organization account: ${org.id}`);
    console.log(`  B2B owner role:     ${org.b2bRole === 'owner' ? '✓ yes — /b2b-admin is available after signing in as "Organization account"' : '✖ no — grant it with npm run b2b:owner'}`);
    console.log(`  email confirmed:    ${org.emailVerifiedAt ? 'yes' : 'no (a password reset by email also confirms it)'}`);
    console.log(`  organizations:      ${Number(m?.n ?? 0)}`);
  }
} finally {
  await sql.end();
}
