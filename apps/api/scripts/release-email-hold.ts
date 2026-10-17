/**
 * Support: lets an email address sign up again before its 30-day hold ends (e.g. an account deleted by
 * mistake). Only the keyed hash is looked up; nothing about the deleted account exists to show.
 *   npm run account:release-email -w @study/api -- someone@example.com
 */
import { sql } from '../src/db/client.js';
import { releaseEmailHold } from '../src/services/email-hold.js';

const email = process.argv[2]?.trim(); // normalized like sign-in (lower case) by the service
if (!email || !email.includes('@')) {
  console.error('Usage: npm run account:release-email -w @study/api -- someone@example.com');
  process.exit(1);
}
const released = await releaseEmailHold(email);
console.log(released ? '✓ Restriction lifted: this address can sign up again now.' : 'No active restriction for this address (nothing changed).');
await sql.end();
