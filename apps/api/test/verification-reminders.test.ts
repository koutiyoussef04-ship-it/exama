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
