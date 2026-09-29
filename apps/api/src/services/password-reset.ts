/**
 * Password reset with a one-time code sent by email.
 *
 *   request(email)                 → 202 whatever happens (never reveals whether the email has an
 *                                    account); for an existing account, a 6-digit code is emailed.
 *   confirm(email, code, password) → sets the new password, signs the student in, and ends every
 *                                    older session (tokens issued before the change stop working).
 *
 * Safeguards: only an HMAC of the code is stored; a code expires after 30 minutes, works once and
 * allows 5 attempts; a new request invalidates older codes; requests and attempts are rate-limited
 * per client IP, and emails per account.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
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
}

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

/** Always resolves (the route answers 202); rate limit per IP → 429. */
export async function requestPasswordReset(email: string, language: Language, clientKey: string): Promise<void> {
  resetRequestLimiter.take(clientKey);
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));
  if (!user) return; // same answer as for an existing account
  if (!resetEmailLimiter.tryTake(user.id)) return; // don't flood an inbox; still the same answer

  const code = String(randomInt(0, 10 ** PASSWORD_RESET_CODE_LENGTH)).padStart(PASSWORD_RESET_CODE_LENGTH, '0');
  await db.transaction(async (tx) => {
    // A new code replaces any older unused one.
    await tx.update(passwordResetCodes).set({ usedAt: new Date() }).where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt)));
    await tx.insert(passwordResetCodes).values({
      userId: user.id,
      codeHash: hashCode(user.id, code).toString('hex'),
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60_000),
    });
  });
  void track('password_reset_requested', user.id, {});
  // Not awaited: the response time must not depend on whether an email was sent.
  void sendMail(resetEmail(user.email, code, language)).catch((err) => console.error('[password-reset] email failed:', err instanceof Error ? err.message : err));
}

export async function confirmPasswordReset(email: string, code: string, password: string, clientKey: string): Promise<AuthResponse> {
  resetConfirmLimiter.take(clientKey);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    hashCode('00000000-0000-0000-0000-000000000000', code); // similar work for unknown emails
    throw invalidCode();
  }
  const [row] = await db
    .select()
    .from(passwordResetCodes)
    .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.usedAt), gt(passwordResetCodes.expiresAt, new Date())))
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
  const now = new Date();
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
