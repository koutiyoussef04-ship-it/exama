/**
 * Email verification after sign-up.
 *
 *   sign-up            → a link to <web app>/verify-email#token=… is emailed (in the background:
 *                        sign-up never fails because of email). The token sits in the URL fragment,
 *                        so browsers never send it to a server (no access/CDN logs).
 *   verify(token)      → marks the email verified. Unknown tokens are "invalid", tokens past their
 *                        24 hours (or replaced by a newer link) "expired", and a token works once.
 *   resend (signed in) → a new link, at most every 60 seconds and 5 an hour per account; a failed
 *                        send says so and doesn't use up the cooldown.
 *   request(email)     → the same for a signed-out student: always the same answer, whether or not
 *                        the email has an account (or is already verified), so it reveals nothing.
 *
 * Only an HMAC (keyed with JWT_SECRET) of the 32-byte random token is stored; tokens are never logged.
 *
 * Who is asked: accounts created after this feature (`email_verification_required`), and only while
 * email can actually be sent. Older accounts are never asked or restricted.
 * What is enforced: with EMAIL_VERIFICATION_REQUIRED=true, an unverified new account keeps full access
 * for EMAIL_VERIFICATION_GRACE_HOURS after sign-up; after that, courses and exams (/documents, /exams —
 * everything that costs AI work) answer 403 email_not_verified until the email is confirmed. Sign-in,
 * account, onboarding, billing and account deletion always keep working.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import {
  EMAIL_VERIFICATION_RESEND_SECONDS,
  EMAIL_VERIFICATION_TTL_HOURS,
  type EmailVerificationState,
  type Language,
  type ResendVerificationResult,
  type VerifyEmailResult,
} from '@study/shared';
import { track } from '../analytics/index.js';
import { verifyToken } from '../auth/auth.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { emailVerificationTokens, users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { RateLimiter } from '../lib/rate-limit.js';

const TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 3_600_000;
const COOLDOWN_MS = EMAIL_VERIFICATION_RESEND_SECONDS * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

const TOO_MANY = 'Too many attempts. Please wait a little and try again.';
/** Per client IP: link checks, and signed-out "send me a new link" requests. */
export const verifyLimiter = new RateLimiter(30, 15 * 60_000, TOO_MANY);
export const requestLimiter = new RateLimiter(10, 15 * 60_000, TOO_MANY);
/** Per account: verification emails (beyond this: 429 when signed in, silently nothing when signed out). */
const emailLimiter = new RateLimiter(5, 60 * 60_000, TOO_MANY);
export function resetVerificationRateLimits() {
  verifyLimiter.reset();
  requestLimiter.reset();
  emailLimiter.reset();
  cooldownUntil.clear();
}

/** email → end of its signed-out cooldown (ms); gives unknown emails the same answers as real accounts. */
const cooldownUntil = new Map<string, number>();
function startMemoryCooldown(email: string, now: number) {
  cooldownUntil.set(email, now + COOLDOWN_MS);
  if (cooldownUntil.size > 10_000) for (const [k, until] of cooldownUntil) if (until <= now) cooldownUntil.delete(k);
}
const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

const hashToken = (token: string) => createHmac('sha256', config.JWT_SECRET).update(`email-verification:${token}`).digest('hex');

/** Email can be sent and a link can be built: otherwise nobody is asked (or restricted). */
export const verificationAvailable = () => config.EMAIL_PROVIDER !== 'disabled' && !!config.WEB_APP_URL;

// ---------- Email ----------

