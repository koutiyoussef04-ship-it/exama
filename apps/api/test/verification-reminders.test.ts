/**
 * One reminder to confirm the email address (services/verification-reminders.ts): who is eligible and every
 * exclusion, that nothing is ever marked confirmed by the tool, one reminder per account, the existing verification
 * rules (new token, cooldown, failed send removes the link), the send lock and approval code, Resend's delivery log,
 * and that the server itself can never send one.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse } from '@study/shared';

const RUN = Date.now();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'log',
  WEB_APP_URL: 'https://app.exama.test',
  API_PUBLIC_URL: 'https://api.exama.test',
  VERIFICATION_REMINDER_SEND: 'true',
});
delete process.env.EMAIL_VERIFICATION_REQUIRED;
delete process.env.REACTIVATION_CAMPAIGN_SEND;
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { outbox, mailTestHooks } = await import('../src/lib/mailer.js');
const rem = await import('../src/services/verification-reminders.js');
const { resetVerificationRateLimits, sendVerificationReminder, verificationReminderEmail } = await import('../src/services/email-verification.js');
after(() => sql.end());
beforeEach(() => {
  mailTestHooks.fail = undefined;
  resetVerificationRateLimits();
  process.env.VERIFICATION_REMINDER_SEND = 'true';
});

const PASSWORD = 'correct-horse-battery-staple';
let n = 0;
let ip = 0;
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.7.${RUN % 200}.${++ip % 250}`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string } };
}
const post = (body: unknown, token?: string) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

const signUpMails = (to: string) => outbox.filter((m) => m.to === to && /Confirm your email|Confirma tu correo/.test(m.subject));
const reminderMails = (to: string) => outbox.filter((m) => m.to === to && /Reminder:|Recordatorio:|Rappel :|تذكير/.test(m.subject));
const tokenOf = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)![1]!;

type U = { id: string; email: string };
/**
 * A real sign-up (its own verification email goes out, then is aged), unconfirmed.
 * Defaults: asked at sign-up, 3 days old, its link sent 2 days ago and expired, adult.
 */
