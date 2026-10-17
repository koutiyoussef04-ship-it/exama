/**
 * Who sees the Account page's Administration section. The answer comes from the server
 * (GET /admin/access: 200 { owner: true } for the owner account, 403 for everyone else) — never from
 * an email or role kept in the app. Hiding the entry is cosmetic: every /admin endpoint checks owner
 * access on the server.
 */

/** The existing dashboard screen (src/app/admin.tsx). */
export const ADMIN_ROUTE = '/admin' as const;

/** Per account, so a cached answer can never carry over to another signed-in user. */
export const adminAccessQueryKey = (userId: string | undefined) => ['admin-access', userId ?? 'signed-out'] as const;

/** Shown only when the server confirmed the owner account; loading, errors and refusals hide it. */
export const showAdminEntry = (access: { owner?: unknown } | null | undefined): boolean => access?.owner === true;
