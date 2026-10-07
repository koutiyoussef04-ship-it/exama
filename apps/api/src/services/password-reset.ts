/**
 * Password reset with a one-time code sent by email.
 *
 *   request(email)                 → 202 whatever happens (never reveals whether the email has an
 *                                    account); for an existing account, a 6-digit code is emailed.
 *                                    The answer says how long to wait before asking again (see cooldown).
 *   confirm(email, code, password) → sets the new password, signs the student in, and ends every
 *                                    older session (tokens issued before the change stop working).
 *
 * Safeguards: only an HMAC of the code is stored; a code expires after 30 minutes, works once and
 * allows 5 attempts; a new request invalidates older codes; requests and attempts are rate-limited
 * per client IP, and emails per account.
 *
 * Cooldown: once a code has been issued, the same account can't get another one (and no other email
 * is sent) for 15 minutes — the "Send a new code" button and the first request alike. The issue time
 * is the `created_at` of the newest row in `password_reset_codes`, so it survives restarts and can't
 * be dodged by refreshing the app. A request during the cooldown generates nothing, sends nothing
 * and leaves the earlier code valid (30 minutes, 5 attempts, as before). Answers stay identical for
 * unknown emails: they get the same cooldown (kept in memory — there is nothing to store), so the
 * remaining time never tells known and unknown addresses apart.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { PASSWORD_RESET_CODE_LENGTH, type AuthResponse, type Language } from '@study/shared';
import { track } from '../analytics/index.js';
import { hashPassword, signToken } from '../auth/auth.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { passwordResetCodes, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { RateLimiter } from '../lib/rate-limit.js';

export const RESET_CODE_TTL_MINUTES = 30;
export const RESET_MAX_ATTEMPTS = 5;
/** Minimum time between two codes for the same account. */
export const RESET_COOLDOWN_MINUTES = 15;
const COOLDOWN_MS = RESET_COOLDOWN_MINUTES * 60_000;

const TOO_MANY = 'Too many attempts. Please wait a little and try again.';
/** Per client IP: reset requests / code attempts. */
export const resetRequestLimiter = new RateLimiter(10, 15 * 60_000, TOO_MANY);
export const resetConfirmLimiter = new RateLimiter(20, 15 * 60_000, TOO_MANY);
/** Per account: emails sent (silently skipped beyond this, still 202). */
const resetEmailLimiter = new RateLimiter(3, 60 * 60_000, TOO_MANY);
export function resetRateLimits() {
  resetRequestLimiter.reset();
  resetConfirmLimiter.reset();
  resetEmailLimiter.reset();
  cooldownUntil.clear();
}

/**
 * email → when its cooldown ends (ms). Gives unknown emails the same cooldown as real accounts (so the
 * answers can't tell them apart) and also covers a request whose email the per-account limiter skipped.
 * Per process, like the rate limiters above; for real accounts the database is the lasting record.
 */
const cooldownUntil = new Map<string, number>();
const remainingFromMemory = (email: string, now: number) => Math.max(0, (cooldownUntil.get(email) ?? 0) - now);
function startMemoryCooldown(email: string, now: number) {
  cooldownUntil.set(email, now + COOLDOWN_MS);
  if (cooldownUntil.size > 10_000) for (const [k, until] of cooldownUntil) if (until <= now) cooldownUntil.delete(k);
}
const toSeconds = (ms: number) => Math.ceil(ms / 1000);

const hashCode = (userId: string, code: string) => createHmac('sha256', config.JWT_SECRET).update(`password-reset:${userId}:${code}`).digest();
const invalidCode = () => new HttpError(400, 'This code is incorrect or has expired. Request a new code.', 'reset_code_invalid');