async function newUnconfirmed(over: { ageHours?: number; linkAgeHours?: number | null; asked?: boolean; ageRange?: string | null } = {}): Promise<U> {
  const email = `rem-${RUN}-${n++}@example.com`;
  const r = await call<AuthResponse>('/auth/register', post({ email, password: PASSWORD, name: 'Vera', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  for (let i = 0; i < 100 && !signUpMails(email).length; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(signUpMails(email).length, 1, 'sign-up email sent');
  const id = r.body.user.id;
  const ageHours = over.ageHours ?? 72;
  await sql`update users set created_at = now() - make_interval(hours => ${ageHours}), email_verification_required = ${over.asked ?? true}, age_range = ${over.ageRange === undefined ? '18_24' : over.ageRange} where id = ${id}`;
  if (over.linkAgeHours === null) await sql`delete from email_verification_tokens where user_id = ${id}`;
  else {
    const h = over.linkAgeHours ?? 48;
    await sql`update email_verification_tokens set created_at = now() - make_interval(hours => ${h}), expires_at = now() - make_interval(hours => ${h}) + interval '24 hours' where user_id = ${id}`;
  }
  return { id, email };
}
const audience = (users: U[], over: Partial<Parameters<typeof rem.selectReminderAudience>[0]> = {}) => rem.selectReminderAudience({ userIds: users.map((u) => u.id), anyTime: true, history: null, ...over });
const only = async (u: U, over?: Parameters<typeof audience>[1]) => (await audience([u], over)).eligible[0];
const reasonOf = async (u: U, over?: Parameters<typeof audience>[1]) => {
  const a = await audience([u], over);
  assert.equal(a.eligible.length, 0, 'not eligible');
  return Object.keys(a.excluded)[0];
};
const fast = { gapMs: 0, pauseMs: 0, maxPerDay: 1_000_000 };
const row = async (u: U) => (await sql<{ status: string; attempts: number; error: string | null; provider_message_id: string | null }[]>`select status, attempts, error, provider_message_id from email_campaign_sends where user_id = ${u.id} and campaign like 'verification-reminder-%'`)[0];
const tokenCount = async (u: U) => (await sql<{ n: number }[]>`select count(*)::int as n from email_verification_tokens where user_id = ${u.id}`)[0]!.n;
const verifiedAt = async (u: U) => (await sql<{ v: string | null }[]>`select email_verified_at::text as v from users where id = ${u.id}`)[0]!.v;

// ---------------------------------------------------------------- who

test('an unconfirmed account whose sign-up link expired unused is eligible, in its own language and as "link expired"', async () => {
  const u = await newUnconfirmed();
  const c = await only(u);
  assert.ok(c, 'eligible');
  assert.equal(c.link, 'expired');
  assert.equal(c.asked, true);
  assert.equal(c.language, 'en');
});

test('a confirmed address is never part of the audience', async () => {
  const u = await newUnconfirmed();
  await sql`update users set email_verified_at = now() where id = ${u.id}`;
  const a = await audience([u]);
  assert.equal(a.unverified, 0);
  assert.equal(a.usersTotal, 1);
  assert.equal(a.eligible.length, 0);
});

test('no link on record (the sign-up email never went out) is eligible and flagged as such', async () => {
  const u = await newUnconfirmed({ linkAgeHours: null });
  assert.equal((await only(u))?.link, 'none');
});

test('accounts that predate verification were never asked: held out by default, included only on request', async () => {
  const u = await newUnconfirmed({ asked: false, linkAgeHours: null });
  assert.equal(await reasonOf(u), 'legacy_not_asked');
  const c = await only(u, { includeLegacy: true });
  assert.ok(c);
  assert.equal(c.asked, false);
});

test('exclusions: suppressed, bounced before (Resend log), already reminded, too old, too new, link still valid', async () => {
  const suppressed = await newUnconfirmed();
  await sql`insert into email_suppressions (email, reason) values (${suppressed.email}, 'manual') on conflict do nothing`;
  assert.equal(await reasonOf(suppressed), 'suppressed');

  const bounced = await newUnconfirmed();
  const history = { byAddress: new Map([[bounced.email, { emails: 1, bad: 'bounced' as const }]]), emails: 1, complete: true };
  assert.equal(await reasonOf(bounced, { history }), 'delivery_failed_before');
  assert.ok(await only(bounced), 'without the Resend log the same account is eligible (the log is what excludes it)');

  const reminded = await newUnconfirmed();
  await sql`insert into email_campaign_sends (campaign, step, user_id, segment, variant, language, target, status, sent_at) values ('verification-reminder-2026-01', 1, ${reminded.id}, 'unverified', 'verification_reminder', 'en', '/verify-email', 'sent', now())`;
  assert.equal(await reasonOf(reminded), 'already_reminded');

  assert.equal(await reasonOf(await newUnconfirmed({ ageHours: 24 * 40 })), 'too_old');
  assert.ok(await only(await newUnconfirmed({ ageHours: 24 * 40 }), { maxAgeDays: 60 }), 'the age limit is a parameter');
  assert.equal(await reasonOf(await newUnconfirmed({ ageHours: 2, linkAgeHours: 1 })), 'too_new');
  assert.equal(await reasonOf(await newUnconfirmed({ ageHours: 72, linkAgeHours: 3 })), 'link_still_valid');
});

test('the audience also says what confirming would mean for the marketing rules (age and plan), without changing anything', async () => {
  const adult = await newUnconfirmed({ ageRange: '25_34' });
  const minor = await newUnconfirmed({ ageRange: '13_17' });
  const none = await newUnconfirmed({ ageRange: null });
  const a = await audience([adult, minor, none]);
  assert.deepEqual({ ...a.afterConfirming, withPlan: 0 }, { adult: 1, minor: 1, noAge: 1, withPlan: 0 });
  assert.equal(a.eligible.length, 3, 'the reminder is an account message: age does not gate it');
});

test('the dry-run path is read-only: no email, no token, no claim, nobody confirmed', async () => {
  const u = await newUnconfirmed();
  const before = { mails: outbox.length, tokens: await tokenCount(u) };
  const a = await audience([u]);
  rem.nextReminderBatch(a, 5);
  rem.reminderApprovalCode(rem.nextReminderBatch(a, 5));
  assert.equal(outbox.length, before.mails);
  assert.equal(await tokenCount(u), before.tokens);
  assert.equal(await row(u), undefined);
  assert.equal(await verifiedAt(u), null);
});

// ---------------------------------------------------------------- sending

test('a send emails a fresh single-use link, never marks the address confirmed, and only opening the link does', async () => {
  const u = await newUnconfirmed();
  const oldToken = tokenOf(signUpMails(u.email)[0]!.text);
  const batch = rem.nextReminderBatch(await audience([u]), 5);
  const r = await rem.sendReminderBatch({ batch, limit: 5, ...fast });
  assert.deepEqual({ sent: r.sent, failed: r.failed, skipped: r.skipped, stopped: r.stopped }, { sent: 1, failed: 0, skipped: 0, stopped: undefined });

  const mails = reminderMails(u.email);
  assert.equal(mails.length, 1);
  assert.match(mails[0]!.subject, /^Reminder: confirm your email for Exama$/);
  assert.match(mails[0]!.text, /https:\/\/app\.exama\.test\/verify-email#token=/);
  assert.equal(mails[0]!.headers, undefined, 'an account message: no marketing headers');
  assert.equal(await verifiedAt(u), null, 'the tool never confirms anybody');
  const claimed = await row(u);
  assert.equal(claimed?.status, 'sent');
  assert.equal(claimed?.attempts, 1);

  // The old link is replaced; the new one works once, through the normal endpoint.
  const newToken = tokenOf(mails[0]!.text);
  assert.notEqual(newToken, oldToken);
  const old = await call('/auth/email-verification/verify', post({ token: oldToken }));
  assert.equal(old.status, 410);
  const ok = await call<{ status: string }>('/auth/email-verification/verify', post({ token: newToken }));
  assert.equal(ok.status, 200);
  assert.ok(await verifiedAt(u), 'confirmed by the student');
  assert.equal((await call('/auth/email-verification/verify', post({ token: newToken }))).status, 409, 'single use');

  assert.equal((await rem.reminderReport()).confirmedAfter >= 1, true);
});

test('one reminder per account, ever: a second run sends nothing', async () => {
  const u = await newUnconfirmed();
  const batch = rem.nextReminderBatch(await audience([u]), 5);
  assert.equal((await rem.sendReminderBatch({ batch, limit: 5, ...fast })).sent, 1);
  assert.equal(await reasonOf(u), 'already_reminded');
  const again = await rem.sendReminderBatch({ batch, limit: 5, ...fast });
  assert.deepEqual({ sent: again.sent, skipped: again.skipped }, { sent: 0, skipped: 1 });
  assert.equal(reminderMails(u.email).length, 1);
  assert.equal((await sql`select 1 from email_campaign_sends where user_id = ${u.id}`).length, 1);
});

test('a student who confirms, or asks for a new link, between the dry run and the send is not emailed', async () => {
  const confirmed = await newUnconfirmed();
  const asked = await newUnconfirmed();
  const batch = rem.nextReminderBatch(await audience([confirmed, asked]), 5);
  assert.equal(batch.length, 2);
  await sql`update users set email_verified_at = now() where id = ${confirmed.id}`;
  await sql`insert into email_verification_tokens (user_id, token_hash, expires_at) values (${asked.id}, ${`h-${RUN}-${n++}`}, now() + interval '24 hours')`;
  const r = await rem.sendReminderBatch({ batch, limit: 5, ...fast });
  assert.deepEqual({ sent: r.sent, skipped: r.skipped }, { sent: 0, skipped: 2 });
  assert.equal(reminderMails(confirmed.email).length + reminderMails(asked.email).length, 0);
});

test('the existing cooldown applies: a link issued a moment ago blocks the reminder and nothing is emailed or left behind', async () => {
  const email = `rem-${RUN}-${n++}@example.com`;
  const r = await call<AuthResponse>('/auth/register', post({ email, password: PASSWORD, name: 'Vera', ageRange: '18_24' }));
  for (let i = 0; i < 100 && !signUpMails(email).length; i++) await new Promise((res) => setTimeout(res, 20));
  const before = await tokenCount({ id: r.body.user.id, email });
  const out = await sendVerificationReminder(r.body.user.id, 'en');
  assert.equal(out.status, 'cooldown');
  assert.equal(reminderMails(email).length, 0);
  assert.equal(await tokenCount({ id: r.body.user.id, email }), before);
});

test('a failed send removes the new link and keeps the account eligible; a later run retries, 3 attempts at most', async () => {
  const u = await newUnconfirmed();
  mailTestHooks.fail = (m) => /Reminder:/.test(m.subject);
  const batch = rem.nextReminderBatch(await audience([u]), 5);
  const tokensBefore = await tokenCount(u);
  const failed = await rem.sendReminderBatch({ batch, limit: 5, ...fast });
  assert.deepEqual({ sent: failed.sent, failed: failed.failed }, { sent: 0, failed: 1 });
  assert.equal(await tokenCount(u), tokensBefore, 'no orphan link');
  assert.deepEqual({ ...(await row(u)) }, { status: 'failed', attempts: 1, error: 'error', provider_message_id: null });
  assert.ok(await only(u), 'still eligible (retry)');

  mailTestHooks.fail = undefined;
  const retried = await rem.sendReminderBatch({ batch: rem.nextReminderBatch(await audience([u]), 5), limit: 5, ...fast });
  assert.equal(retried.sent, 1);
  assert.deepEqual({ status: (await row(u))?.status, attempts: (await row(u))?.attempts }, { status: 'sent', attempts: 2 });

  const stuck = await newUnconfirmed();
  mailTestHooks.fail = (m) => /Reminder:/.test(m.subject);
  for (let i = 0; i < 3; i++) await rem.sendReminderBatch({ batch: rem.nextReminderBatch(await audience([stuck]), 5), limit: 5, ...fast });
  assert.equal((await row(stuck))?.attempts, 3);
  assert.equal(await reasonOf(stuck), 'already_reminded', 'after 3 failed attempts it is left alone');
});

test('three failures in a row stop the run', async () => {
  const users = [await newUnconfirmed(), await newUnconfirmed(), await newUnconfirmed(), await newUnconfirmed()];
  mailTestHooks.fail = (m) => /Reminder:/.test(m.subject);
  const r = await rem.sendReminderBatch({ batch: rem.nextReminderBatch(await audience(users), 10), limit: 10, ...fast });
  assert.equal(r.attempted, 3);
  assert.equal(r.failed, 3);
  assert.equal(r.stopped, '3 failures in a row');
});

test('the daily cap is shared with every campaign email', async () => {
  const u = await newUnconfirmed();
  const [{ n: sentToday }] = await sql<{ n: number }[]>`select count(*)::int as n from email_campaign_sends where status = 'sent' and sent_at >= now() - interval '24 hours'`;
  const r = await rem.sendReminderBatch({ batch: rem.nextReminderBatch(await audience([u]), 5), limit: 5, gapMs: 0, pauseMs: 0, maxPerDay: sentToday });
  assert.match(r.stopped ?? '', /daily cap reached/);
  assert.equal(r.sent, 0);
  assert.equal(reminderMails(u.email).length, 0);
});

test('the send is locked unless VERIFICATION_REMINDER_SEND=true, and the reactivation switch does not unlock it', () => {
  delete process.env.VERIFICATION_REMINDER_SEND;
  assert.match(rem.reminderPreflight().blockers.join(' '), /VERIFICATION_REMINDER_SEND/);
  process.env.REACTIVATION_CAMPAIGN_SEND = 'true';
  assert.match(rem.reminderPreflight().blockers.join(' '), /VERIFICATION_REMINDER_SEND/);
  delete process.env.REACTIVATION_CAMPAIGN_SEND;
  process.env.VERIFICATION_REMINDER_SEND = 'true';
  assert.deepEqual(rem.reminderPreflight().blockers, []);
  const saved = config.EMAIL_PROVIDER;
  (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = 'disabled';
  try {
    assert.match(rem.reminderPreflight().blockers.join(' '), /EMAIL_PROVIDER is disabled/);
  } finally {
    (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = saved;
  }
});

test('the approval code is tied to the exact batch', async () => {
  const [a, b] = [await newUnconfirmed(), await newUnconfirmed()];
  const both = rem.nextReminderBatch(await audience([a, b]), 5);
  const one = rem.nextReminderBatch(await audience([a]), 5);
  assert.match(rem.reminderApprovalCode(both), /^[0-9A-F]{10}$/);
  assert.equal(rem.reminderApprovalCode(both), rem.reminderApprovalCode([...both]));
  assert.notEqual(rem.reminderApprovalCode(both), rem.reminderApprovalCode(one));
  assert.notEqual(rem.reminderApprovalCode(one), rem.reminderApprovalCode([{ ...one[0]!, language: 'fr' }]));
});

// ---------------------------------------------------------------- wording

test('the reminder says one thing in every language: confirm this address; same link and expiry, no marketing', () => {
  const expected = { en: /^Reminder:/, es: /^Recordatorio:/, fr: /^Rappel :/, ar: /^تذكير/ };
  for (const language of ['en', 'es', 'fr', 'ar'] as const) {
    const mail = verificationReminderEmail('x@example.com', 'T'.repeat(43), language);
    assert.match(mail.subject, expected[language]);
    assert.match(mail.text, /https:\/\/app\.exama\.test\/verify-email#token=T{43}/);
    assert.match(mail.text, /24/);
    assert.equal(mail.text.split('\n\n').length, 3, 'one sentence, the link, the expiry note');
    assert.doesNotMatch(mail.text + mail.html, /unsubscribe|utm_|\/email\/click|study plan|plan de |discount|%/i);
    assert.equal(mail.html.includes('dir="rtl"'), language === 'ar');
    assert.equal(mail.html.includes('T'.repeat(43)), true);
  }
});

// ---------------------------------------------------------------- Resend's delivery log

const fakeResend = (pages: unknown[], calls: string[] = []) => {
  let i = 0;
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    const body = pages[Math.min(i++, pages.length - 1)];
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
};
async function withResend<T>(fn: () => Promise<T>) {
  const saved = [config.EMAIL_PROVIDER, config.RESEND_API_KEY] as const;
  (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = 'resend';
  (config as { RESEND_API_KEY?: string }).RESEND_API_KEY = 're_test_key';
  try {
    return await fn();
  } finally {
    (config as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = saved[0];
    (config as { RESEND_API_KEY?: string }).RESEND_API_KEY = saved[1];
  }
}

test('Resend’s log: pages are followed, bounces by address are found, formats are tolerated', async () => {
  const calls: string[] = [];
  const fetchImpl = fakeResend(
    [
      { object: 'list', has_more: true, data: [{ id: 'e1', to: ['Good@Example.com'], last_event: 'delivered' }, { id: 'e2', to: ['Vera <bad@example.com>'], last_event: 'bounced' }] },
      { object: 'list', has_more: false, data: [{ id: 'e3', to: ['good@example.com'], last_event: 'opened' }, { id: 'e4', to: ['spam@example.com'], last_event: 'complained' }] },
    ],
    calls,
  );
  const h = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl, sleep: async () => {} }));
  assert.equal(h.emails, 4);
  assert.equal(h.complete, true);
  assert.deepEqual(h.byAddress.get('good@example.com'), { emails: 2, bad: null });
  assert.equal(h.byAddress.get('bad@example.com')?.bad, 'bounced');
  assert.equal(h.byAddress.get('spam@example.com')?.bad, 'complained');
  assert.match(calls[1]!, /after=e2/);
});

test('Resend’s log: any HTTP or shape problem throws (a send must not go ahead without it); too many pages say so', async () => {
  await withResend(async () => {
    await assert.rejects(rem.fetchDeliveryHistory({ fetchImpl: fakeResend([new Response('no', { status: 429 })]), sleep: async () => {} }), /429/);
    await assert.rejects(rem.fetchDeliveryHistory({ fetchImpl: fakeResend([{ nope: true }]), sleep: async () => {} }), /Unexpected Resend answer/);
    const endless = fakeResend([{ has_more: true, data: [{ id: 'x1', to: ['a@example.com'], last_event: 'delivered' }] }]);
    assert.equal((await rem.fetchDeliveryHistory({ fetchImpl: endless, sleep: async () => {}, maxPages: 2 })).complete, false);
  });
  await assert.rejects(rem.fetchDeliveryHistory({ fetchImpl: fakeResend([{ data: [] }]) }), /not resend/);
});

test('sync reads reminder delivery back and suppresses bounced addresses of real accounts only', async () => {
  const u = await newUnconfirmed();
  const bouncedAccount = await newUnconfirmed();
  await sql`insert into email_campaign_sends (campaign, step, user_id, segment, variant, language, target, status, sent_at, provider_message_id) values ('verification-reminder-2026-10', 1, ${u.id}, 'unverified', 'verification_reminder', 'en', '/verify-email', 'sent', now(), ${`msg-${RUN}`})`;
  const fetchImpl = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes(`/emails/msg-${RUN}`)) return new Response(JSON.stringify({ last_event: 'delivered' }), { status: 200 });
    return new Response(JSON.stringify({ has_more: false, data: [{ id: 'b1', to: [bouncedAccount.email], last_event: 'bounced' }, { id: 'b2', to: [`stranger-${RUN}@example.com`], last_event: 'bounced' }] }), { status: 200 });
  }) as typeof fetch;
  const r = await withResend(() => rem.syncReminders({ fetchImpl, sleep: async () => {} }));
  assert.ok(r.updated >= 1);
  assert.equal((await sql`select delivery_status from email_campaign_sends where provider_message_id = ${`msg-${RUN}`}`)[0]!.delivery_status, 'delivered');
  assert.equal((await sql`select reason from email_suppressions where email = ${bouncedAccount.email}`)[0]!.reason, 'bounced');
  assert.equal((await sql`select 1 from email_suppressions where email = ${`stranger-${RUN}@example.com`}`).length, 0, 'addresses that are not accounts are not written');
  assert.equal(await reasonOf(bouncedAccount), 'suppressed');
});

// ---------------------------------------------------------------- nothing sends by itself

// ---------------------------------------------------------------- reading the log reliably

const page = (ids: string[], more = false, event = 'delivered') => ({ object: 'list', has_more: more, data: ids.map((id) => ({ id, to: [`${id}@example.com`], last_event: event })) });
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
/** A fetch that answers with the given steps in order (an Error step is thrown); the last step repeats. */
const script = (steps: (Response | Error | (() => Response))[], calls: { url: string; auth: boolean }[] = []) => {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: !!(init?.headers as Record<string, string> | undefined)?.Authorization });
    const step = steps[Math.min(i++, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step.clone();
  }) as typeof fetch;
};
const sleeps = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

test('a slow Resend is retried with backoff: timeout, timeout, then the log is read; every attempt is reported', async () => {
  const { waits, sleep } = sleeps();
  const trace: string[] = [];
  const h = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([timeoutError(), timeoutError(), reply(200, page(['a']))]), sleep, onAttempt: (a) => trace.push(a.outcome) }));
  assert.equal(h.emails, 1);
  assert.deepEqual(trace, ['timeout', 'timeout', 'ok']);
  assert.ok(waits[0]! >= 1000 && waits[1]! >= 2000, `exponential backoff, got ${waits.join(',')}`);
});

