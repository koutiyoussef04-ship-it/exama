/**
 * Shows whether an account resolves to owner (full) access with the current apps/api/.env.
 *   npm run owner:check -- you@example.com
 * Prints the account's user id (to use in OWNER_USER_IDS if you prefer ids over emails).
 */
import { getEntitlement, isOwner } from '../src/billing/entitlements.js';
import { config } from '../src/config.js';
import { sql } from '../src/db/client.js';
import { findAccount } from '../src/services/accounts.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner:check -- you@example.com');
  process.exit(1);
}
// Owner (full) access is for the STUDENT account only; the B2B owner is a separate organization account (npm run b2b:owner).
const user = await findAccount(email, 'student');
if (!user) {
  console.error(`✖ No student account with email ${email}. Sign up in the app first.`);
  await sql.end();
  process.exit(1);
}
const owner = await isOwner(user.id);
const e = await getEntitlement(user.id);
console.log(`User id:        ${user.id}`);
console.log(`Owner configured: OWNER_EMAILS ${config.OWNER_EMAILS.length} entr${config.OWNER_EMAILS.length === 1 ? 'y' : 'ies'}, OWNER_USER_IDS ${config.OWNER_USER_IDS.length}`);
console.log(`Resolves to:    ${owner ? '✓ OWNER — full access (status "complimentary")' : `✖ not owner — ${e.status} / ${e.tier}`}`);
await sql.end();