const EMAIL: Record<Language, { subject: string; intro: string; button: string; outro: (h: number) => string }> = {
  en: {
    subject: 'Confirm your email for Exama',
    intro: 'Welcome to Exama! Please confirm that this is your email address:',
    button: 'Confirm my email',
    outro: (h) => `The link works once and expires in ${h} hours. If you didn’t create an Exama account, you can ignore this email.`,
  },
  fr: {
    subject: 'Confirmez votre adresse e-mail pour Exama',
    intro: 'Bienvenue sur Exama ! Confirmez qu’il s’agit bien de votre adresse e-mail :',
    button: 'Confirmer mon e-mail',
    outro: (h) => `Le lien ne fonctionne qu’une fois et expire dans ${h} heures. Si vous n’avez pas créé de compte Exama, ignorez cet e-mail.`,
  },
  es: {
    subject: 'Confirma tu correo para Exama',
    intro: '¡Te damos la bienvenida a Exama! Confirma que esta es tu dirección de correo:',
    button: 'Confirmar mi correo',
    outro: (h) => `El enlace funciona una sola vez y caduca en ${h} horas. Si no creaste una cuenta de Exama, ignora este correo.`,
  },
  ar: {
    subject: 'أكّد بريدك الإلكتروني في Exama',
    intro: 'مرحبًا بك في Exama! يُرجى تأكيد أن هذا هو بريدك الإلكتروني:',
    button: 'تأكيد بريدي الإلكتروني',
    outro: (h) => `يعمل الرابط مرة واحدة فقط وتنتهي صلاحيته بعد ${h} ساعة. إذا لم تُنشئ حسابًا في Exama، فتجاهل هذه الرسالة.`,
  },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const verificationLink = (token: string) => `${config.WEB_APP_URL}/verify-email#token=${token}`;

function verificationEmail(to: string, token: string, language: Language) {
  const t = EMAIL[language] ?? EMAIL.en;
  const link = verificationLink(token);
  const outro = t.outro(EMAIL_VERIFICATION_TTL_HOURS);
  const text = `${t.intro}\n\n${link}\n\n${outro}`;
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#15173F">` +
    `<p>${escapeHtml(t.intro)}</p>` +
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#5B4CF5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(t.button)}</a></p>` +
    `<p style="font-size:13px;color:#646A7E;word-break:break-all">${escapeHtml(link)}</p>` +
    `<p style="font-size:14px;color:#646A7E">${escapeHtml(outro)}</p></div>`;
  return { to, subject: t.subject, text, html };
}

// ---------- State ----------

type AccountRow = { id: string; createdAt: Date; emailVerifiedAt: Date | null; emailVerificationRequired: boolean };

export function stateOf(u: AccountRow, now = Date.now()): EmailVerificationState {
  const verified = !!u.emailVerifiedAt;
  const required = u.emailVerificationRequired && verificationAvailable();
  const from = required && !verified && config.EMAIL_VERIFICATION_REQUIRED ? new Date(u.createdAt.getTime() + config.EMAIL_VERIFICATION_GRACE_HOURS * 3_600_000) : null;
  return {
    verified,
    verifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    required,
    restrictedFrom: from?.toISOString() ?? null,
    restricted: !!from && now >= from.getTime(),
  };
}

const accountColumns = { id: users.id, email: users.email, createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt, emailVerificationRequired: users.emailVerificationRequired };

export async function getVerificationState(userId: string): Promise<EmailVerificationState> {
  const [u] = await db.select(accountColumns).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  return stateOf(u);
}

/**
 * Courses and exams for restricted accounts (see the top of this file). Does nothing unless
 * EMAIL_VERIFICATION_REQUIRED=true. Requests without a valid session go on to the route, which answers 401.
 */
export const requireVerifiedEmail = createMiddleware(async (c, next) => {
  if (!config.EMAIL_VERIFICATION_REQUIRED) return next();
  const header = c.req.header('Authorization');
  const userId = await verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
    const [u] = await db.select(accountColumns).from(users).where(eq(users.id, userId));
    if (u) {
      const s = stateOf(u);
      if (s.restricted) throw new HttpError(403, 'Please confirm your email address to keep using Exama.', 'email_not_verified', { restrictedFrom: s.restrictedFrom });
    }
  }
  return next();
});

// ---------- Issuing and sending links ----------

/** New token for the account (older unused links expire). null while the cooldown runs. */
async function issueToken(userId: string, now: number): Promise<{ token: string; id: string } | { cooldownMs: number }> {
  const token = randomBytes(32).toString('base64url');
  return db.transaction(async (tx) => {
    // One at a time per account, so two parallel requests can't both issue a link.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email-verification:${userId}`}))`);
    const [last] = await tx
      .select({ createdAt: emailVerificationTokens.createdAt })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId))
      .orderBy(desc(emailVerificationTokens.createdAt))
      .limit(1);
    const remaining = last ? last.createdAt.getTime() + COOLDOWN_MS - now : 0;
    if (remaining > 0) return { cooldownMs: remaining };
    // A newer link replaces the older ones: they now count as expired.
    await tx
      .update(emailVerificationTokens)
      .set({ expiresAt: new Date(now) })
      .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt), gt(emailVerificationTokens.expiresAt, new Date(now))));
    const [row] = await tx
      .insert(emailVerificationTokens)
      .values({ userId, tokenHash: hashToken(token), createdAt: new Date(now), expiresAt: new Date(now + TTL_MS) })
      .returning({ id: emailVerificationTokens.id });
    return { token, id: row.id };
  });
}

/** A link whose email couldn't be sent is removed, so the student can ask again right away. */
const forget = (id: string) => db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, id));
const logFailure = (err: unknown) => console.error('[email-verification] email failed:', err instanceof Error ? err.message : 'unknown error');