test('the per-request timeout really cuts a request that never answers, and the failure says "timeout", with attempts and time', async () => {
  const neverAnswers = ((_url: string | URL | Request, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)))) as typeof fetch;
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: neverAnswers, sleep: async () => {}, requestTimeoutMs: 25, attempts: 2 })).catch((e) => e);
  assert.ok(err instanceof rem.ResendLogError);
  assert.equal(err.kind, 'timeout');
  assert.equal(err.detail.attempts, 2);
  assert.match(err.message, /did not answer within/);
});

test('a timeout while reading the body is a timeout (retried), not an "unexpected answer"', async () => {
  const slowBody = () => ({ ok: true, status: 200, headers: new Headers(), json: () => Promise.reject(timeoutError()), clone() { return this; } }) as unknown as Response;
  const h = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([slowBody, reply(200, page(['a']))]), sleep: async () => {} }));
  assert.equal(h.emails, 1);
});

test('a key that may only send is reported as such at once (no retries): restricted_api_key means a Full access key is needed', async () => {
  const calls: { url: string; auth: boolean }[] = [];
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(403, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' })], calls), sleep: async () => {} })).catch((e) => e);
  assert.equal(err.kind, 'permission');
  assert.equal(err.detail.status, 403);
  assert.equal(err.detail.name, 'restricted_api_key');
  assert.match(err.message, /Full access/);
  assert.equal(calls.length, 1, 'not retried');
  assert.doesNotMatch(err.message, /restricted to only send/, 'the response text is never carried along');
});

test('rate limits wait for Retry-After and retry; an exhausted quota is not retried', async () => {
  const { waits, sleep } = sleeps();
  const h = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '2' }), reply(200, page(['a']))]), sleep }));
  assert.equal(h.emails, 1);
  assert.equal(waits[0], 2000);
  const calls: { url: string; auth: boolean }[] = [];
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(429, { name: 'daily_quota_exceeded' })], calls), sleep: async () => {} })).catch((e) => e);
  assert.equal(err.kind, 'rate_limit');
  assert.equal(calls.length, 1);
});

