/**
 * Is this address worth sending to? Cheap checks that protect deliverability when emailing addresses that were never
 * confirmed (a hard bounce costs far more than the one email it carried: Resend warns above about 4–5% bounces, and
 * this account sends very few emails, so one bounce is several percent). Nothing here sends or stores anything.
 *
 * `addressProblem`   syntax, role address (info@, test@…), disposable-mail domain: decided from the text alone.
 * `lookupMailServer` can the domain receive mail at all (an MX record, or — RFC 5321 — an A/AAAA record; a "null MX"
 *                    `0 .` means it explicitly does not). DNS only, domain names only, never an address.
 *
 * Conservative on purpose: anything doubtful is left out of an automatic send (an operator can still write to it by hand).
 * The lists are small and not exhaustive; they catch the obvious, not every throwaway domain.
 */
import { resolve4, resolve6, resolveMx } from 'node:dns/promises';

export const MAJOR_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'yahoo.es', 'outlook.com', 'outlook.fr', 'outlook.es', 'hotmail.com', 'hotmail.fr', 'hotmail.es', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'yandex.com', 'mail.com', 'orange.fr', 'free.fr', 'wanadoo.fr', 'laposte.net', 'sfr.fr']);
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mailnesia.com', 'mohmal.com']);
const ROLE_LOCALPARTS = new Set(['admin', 'administrator', 'info', 'support', 'contact', 'hello', 'noreply', 'no-reply', 'donotreply', 'test', 'tester', 'example', 'sales', 'office', 'postmaster', 'abuse', 'webmaster', 'root', 'mail', 'help']);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type AddressProblem = 'invalid_address' | 'role_address' | 'disposable_domain';
export type MailServer = 'ok' | 'none' | 'unknown';

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
export const isMajorDomain = (domain: string) => MAJOR_DOMAINS.has(domain);

/** Syntax, role address and disposable domain; null when nothing is wrong. */
export function addressProblem(email: string): AddressProblem | null {
  if (!EMAIL_SHAPE.test(email)) return 'invalid_address';
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  if (ROLE_LOCALPARTS.has(local.split('+')[0]!)) return 'role_address';
  if (DISPOSABLE_DOMAINS.has(domain)) return 'disposable_domain';
  return null;
}

const notFound = (err: unknown) => ['ENOTFOUND', 'ENODATA'].includes((err as { code?: string }).code ?? '');

/**
 * `ok`: the domain can receive mail. `none`: it cannot (no MX and no address record, or a null MX). `unknown`: DNS did not
 * give a clear answer (timeout, SERVFAIL…): try again later rather than guess. An MX query a resolver cannot answer falls
 * through to the address records, so such a resolver does not turn real domains into false alarms.
 */
export async function lookupMailServer(domain: string): Promise<MailServer> {
  if (!domain) return 'none';
  try {
    const mx = await resolveMx(domain);
    if (mx.some((m) => m.exchange && m.exchange !== '.')) return 'ok';
    if (mx.length) return 'none'; // only a null MX: the domain says it takes no mail
  } catch (err) {
    if (!notFound(err)) return 'unknown';
  }
  for (const lookup of [resolve4, resolve6] as const) {
    try {
      if ((await lookup(domain)).length) return 'ok';
    } catch (err) {
      if (!notFound(err)) return 'unknown';
    }
  }
  return 'none';
}

/** One lookup per domain per run. */
export function cachedMailServer(lookup: (domain: string) => Promise<MailServer> = lookupMailServer): (domain: string) => Promise<MailServer> {
  const seen = new Map<string, Promise<MailServer>>();
  return (domain) => {
    let v = seen.get(domain);
    if (!v) seen.set(domain, (v = lookup(domain)));
    return v;
  };
}

/** The same mailbox written two ways (gmail ignores dots; `+tag` is the same inbox): a key to spot accounts sharing one inbox. */
export const mailboxKey = (email: string) => {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  const base = local.split('+')[0]!;
  return `${domain === 'googlemail.com' ? 'gmail.com' : domain}|${domain === 'gmail.com' || domain === 'googlemail.com' ? base.replace(/\./g, '') : base}`;
};