/** After sign-up (not awaited by the route). Never throws. */
export async function sendVerificationAfterSignup(user: { id: string; email: string }, language: Language, now = Date.now()): Promise<void> {
  try {
    if (!verificationAvailable()) return;
    startMemoryCooldown(user.email, now);
    if (!emailLimiter.tryTake(user.id, now)) return;
    const issued = await issueToken(user.id, now);
    if (!('token' in issued)) return;
    await sendMail(verificationEmail(user.email, issued.token, language)).catch(async (err) => {
      logFailure(err);
      await forget(issued.id);
      cooldownUntil.delete(user.email);
    });
  } catch (err) {
    logFailure(err);
  }
}

/** Signed in: send a new link now (or say how long to wait). */
export async function resendVerification(userId: string, language: Language, clientKey: string, now = Date.now()): Promise<ResendVerificationResult> {
  requestLimiter.take(clientKey);
  const [u] = await db.select(accountColumns).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(401, 'Account no longer exists', 'account_deleted');
  if (u.emailVerifiedAt) return { sent: false, retryAfterSeconds: 0, alreadyVerified: true };
  if (!verificationAvailable()) throw new HttpError(503, 'Email can’t be sent right now. Please try again later.', 'email_unavailable');

  const issued = await issueToken(u.id, now);
  if (!('token' in issued)) return { sent: false, retryAfterSeconds: toSeconds(issued.cooldownMs) };
  if (!emailLimiter.tryTake(u.id, now)) {
    await forget(issued.id); // nothing sent: the link and the cooldown don't count
    throw new HttpError(429, TOO_MANY, 'too_many_requests');
  }
  startMemoryCooldown(u.email, now);
  try {
    await sendMail(verificationEmail(u.email, issued.token, language));
  } catch (err) {
    logFailure(err);
    await forget(issued.id);
    cooldownUntil.delete(u.email);
    throw new HttpError(503, 'We couldn’t send the email. Please try again in a moment.', 'email_send_failed');
  }
  return { sent: true, retryAfterSeconds: toSeconds(COOLDOWN_MS) };
}

/** Signed out: same answer for every email (known, unknown, verified); a link is only sent when it makes sense. */
export async function requestVerification(email: string, language: Language, clientKey: string, now = Date.now()): Promise<{ retryAfterSeconds: number }> {
  requestLimiter.take(clientKey);
  const inMemory = Math.max(0, (cooldownUntil.get(email) ?? 0) - now);
  if (inMemory > 0) return { retryAfterSeconds: toSeconds(inMemory) };
  startMemoryCooldown(email, now);
  const fresh = { retryAfterSeconds: toSeconds(COOLDOWN_MS) };

  const [u] = await db.select(accountColumns).from(users).where(eq(users.email, email));
  if (!u || u.emailVerifiedAt || !verificationAvailable() || !emailLimiter.tryTake(u.id, now)) return fresh;
  const issued = await issueToken(u.id, now);
  if (!('token' in issued)) return fresh;
  // Not awaited: the response time must not depend on whether an email was sent.
  void sendMail(verificationEmail(u.email, issued.token, language)).catch(async (err) => {
    logFailure(err);
    await forget(issued.id).catch(() => {});
  });
  return fresh;
}

// ---------- Verifying ----------

const invalid = () => new HttpError(400, 'This link isn’t valid. Request a new one.', 'verification_link_invalid');

export async function verifyEmail(token: string, clientKey: string, now = Date.now()): Promise<VerifyEmailResult> {
  verifyLimiter.take(clientKey);
  if (!TOKEN_FORMAT.test(token)) throw invalid();
  const [row] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, hashToken(token)));
  if (!row) throw invalid();
  if (row.usedAt) {
    const [u] = await db.select({ verified: users.emailVerifiedAt }).from(users).where(eq(users.id, row.userId));
    throw new HttpError(409, 'This link has already been used.', 'verification_link_used', { emailVerified: !!u?.verified });
  }
  if (row.expiresAt.getTime() <= now) throw new HttpError(410, 'This link has expired. Request a new one.', 'verification_link_expired');

  const at = new Date(now);
  const claimed = await db.transaction(async (tx) => {
    const used = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: at })
      .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)))
      .returning({ id: emailVerificationTokens.id });
    if (!used.length) return false; // used by a parallel request
    await tx
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${at.toISOString()}::timestamptz)` })
      .where(eq(users.id, row.userId));
    return true;
  });
  if (!claimed) throw new HttpError(409, 'This link has already been used.', 'verification_link_used', { emailVerified: true });
  void track('email_verified', row.userId, {});
  return { status: 'verified' };
}
