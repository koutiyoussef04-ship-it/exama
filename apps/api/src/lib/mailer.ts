/**
 * Transactional email (password-reset codes, email-verification links, web subscription confirmations,
 * daily study-plan reminders). Providers:
 *   log      development/tests: printed to the server log and kept in `outbox` (never in production)
 *   resend   https://resend.com (HTTP API, no SDK)
 *   disabled nothing is sent
 */
import { config } from '../config.js';

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe for reminder emails. */
  headers?: Record<string, string>;
  /** Resend idempotency key (24 h): a retried request with the same key is not sent twice. */
  idempotencyKey?: string;
};

/** Emails "sent" with the log provider (development and tests only). */
export const outbox: Mail[] = [];
/** Tests only (log provider): make a send fail, to exercise error handling. */
export const mailTestHooks: { fail?: (mail: Mail) => boolean } = {};

export async function sendMail(mail: Mail): Promise<void> {
  switch (config.EMAIL_PROVIDER) {
    case 'log':
      if (mailTestHooks.fail?.(mail)) throw new Error('Simulated email failure');
      outbox.push(mail);
      if (outbox.length > 100) outbox.shift();
      if (process.env.NODE_ENV !== 'test') console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          ...(mail.idempotencyKey && { 'Idempotency-Key': mail.idempotencyKey }),
        },
        body: JSON.stringify({ from: config.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.headers && { headers: mail.headers }) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
      return;
    }
    default:
      throw new Error('Email is not configured (EMAIL_PROVIDER=disabled).');
  }
}
