/**
 * Support: lets an email address sign up again before its 30-day hold ends (e.g. an account deleted by
 * mistake). Only the keyed hash is looked up; nothing about the deleted account exists to show.
 *   npm run account:release-email -w @study/api -- someone@example.com
 *   npm run account:release-email -w @study/api -- someone@example.com --organization   (an organization account's address)
 */
import { sql } from '../src/db/client.js';
import { releaseEmailHold } from '../src/services/email-hold.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim(); // normalized like sign-in (lower case) by the service
const accountType = args.includes('--organization') ? 'organization' : 'student';
if (!email || !email.includes('@')) {
  console.error('Usage: npm run account:release-email -w @study/api -- someone@example.com [--organization]');
  process.exit(1);
}
const released = await releaseEmailHold(email, new Date(), accountType);
console.log(released ? '✓ Restriction lifted: this address can sign up again now.' : 'No active restriction for this address (nothing changed).');
await sql.end();