test('server errors are retried; if they persist the failure is "server" after the configured attempts', async () => {
  const ok = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(503, { name: 'service_unavailable' }), reply(200, page(['a']))]), sleep: async () => {} }));
  assert.equal(ok.emails, 1);
  const calls: { url: string; auth: boolean }[] = [];
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(500, { name: 'application_error' })], calls), sleep: async () => {} })).catch((e) => e);
  assert.equal(err.kind, 'server');
  assert.equal(calls.length, 3);
  assert.equal(err.detail.attempts, 3);
});

test('the whole lookup has a deadline, retries and waits included', async () => {
  let clock = 0;
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([timeoutError()]), sleep: async (ms) => void (clock += ms), now: () => clock, attempts: 10, deadlineMs: 2500 })).catch((e) => e);
  assert.equal(err.kind, 'deadline');
  assert.ok(err.detail.attempts < 10);
});

test('an answer that is not JSON is a "shape" problem and is not retried; a cursor that does not advance ends the lookup as incomplete', async () => {
  const calls: { url: string; auth: boolean }[] = [];
  const err = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([new Response('<html>', { status: 200 })], calls), sleep: async () => {} })).catch((e) => e);
  assert.equal(err.kind, 'shape');
  assert.equal(calls.length, 1);
  const stuck = await withResend(() => rem.fetchDeliveryHistory({ fetchImpl: script([reply(200, page(['x'], true))]), sleep: async () => {} }));
  assert.equal(stuck.complete, false);
});

