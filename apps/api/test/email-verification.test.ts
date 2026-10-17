/**
 * Email verification (enforcement off — today's default): the link sent at sign-up, valid / expired /
 * reused / invalid / superseded tokens, resend cooldown and rate limits, signed-out requests that reveal
 * nothing, email-send failures, and regressions (sign-in, password reset, onboarding, account deletion).
 * Tokens are only ever read from the test outbox, never printed.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse, EmailVerificationState, OnboardingState, ResendVerificationResult } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
delete process.env.EMAIL_VERIFICATION_REQUIRED;
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { outbox, mailTestHooks } = await import('../src/lib/mailer.js');
const { resetVerificationRateLimits } = await import('../src/services/email-verification.js');
const { resetRateLimits } = await import('../src/services/password-reset.js');
const analytics = await import('../src/analytics/index.js');
after(() => sql.end());
beforeEach(() => {
  resetVerificationRateLimits();
  resetRateLimits();
  mailTestHooks.fail = undefined;
});

const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
let n = 0;
let ip = 0;

async function call<T>(path: string, init: RequestInit & { token?: string; ip?: string } = {}) {
  const { token, ip: from, ...rest } = init;
  const res = await app.request(path, {
    ...rest,
    headers: { 'x-forwarded-for': from ?? `10.9.${RUN % 200}.${++ip % 250}`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string; details?: Record<string, unknown> } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const emailFor = (tag: string) => `ver-${tag}-${RUN}-${++n}@example.com`;

const verificationMails = (to: string) => outbox.filter((m) => m.to === to && /\/verify-email#token=/.test(m.text));
async function waitForMails(to: string, count: number) {
  for (let i = 0; i < 100 && verificationMails(to).length < count; i++) await new Promise((r) => setTimeout(r, 20));
  return verificationMails(to);
}
const tokenOf = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)![1];
const linkToken = async (to: string, count = 1) => tokenOf((await waitForMails(to, count))[count - 1].text);

async function signUp(tag: string, extra: Record<string, unknown> = {}) {
  const email = emailFor(tag);
  const r = await call<AuthResponse>('/auth/register', json('POST', { email, password: PASSWORD, name: 'Vera', ageRange: '18_24', ...extra }));
  assert.equal(r.status, 201);
  return { email, token: r.body.token, id: r.body.user.id };
}
const state = (token: string) => call<EmailVerificationState>('/auth/email-verification', { token });
const verify = (t: unknown, from?: string) => call<{ status: string }>('/auth/email-verification/verify', { ...json('POST', { token: t }), ip: from });
const resend = (token: string, language?: string) => call<ResendVerificationResult>('/auth/email-verification/resend', { ...json('POST', language ? { language } : {}), token });
const request = (email: string, from?: string) => call<{ retryAfterSeconds: number }>('/auth/email-verification/request', { ...json('POST', { email }), ip: from });
/** Pretend the newest link was sent `minutes` ago (to get past the 60 s cooldown without waiting). */
const ageLinks = (userId: string, minutes: number) => sql`update email_verification_tokens set created_at = created_at - make_interval(mins => ${minutes}) where user_id = ${userId}`;
const tokenRows = async (userId: string) => (await sql`select token_hash, used_at, expires_at from email_verification_tokens where user_id = ${userId}`) as unknown as { token_hash: string; used_at: Date | null; expires_at: Date }[];

test('sign-up emails a verification link right away (in the app language) and the account starts unverified', async () => {
  const started = Date.now();
  const u = await signUp('signup', { language: 'fr' });
  assert.ok(Date.now() - started < 3000, 'sign-up does not wait for slow email');
  const [mail] = await waitForMails(u.email, 1);
  assert.equal(mail.subject, 'Confirmez votre adresse e-mail pour Exama');
  assert.match(mail.text, /^Bienvenue sur Exama/);
  assert.match(mail.text, /http:\/\/localhost:8081\/verify-email#token=[A-Za-z0-9_-]{43}\n/, 'link to the web app, token in the fragment');
  assert.match(mail.html, /href="http:\/\/localhost:8081\/verify-email#token=/);

  const s = await state(u.token);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, { verified: false, verifiedAt: null, required: true, restrictedFrom: null, restricted: false }, 'enforcement is off by default');

  // Only a keyed hash is stored — never the token itself.
  const token = tokenOf(mail.text);
  const rows = await tokenRows(u.id);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  const dump = JSON.stringify(await sql`select * from email_verification_tokens where user_id = ${u.id}`) + JSON.stringify(await sql`select * from users where id = ${u.id}`);
  assert.ok(!dump.includes(token), 'the raw token is nowhere in the database');
  const ttlH = (new Date(rows[0].expires_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(ttlH > 23.9 && ttlH <= 24, `expires in 24 h (${ttlH})`);
  // The sign-up response itself is unchanged.
  const login = await call<AuthResponse>('/auth/login', json('POST', { email: u.email, password: PASSWORD }));
  assert.deepEqual(Object.keys(login.body.user).sort(), ['email', 'id', 'name']);
});

test('a valid link verifies the email once; reusing it is rejected', async () => {
  const u = await signUp('valid');
  const token = await linkToken(u.email);
  const ok = await verify(token);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { status: 'verified' });
  const s = (await state(u.token)).body;
  assert.equal(s.verified, true);
  assert.ok(s.verifiedAt);
  const again = await verify(token);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'verification_link_used');
  assert.equal(again.body.details?.emailVerified, true, 'the page can still say the email is confirmed');
  await analytics.flushAnalytics();
  const events = (await sql`select name, properties from analytics_events where user_id = ${u.id} and name = 'email_verified'`) as unknown as { properties: object }[];
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].properties, {}, 'no token or email in analytics');
  // Once verified, asking for another link sends nothing.
  const r = await resend(u.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { sent: false, retryAfterSeconds: 0, alreadyVerified: true });
});

