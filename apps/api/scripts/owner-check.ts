/**
 * Shows whether an account resolves to owner (full) access with the current apps/api/.env.
 *   npm run owner:check -- you@example.com
 * Prints the account's user id (to use in OWNER_USER_IDS if you prefer ids over emails).
 */
import { eq } from 'drizzle-orm';
import { getEntitlement, isOwner } from '../src/billing/entitlements.js';
import { config } from '../src/config.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner:check -- you@example.com');
  process.exit(1);
}
const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));
if (!user) {
  console.error(`✖ No account with email ${email}. Sign up in the app first.`);
  await sql.end();
  process.exit(1);
}
const owner = await isOwner(user.id);
const e = await getEntitlement(user.id);
console.log(`User id:        ${user.id}`);
console.log(`Owner configured: OWNER_EMAILS ${config.OWNER_EMAILS.length} entr${config.OWNER_EMAILS.length === 1 ? 'y' : 'ies'}, OWNER_USER_IDS ${config.OWNER_USER_IDS.length}`);
console.log(`Resolves to:    ${owner ? '✓ OWNER — full access (status "complimentary")' : `✖ not owner — ${e.status} / ${e.tier}`}`);
await sql.end();