test('check-resend: separates "the network is fine but the key may only send" from "Resend is slow" from "this machine can’t reach Resend"', async () => {
  const noKey = reply(401, { name: 'missing_api_key' });
  const send = (steps: Parameters<typeof script>[0]) => {
    let call = 0;
    const inner = script(steps);
    return (async (url: string | URL | Request, init?: RequestInit) => (init?.headers ? inner(url, init) : (call++, noKey.clone()))) as typeof fetch;
  };
  const restricted = await withResend(() => rem.diagnoseResend({ fetchImpl: send([reply(403, { name: 'restricted_api_key' })]), sleep: async () => {} }));
  assert.equal(restricted.network.ok, true);
  assert.equal(restricted.key.kind, 'permission');
  assert.match(rem.explainDiagnosis(restricted), /send-only|Full access/);

  const invalid = await withResend(() => rem.diagnoseResend({ fetchImpl: send([reply(400, { name: 'validation_error', message: 'API key is invalid' })]), sleep: async () => {} }));
  assert.equal(invalid.key.kind, 'http');
  assert.match(rem.explainDiagnosis(invalid), /API key is invalid/);
  const refused = await withResend(() => rem.diagnoseResend({ fetchImpl: send([reply(401, { name: 'invalid_access' })]), sleep: async () => {} }));
  assert.equal(refused.key.kind, 'permission');
  assert.doesNotMatch(rem.explainDiagnosis(refused), /send-only/, 'only restricted_api_key means "send-only"');

  const slow = await withResend(() => rem.diagnoseResend({ fetchImpl: send([timeoutError()]), sleep: async () => {} }));
  assert.equal(slow.key.kind, 'timeout');
  assert.equal(slow.key.attempts.filter((a) => a.outcome === 'timeout').length, 3);
  assert.match(rem.explainDiagnosis(slow), /slow/);

  const unreachable = await withResend(() => rem.diagnoseResend({ fetchImpl: script([timeoutError()]), sleep: async () => {} }));
  assert.equal(unreachable.network.ok, false);
  assert.match(rem.explainDiagnosis(unreachable), /network|DNS/);

  const fine = await withResend(() => rem.diagnoseResend({ fetchImpl: send([reply(200, page(['a', 'b']))]), sleep: async () => {} }));
  assert.equal(fine.key.ok, true);
  assert.equal(fine.key.emailsOnFirstPage, 2);
  assert.match(rem.explainDiagnosis(fine), /nothing to fix/);
});

