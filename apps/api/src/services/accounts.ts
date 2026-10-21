/**
 * Student and organization accounts are SEPARATE identities. The same email address can have one of each
 * (users is unique on (email, account_type)), each with its own password, sessions, verification, data and
 * permissions. Nothing ever links them: no membership, role or data is shared or granted because two accounts
 * have the same address.
 *
 * Every signed-out lookup by email goes through `findAccount`, which names the account type:
 *   - given (the app's sign-in / reset forms send it): exactly that account;
 *   - absent (older app versions, links in old emails): the student account if the email has one, otherwise the
 *     organization account — so every account that existed before the split keeps signing in exactly as before.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { AccountType, User } from '@study/shared';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export type UserRow = typeof users.$inferSelect;
type Exec = Pick<typeof db, 'select'>;

/**
 * The API's view of an account. `b2bRole` appears only on the B2B owner's organization account (every other answer is
 * exactly as before); it only tells the app to show the dashboard link — the server checks the role on every request.
 */
export const toUser = (u: UserRow, organizations: User['organizations'] = []): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  accountType: u.accountType,
  organizations,
  ...(u.accountType === 'organization' && u.b2bRole ? { b2bRole: u.b2bRole } : {}),
});

export async function findAccount(email: string, accountType?: AccountType, exec: Exec = db): Promise<UserRow | null> {
  if (accountType) {
    const [row] = await exec.select().from(users).where(and(eq(users.email, email), eq(users.accountType, accountType)));
    return row ?? null;
  }
  // 'organization' > 'student' alphabetically: order so the student account comes first.
  const rows = await exec.select().from(users).where(eq(users.email, email)).orderBy(asc(users.accountType));
  return rows.find((r) => r.accountType === 'student') ?? rows[0] ?? null;
}

/** Whether `userId` is the B2B owner: an ORGANIZATION account holding b2b_role = owner (read from the database). */
export async function isB2BOwner(userId: string, exec: Exec = db): Promise<boolean> {
  const [row] = await exec
    .select({ b2bRole: users.b2bRole, accountType: users.accountType })
    .from(users)
    .where(eq(users.id, userId));
  return !!row && row.accountType === 'organization' && row.b2bRole === 'owner';
}