test('expired links are rejected and leave the account unverified', async () => {
  const u = await signUp('expired');
  const token = await linkToken(u.email);
  await sql`update email_verification_tokens set expires_at = now() - interval '1 minute' where user_id = ${u.id}`;
  const r = await verify(token);
  assert.equal(r.status, 410);
  assert.equal(r.body.code, 'verification_link_expired');
  assert.equal((await state(u.token)).body.verified, false);
  assert.equal((await tokenRows(u.id))[0].used_at, null, 'an expired link is not consumed');
});

test('invalid links are rejected without revealing anything', async () => {
  const u = await signUp('invalid');
  const real = await linkToken(u.email);
  const lookalike = (real[0] === 'A' ? 'B' : 'A') + real.slice(1);
  for (const bad of ['', 'abc', 'x'.repeat(43), lookalike, real + 'x', real.slice(0, 42), '../../etc', `${real.slice(0, 40)}%%%`]) {
    const r = await verify(bad);
    assert.equal(r.status, 400, bad.length + ' chars');
    assert.equal(r.body.code, 'verification_link_invalid');
  }
  for (const bad of [123, null, undefined]) assert.equal((await verify(bad)).status, 400);
  assert.equal((await call('/auth/email-verification/verify', { method: 'POST', body: 'nope', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await state(u.token)).body.verified, false);
  assert.equal((await verify(real)).status, 200, 'the real link still works after failed guesses');
});

test('resend: 60 s cooldown, then a new link that replaces the old one', async () => {
  const u = await signUp('resend', { language: 'es' });
  const first = await linkToken(u.email);
  const early = await resend(u.token, 'es');
  assert.equal(early.status, 200);
  assert.equal(early.body.sent, false);
  assert.ok(early.body.retryAfterSeconds > 0 && early.body.retryAfterSeconds <= 60, String(early.body.retryAfterSeconds));
  assert.equal(verificationMails(u.email).length, 1, 'no second email during the cooldown');

  await ageLinks(u.id, 2);
  const later = await resend(u.token, 'es');
  assert.equal(later.status, 202);
  assert.deepEqual(later.body, { sent: true, retryAfterSeconds: 60 });
  const mails = verificationMails(u.email);
  assert.equal(mails.length, 2);
  assert.equal(mails[1].subject, 'Confirma tu correo para Exama');
  const second = tokenOf(mails[1].text);
  assert.notEqual(second, first);
  assert.equal((await verify(first)).body.code, 'verification_link_expired', 'the older link stops working');
  assert.equal((await verify(second)).status, 200);
});

test('resend is limited to 5 emails an hour per account and needs a session', async () => {
  assert.equal((await call('/auth/email-verification/resend', json('POST', {}))).status, 401);
  const u = await signUp('limit'); // email 1
  await waitForMails(u.email, 1);
  for (let i = 2; i <= 5; i++) {
    await ageLinks(u.id, 2);
    assert.equal((await resend(u.token)).status, 202, `email ${i}`);
  }
  await ageLinks(u.id, 2);
  const sixth = await resend(u.token);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.code, 'too_many_requests');
  assert.equal(verificationMails(u.email).length, 5);
  assert.equal((await tokenRows(u.id)).length, 5, 'a refused resend leaves no link behind');
});

test('signed-out requests answer the same for unknown, unverified and verified emails, and only email the unverified one', async () => {
  const unverified = await signUp('req-unverified');
  await waitForMails(unverified.email, 1);
  const verified = await signUp('req-verified');
  await verify(await linkToken(verified.email));
  await ageLinks(unverified.id, 2);
  await ageLinks(verified.id, 2);
  resetVerificationRateLimits(); // a couple of minutes later: the sign-up cooldowns are over
  const ghost = emailFor('ghost');

  const answers = [];
  for (const email of [ghost, unverified.email, verified.email]) answers.push(await request(email));
  for (const a of answers) {
    assert.equal(a.status, 202);
    assert.deepEqual(a.body, { retryAfterSeconds: 60 });
  }
  await waitForMails(unverified.email, 2);
  assert.equal(verificationMails(unverified.email).length, 2, 'a new link for the unverified account');
  assert.equal(verificationMails(verified.email).length, 1, 'nothing for an already verified account');
  assert.equal(outbox.filter((m) => m.to === ghost).length, 0, 'nothing for an unknown address');

  // Asking again right away: the same cooldown answer for everyone.
  const again = [];
  for (const email of [ghost, unverified.email, verified.email]) again.push((await request(email)).body.retryAfterSeconds);
  assert.ok(again.every((s) => s > 0 && s <= 60), JSON.stringify(again));
  assert.equal(verificationMails(unverified.email).length, 2);
  assert.equal((await call('/auth/email-verification/request', json('POST', { email: 'not-an-email' }))).status, 400);
});

test('signed-out requests and link checks are rate-limited per IP (429)', async () => {
  const from = '203.0.113.77';
  for (let i = 0; i < 10; i++) assert.equal((await request(emailFor('ip'), from)).status, 202);
  const r = await request(emailFor('ip'), from);
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'too_many_requests');
  for (let i = 0; i < 30; i++) await verify('x'.repeat(43), '203.0.113.78');
  assert.equal((await verify('x'.repeat(43), '203.0.113.78')).status, 429, 'link guessing is throttled');
});

