/**
 * Grants (or revokes) the B2B owner role: users.b2b_role = 'owner' on an ORGANIZATION account. This is the only way the
 * role is ever set — never by sign-up, never from an email address in configuration — and it never touches the student
 * account that may exist with the same email (a separate identity, with its own owner access through OWNER_EMAILS).
 *
 *   npm run b2b:owner -w @study/api -- --email you@example.com            grant (idempotent)
 *   npm run b2b:owner -w @study/api -- --email you@example.com --revoke   revoke
 *   npm run b2b:owner -w @study/api -- --email you@example.com --check    show the state only
 *   (production: the `:prod` variant, run on the API server, reads DATABASE_URL from the environment)
 *
 * Grant:
 *   - an organization account with that email exists → it gets the role (already owner: nothing changes);
 *   - none exists → an organization account is created WITHOUT a usable password (a random secret that is hashed and
 *     immediately discarded; nobody ever sees it), without an organization, email not confirmed. The owner then signs in
 *     by choosing "Organization" → "Forgot password?": the code goes to the inbox, which also confirms the email.
 * No password is accepted, printed, logged or stored in a readable form by this command.
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { normalizeEmail } from '@study/shared';
import { hashPassword } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { userOnboarding, users } from '../src/db/schema.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = () => {
  console.error('Usage: npm run b2b:owner -w @study/api -- --email you@example.com [--revoke | --check]');
  process.exit(1);
};

const raw = value('email');
if (!raw || !/^\S+@\S+\.\S+$/.test(raw)) usage();
if (flag('password')) {
  console.error('✖ This command never takes a password. The owner sets it with "Forgot password?" on the organization sign-in.');
  process.exit(1);
}
const email = normalizeEmail(raw!);
const masked = email.replace(/^(.).*(@.*)$/, '$1***$2');

const find = async () => {
  const [row] = await db
    .select({ id: users.id, b2bRole: users.b2bRole, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(and(eq(users.email, email), eq(users.accountType, 'organization')));
  return row ?? null;
};

try {
  const existing = await find();
  if (flag('check')) {
    console.log(existing ? `Organization account ${masked}: ${existing.b2bRole === 'owner' ? 'B2B OWNER' : 'not owner'}, email ${existing.verifiedAt ? 'confirmed' : 'not confirmed'}.` : `No organization account for ${masked}.`);
  } else if (flag('revoke')) {
    if (!existing || existing.b2bRole !== 'owner') console.log(`Nothing to revoke: ${masked} is not the B2B owner.`);
    else {
      await db.update(users).set({ b2bRole: null }).where(eq(users.id, existing.id));
      console.log(`✓ B2B owner role revoked for ${masked}. The account itself is unchanged.`);
    }
  } else if (existing?.b2bRole === 'owner') {
    console.log(`✓ ${masked} is already the B2B owner (nothing changed).`);
  } else if (existing) {
    await db.update(users).set({ b2bRole: 'owner' }).where(and(eq(users.id, existing.id), eq(users.accountType, 'organization')));
    console.log(`✓ B2B owner role granted to the existing organization account ${masked}. Its password is unchanged.`);
  } else {
    // A random secret nobody knows: the account can't be signed into until the owner sets a password by email code.
    const unusable = await hashPassword(randomBytes(48).toString('base64url'));
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, name: 'Exama', passwordHash: unusable, accountType: 'organization', b2bRole: 'owner', emailVerificationRequired: true })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!created) throw new Error('An organization account for this email was created at the same time. Run the command again.');
      await tx.insert(userOnboarding).values({ userId: created.id, status: 'skipped', finishedAt: new Date() }).onConflictDoNothing();
    });
    console.log(`✓ Organization account created for ${masked} with the B2B owner role and no usable password.`);
    console.log('  Next: in the app choose "Organization" → Sign in → "Forgot password?", enter this email, and set the password with the emailed code.');
  }
} finally {
  await sql.end();
}