// ---------------------------------------------------------------- legacy accounts (read-only inspection)

async function legacy(email: string, over: { ageRange?: string | null; daysAgo?: number } = {}): Promise<U> {
  const [u] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, name, created_at, email_verification_required, age_range)
    values (${email}, 'x', 'Old', now() - make_interval(days => ${over.daysAgo ?? 4}), false, ${over.ageRange ?? null}) returning id`;
  return { id: u!.id, email };
}

test('inspect-legacy describes accounts that were never asked to confirm, without changing or including anyone', async () => {
  const tag = `${RUN}-${n++}`;
  const a = await legacy(`Dot.Ted${tag}+x@gmail.com`);
  const b = await legacy(`dotted${tag}@gmail.com`); // the same mailbox as `a` once dots and +tags are ignored (gmail)
  const role = await legacy(`info+${tag}@example.com`);
  const role2 = await legacy(`info+${tag}@nomail.test`);
  const disposable = await legacy(`kid${tag}@mailinator.com`, { ageRange: '18_24' });
  const bad = await legacy(`not-an-address-${tag}`);
  const activeUser = await legacy(`active${tag}@yahoo.com`, { daysAgo: 6 });
  await sql`insert into analytics_events (name, source, user_id, anonymous_id, properties) values ('login_completed', 'server', ${activeUser.id}, null, '{}'::jsonb), ('app_opened', 'client', ${activeUser.id}, ${`anon-${tag}`}, '{}'::jsonb)`;
  const confirmed = await legacy(`confirmed${tag}@gmail.com`);
  await sql`update users set email_verified_at = now() where id = ${confirmed.id}`;
  const asked = await newUnconfirmed(); // asked at sign-up: not a legacy account
  const ids = [a, b, role, role2, disposable, bad, activeUser, confirmed, asked].map((u) => u.id);
  const history = { byAddress: new Map([[role.email.toLowerCase(), { emails: 1, bad: 'bounced' as const }], [activeUser.email.toLowerCase(), { emails: 2, bad: null }]]), emails: 3, complete: true };

  const before = { users: (await sql`select count(*)::int as n from users where id = any(${ids}::uuid[])`)[0]!.n, mails: outbox.length, sends: (await sql`select count(*)::int as n from email_campaign_sends where user_id = any(${ids}::uuid[])`)[0]!.n };
  const r = await rem.inspectLegacy({ userIds: ids, history, mx: async (d) => (d === 'nomail.test' ? 'none' : d === 'example.com' ? 'unknown' : 'ok') });

  assert.equal(r.total, 7, 'confirmed and asked-at-sign-up accounts are not part of it');
  assert.deepEqual(r.ageGroup, { given: 1, none: 6 });
  assert.equal(r.activity.loggedInAfterSignup, 1);
  assert.equal(r.activity.openedAppSignedIn, 1);
  assert.equal(r.activity.activeLast7Days, 1);
  assert.equal(r.activity.neverActive, 6);
  assert.deepEqual(r.hygiene, { invalidSyntax: 1, roleAccount: 2, disposable: 1, sharedMailbox: 2, noMailServer: 1, lookupInconclusive: 1 });
  assert.deepEqual(r.delivery, { addressesEmailed: 2, bounced: 1 });
  assert.equal(r.byDay.reduce((s, d) => s + d.n, 0), 7);
  assert.deepEqual(r.domains.top.map((d) => d.domain).sort(), ['gmail.com', 'yahoo.com']);
  assert.ok(r.rows.every((x) => !/@/.test(x.masked) || x.masked.includes('*')), 'addresses are masked');
  assert.ok(!JSON.stringify(r).includes(tag), 'no address (or part of one) leaks into the report');
  assert.ok(r.rows.find((x) => x.flags.includes('resend_bounced')), 'the Resend bounce is flagged');

  assert.deepEqual({ users: (await sql`select count(*)::int as n from users where id = any(${ids}::uuid[])`)[0]!.n, mails: outbox.length, sends: (await sql`select count(*)::int as n from email_campaign_sends where user_id = any(${ids}::uuid[])`)[0]!.n }, before, 'nothing written, nothing sent');
  assert.equal(await verifiedAt(a), null);
  assert.equal(await reasonOf(a), 'legacy_not_asked', 'and they are still not included in the reminder');
});

test('the server never imports the reminder tool: deploying and running the API cannot send one', async () => {
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await walk(join(dir, e.name)) : [join(dir, e.name)]));
    return out;
  };
  const src = new URL('../src/', import.meta.url).pathname;
  const files = (await walk(src)).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 20);
  const importers: string[] = [];
  for (const f of files) if (/(from|import\()\s*['"][^'"]*verification-reminders/.test(await readFile(f, 'utf8'))) importers.push(f.slice(src.length));
  assert.deepEqual(importers, [], 'nothing under src/ (server, scheduler, routes, other services) imports it');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  const runners = Object.entries(pkg.scripts).filter(([name, cmd]) => name !== 'test' && /verification-reminders/.test(cmd)).map(([name]) => name);
  assert.deepEqual(runners.sort(), ['campaign:verification-reminder', 'campaign:verification-reminder:prod'], 'only the operator scripts run it (never start, start:prod, db:migrate or the pre-deploy command)');
});