test('email failures: sign-up still succeeds, no dead link is kept, and resend reports the failure without using up the cooldown', async () => {
  mailTestHooks.fail = () => true;
  const u = await signUp('fail');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(verificationMails(u.email).length, 0);
  assert.equal((await tokenRows(u.id)).length, 0, 'the unsent link was removed');
  const failed = await resend(u.token);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, 'email_send_failed');
  assert.equal((await tokenRows(u.id)).length, 0);

  mailTestHooks.fail = undefined;
  const ok = await resend(u.token); // right away: the failure didn't start a cooldown
  assert.equal(ok.status, 202);
  assert.equal((await verify(await linkToken(u.email))).status, 200);

  // A signed-out request whose email fails still gives the usual answer.
  const v = await signUp('fail-public');
  await waitForMails(v.email, 1);
  await ageLinks(v.id, 2);
  resetVerificationRateLimits();
  mailTestHooks.fail = () => true;
  assert.equal((await request(v.email)).status, 202);
});

test('accounts created before verification existed are never asked', async () => {
  const u = await signUp('legacy');
  await sql`update users set email_verification_required = false where id = ${u.id}`;
  const s = (await state(u.token)).body;
  assert.equal(s.required, false);
  assert.equal(s.restricted, false);
  // They may still confirm voluntarily.
  await ageLinks(u.id, 2);
  assert.equal((await resend(u.token)).status, 202);
});

test('regressions: sign-in, onboarding and account deletion are unaffected; a password reset confirms the email', async () => {
  const u = await signUp('regress');
  await waitForMails(u.email, 1);
  // Sign in while unverified.
  const login = await call<AuthResponse>('/auth/login', json('POST', { email: u.email, password: PASSWORD }));
  assert.equal(login.status, 200);
  assert.equal((await call('/auth/me', { token: login.body.token })).status, 200);
  // Onboarding is still pending and works independently of verification.
  assert.equal((await call<OnboardingState>('/onboarding', { token: u.token })).body.status, 'pending');
  await verify(await linkToken(u.email));
  assert.equal((await call<OnboardingState>('/onboarding', { token: u.token })).body.status, 'pending', 'verifying does not touch onboarding');
  const answers = { studyField: 'law', examTiming: 'over_a_month', mainGoal: 'exams', materials: 'pdf', confidence: 'fairly' };
  assert.equal((await call<OnboardingState>('/onboarding', { ...json('PUT', { answers }), token: u.token })).body.status, 'completed');

  // Password reset (code by email) still works, and confirms the address of an unverified account.
  const r = await signUp('reset');
  await waitForMails(r.email, 1);
  assert.equal((await call('/auth/password-reset/request', json('POST', { email: r.email }))).status, 202);
  let resetMail;
  for (let i = 0; i < 100 && !resetMail; i++) {
    resetMail = outbox.find((m) => m.to === r.email && /password/i.test(m.subject));
    if (!resetMail) await new Promise((res) => setTimeout(res, 20));
  }
  const code = /\b(\d{6})\b/.exec(resetMail!.text)![1];
  const reset = await call<AuthResponse>('/auth/password-reset/confirm', json('POST', { email: r.email, code, password: 'a-brand-new-password' }));
  assert.equal(reset.status, 200);
  assert.equal((await state(reset.body.token)).body.verified, true);
  assert.equal((await call('/auth/login', json('POST', { email: r.email, password: 'a-brand-new-password' }))).status, 200);

  // Deleting the account removes its links.
  const del = await call('/auth/me', { ...json('DELETE', { password: PASSWORD }), token: u.token });
  assert.equal(del.status, 200);
  assert.equal((await tokenRows(u.id)).length, 0);
});