const EMAIL: Record<Language, { subject: string; body: (code: string, minutes: number) => string }> = {
  en: {
    subject: 'Your Exama password reset code',
    body: (code, m) => `Your code to reset your Exama password is: ${code}\n\nIt expires in ${m} minutes and can be used once.\n\nIf you didn’t ask to reset your password, you can ignore this email — your password stays the same.`,
  },
  fr: {
    subject: 'Votre code de réinitialisation Exama',
    body: (code, m) => `Votre code pour réinitialiser votre mot de passe Exama : ${code}\n\nIl expire dans ${m} minutes et ne peut servir qu’une fois.\n\nSi vous n’avez pas demandé à réinitialiser votre mot de passe, ignorez cet e-mail : votre mot de passe reste inchangé.`,
  },
  es: {
    subject: 'Tu código para restablecer la contraseña de Exama',
    body: (code, m) => `Tu código para restablecer tu contraseña de Exama es: ${code}\n\nCaduca en ${m} minutos y solo se puede usar una vez.\n\nSi no pediste restablecer tu contraseña, ignora este correo: tu contraseña no cambia.`,
  },
  ar: {
    subject: 'رمز إعادة تعيين كلمة مرور Exama',
    body: (code, m) => `رمز إعادة تعيين كلمة مرور Exama هو: ${code}\n\nتنتهي صلاحيته بعد ${m} دقيقة ويمكن استخدامه مرة واحدة فقط.\n\nإذا لم تطلب إعادة تعيين كلمة المرور، فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.`,
  },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function resetEmail(to: string, code: string, language: Language) {
  const t = EMAIL[language];
  const text = t.body(code, RESET_CODE_TTL_MINUTES);
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const html = `<div dir="${dir}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#15173F">${text
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p).replace(code, `<strong style="font-size:28px;letter-spacing:4px">${code}</strong>`)}</p>`)
    .join('')}</div>`;
  return { to, subject: t.subject, text, html };
}

/**
 * Always resolves (the route answers 202); rate limit per IP → 429. Resolves with how many seconds the
 * caller must wait before asking again: the full cooldown after a request that was handled, the time
 * left when one was already running. `now` is injectable for tests only.
 */
export async function requestPasswordReset(email: string, language: Language, clientKey: string, now = Date.now()): Promise<{ retryAfterSeconds: number }> {
  resetRequestLimiter.take(clientKey);
  const fresh = { retryAfterSeconds: toSeconds(COOLDOWN_MS) };
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));
  const inMemory = remainingFromMemory(email, now);
  if (!user) {
    // Same answer as for an existing account, including the cooldown.
    if (inMemory > 0) return { retryAfterSeconds: toSeconds(inMemory) };
    startMemoryCooldown(email, now);
    return fresh;
  }

  const code = String(randomInt(0, 10 ** PASSWORD_RESET_CODE_LENGTH)).padStart(PASSWORD_RESET_CODE_LENGTH, '0');
  const outcome = await db.transaction(async (tx): Promise<{ kind: 'throttled'; ms: number } | { kind: 'skipped' } | { kind: 'issued' }> => {
    // One request at a time per account, so two parallel requests can't both get a code.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`);
    const [last] = await tx
      .select({ createdAt: passwordResetCodes.createdAt })
      .from(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, user.id))
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);
    const remaining = Math.max(inMemory, last ? last.createdAt.getTime() + COOLDOWN_MS - now : 0);
    // Cooldown running: no new code, no email, and the earlier code stays valid.
    if (remaining > 0) return { kind: 'throttled', ms: remaining };
    startMemoryCooldown(email, now);
    if (!resetEmailLimiter.tryTake(user.id, now)) return { kind: 'skipped' }; // don't flood an inbox; still the same answer
    // A new code replaces any older unused one.
    await tx.update(passwordResetCodes).set({ usedAt: new Date(now) }).where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt)));
    await tx.insert(passwordResetCodes).values({
      userId: user.id,
      codeHash: hashCode(user.id, code).toString('hex'),
      createdAt: new Date(now), // the cooldown starts here (set by the app, not the database clock)
      expiresAt: new Date(now + RESET_CODE_TTL_MINUTES * 60_000),
    });
    return { kind: 'issued' };
  });
  if (outcome.kind === 'throttled') return { retryAfterSeconds: toSeconds(outcome.ms) };
  if (outcome.kind === 'skipped') return fresh;

  void track('password_reset_requested', user.id, {});
  // Not awaited: the response time must not depend on whether an email was sent.
  void sendMail(resetEmail(user.email, code, language)).catch((err) => console.error('[password-reset] email failed:', err instanceof Error ? err.message : err));
  return fresh;
}

export async function confirmPasswordReset(email: string, code: string, password: string, clientKey: string, nowMs = Date.now()): Promise<AuthResponse> {
  resetConfirmLimiter.take(clientKey);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    hashCode('00000000-0000-0000-0000-000000000000', code); // similar work for unknown emails
    throw invalidCode();
  }
  const [row] = await db
    .select()
    .from(passwordResetCodes)
    .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt), gt(passwordResetCodes.expiresAt, new Date(nowMs))))
    .orderBy(desc(passwordResetCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= RESET_MAX_ATTEMPTS) throw invalidCode();

  const expected = Buffer.from(row.codeHash, 'hex');
  const given = hashCode(user.id, code);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const attempts = row.attempts + 1;
    await db
      .update(passwordResetCodes)
      .set({ attempts, ...(attempts >= RESET_MAX_ATTEMPTS ? { usedAt: new Date() } : {}) })
      .where(eq(passwordResetCodes.id, row.id));
    throw invalidCode();
  }

  const passwordHash = await hashPassword(password);
  const now = new Date(nowMs);
  const changedAt = now; // older tokens carry another `pwc` → session_expired
  const claimed = await db.transaction(async (tx) => {
    const used = await tx
      .update(passwordResetCodes)
      .set({ usedAt: now })
      .where(and(eq(passwordResetCodes.id, row.id), isNull(passwordResetCodes.usedAt)))
      .returning({ id: passwordResetCodes.id });
    if (!used.length) return false; // used by a parallel request
    await tx.update(passwordResetCodes).set({ usedAt: now }).where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt)));
    await tx.update(users).set({ passwordHash, passwordChangedAt: changedAt }).where(eq(users.id, user.id));
    return true;
  });
  if (!claimed) throw invalidCode();
  void track('password_reset_completed', user.id, {});
  return { token: await signToken(user.id, changedAt), user: { id: user.id, email: user.email, name: user.name } };
}
