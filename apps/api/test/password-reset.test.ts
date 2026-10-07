/**
 * Password reset: one-time emailed code, no account enumeration, expiry, single use, attempt cap,
 * rate limits, 15-minute cooldown between codes, older sessions ended after the reset.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', EMAIL_PROVIDER: 'log', NODE_ENV: 'test' });
const { app } = await import('../src/app.js');
const { sql, db } = await import('../src/db/client.js');
const { passwordResetCodes } = await import('../src/db/schema.js');
const { outbox } = await import('../src/lib/mailer.js');
const { resetRateLimits, requestPasswordReset, confirmPasswordReset, RESET_MAX_ATTEMPTS, RESET_COOLDOWN_MINUTES, RESET_CODE_TTL_MINUTES } = await import('../src/services/password-reset.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { eq } = await import('drizzle-orm');
after(async () => {
  await flushAnalytics();
  await sql.end();
});
beforeEach(() => resetRateLimits());

let ip = 0;
const call = (path: string, body?: unknown, opts: { token?: string; ip?: string } = {}) =>
  app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': opts.ip ?? `10.0.0.${++ip % 250}`,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function newUser() {
  const email = `reset-${crypto.randomUUID()}@example.com`;
  const r = await call('/auth/register', { email, password: 'old-password-1', name: 'Rita' });
  return { email, ...((await r.json()) as AuthResponse) };
}
const codeFor = (email: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  return mail?.text.match(/\b(\d{6})\b/)?.[1];
};
const MIN = 60_000;
const settle = () => new Promise((r) => setTimeout(r, 20));
const COOLDOWN_S = RESET_COOLDOWN_MINUTES * 60;
/** The service at a chosen moment ("time travel"), with its own client key so IP limits don't interfere. */
let keyNo = 0;
const requestAt = (email: string, atMs: number) => requestPasswordReset(email, 'en', `svc-${++keyNo}`, atMs);
const confirmAt = (email: string, code: string, atMs: number, password = 'new-password-2') => confirmPasswordReset(email, code, password, `svc-${++keyNo}`, atMs);
const mailsTo = (email: string) => outbox.filter((m) => m.to === email).length;
const request = (email: string, extra: object = {}, o?: { ip?: string }) => call('/auth/password-reset/request', { email, ...extra }, o);
const confirm = (email: string, code: string, password = 'new-password-2', o?: { ip?: string }) => call('/auth/password-reset/confirm', { email, code, password }, o);

test('request: same 202 answer for known and unknown emails; only real accounts get a code', async () => {
  const { email } = await newUser();
  const before = outbox.length;
  const known = await request(email);
  const unknown = await request(`nobody-${crypto.randomUUID()}@example.com`);
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  const knownBody = await known.json();
  assert.deepEqual(knownBody, await unknown.json(), 'identical bodies: no account enumeration');
  assert.deepEqual(knownBody, { ok: true, retryAfterSeconds: COOLDOWN_S }, 'tells the caller how long until another code');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outbox.length, before + 1, 'one email, to the existing account only');
  assert.match(codeFor(email) ?? '', /^\d{6}$/);
  // Only a keyed hash is stored, never the code itself.
  const rows = await db.select().from(passwordResetCodes);
  assert.ok(rows.every((r) => !r.codeHash.includes(codeFor(email)!)));
  // Invalid input → 400, not a hint about the account.
  assert.equal((await call('/auth/password-reset/request', { email: 'not-an-email' })).status, 400);
});

test('confirm: wrong codes fail; the right code sets the password, signs in and ends older sessions', async () => {
  const { email, token: oldToken } = await newUser();
  await request(email, { language: 'fr' });
  await new Promise((r) => setTimeout(r, 20));
  const mail = [...outbox].reverse().find((m) => m.to === email)!;
  assert.match(mail.subject, /réinitialisation/, 'email in the app language');
  const code = codeFor(email)!;
  const wrong = code === '000000' ? '111111' : '000000';

  const bad = await confirm(email, wrong);
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, 'reset_code_invalid');
  assert.equal((await call('/auth/me', undefined, { token: oldToken })).status, 200, 'nothing changed yet');

  const ok = await confirm(email, code, 'brand-new-pass');
  assert.equal(ok.status, 200);
  const { token } = (await ok.json()) as AuthResponse;
  assert.equal((await call('/auth/me', undefined, { token })).status, 200, 'signed in with the new session');
  const old = await call('/auth/me', undefined, { token: oldToken });
  assert.equal(old.status, 401, 'sessions from before the reset stop working');
  assert.equal(((await old.json()) as { code: string }).code, 'session_expired');
  assert.equal((await call('/auth/login', { email, password: 'old-password-1' })).status, 401);
  assert.equal((await call('/auth/login', { email, password: 'brand-new-pass' })).status, 200);

  // Single use.
  assert.equal((await confirm(email, code, 'another-pass-3')).status, 400);
  // Unknown email: same error as a wrong code.
  const unknown = await confirm(`nobody-${crypto.randomUUID()}@example.com`, code);
  assert.equal(((await unknown.json()) as { code: string }).code, 'reset_code_invalid');
  // Too-short password rejected before anything is checked (a new code, once the cooldown is over).
  await requestAt(email, Date.now() + (RESET_COOLDOWN_MINUTES + 1) * MIN);
  await settle();
  assert.equal((await confirm(email, codeFor(email)!, 'short')).status, 400);
});

test(`a code allows ${RESET_MAX_ATTEMPTS} attempts, expires, and is replaced by a newer request`, async () => {
  const a = await newUser();
  await request(a.email);
  await new Promise((r) => setTimeout(r, 20));
  const code = codeFor(a.email)!;
  const wrong = code === '999999' ? '888888' : '999999';
  for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) assert.equal((await confirm(a.email, wrong)).status, 400);
  assert.equal((await confirm(a.email, code)).status, 400, 'burned after too many wrong attempts, even with the right code');

  const b = await newUser();
  await request(b.email);
  await new Promise((r) => setTimeout(r, 20));
  const first = codeFor(b.email)!;
  await requestAt(b.email, Date.now() + (RESET_COOLDOWN_MINUTES + 1) * MIN); // a request inside the cooldown would not issue a code
  await settle();
  const second = codeFor(b.email)!;
  if (first !== second) assert.equal((await confirm(b.email, first)).status, 400, 'older code invalidated');
  // Expire the current code.
  const [{ id: userId }] = await sql`select id from users where email = ${b.email}`;
  await db.update(passwordResetCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetCodes.userId, userId as string));
  assert.equal((await confirm(b.email, second)).status, 400, 'expired');
});

test('rate limits: per client for requests and attempts; at most 3 emails per account per hour', async () => {
  const { email } = await newUser();
  const sameIp = { ip: '203.0.113.7' };
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await request(`x${i}-${crypto.randomUUID()}@example.com`, {}, sameIp)).status);
  assert.deepEqual([statuses.slice(0, 10).every((s) => s === 202), statuses[10]], [true, 429]);

  // A request that lands inside a cooldown still counts against the client's limit.
  resetRateLimits();
  const { email: known } = await newUser();
  const again = { ip: '203.0.113.9' };
  const answers = [];
  for (let i = 0; i < 11; i++) answers.push((await request(known, {}, again)).status);
  assert.deepEqual([answers.slice(0, 10).every((s) => s === 202), answers[10]], [true, 429]);

  // Per account: at most 3 emails an hour (one every 16 minutes here), the rest answered the same but silent.
  resetRateLimits();
  const before = mailsTo(email);
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) assert.equal((await requestAt(email, t0 + i * (RESET_COOLDOWN_MINUTES + 1) * MIN)).retryAfterSeconds, COOLDOWN_S, 'same answer even when no email is sent');
  await settle();
  assert.equal(mailsTo(email) - before, 3);

  resetRateLimits();
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await confirm(email, '123456', 'whatever-123', sameIp)).status);
  assert.equal(codes[20], 429);
});

test('cooldown: a second request right away gets no new code and no email, and says how long to wait', async () => {
  const { email } = await newUser();
  const first = await request(email);
  assert.deepEqual(await first.json(), { ok: true, retryAfterSeconds: COOLDOWN_S });
  await settle();
  assert.equal(mailsTo(email), 1);
  const code = codeFor(email)!;
  const rowsAfterFirst = await sql`select id from password_reset_codes where user_id = (select id from users where email = ${email})`;

  const second = await request(email); // the same as tapping "Send a new code"
  assert.equal(second.status, 202);
  const body = (await second.json()) as { ok: boolean; retryAfterSeconds: number };
  assert.equal(body.ok, true);
  assert.ok(body.retryAfterSeconds > COOLDOWN_S - 30 && body.retryAfterSeconds <= COOLDOWN_S, `about ${RESET_COOLDOWN_MINUTES} minutes left, got ${body.retryAfterSeconds}s`);
  await settle();
  assert.equal(mailsTo(email), 1, 'no second email');
  const rowsAfterSecond = await sql`select id from password_reset_codes where user_id = (select id from users where email = ${email})`;
  assert.equal(rowsAfterSecond.length, rowsAfterFirst.length, 'no second code generated');
  assert.equal(codeFor(email), code);
  assert.equal((await confirm(email, code)).status, 200, 'the first code still works');
});

test('cooldown timeline: throttled for 15 minutes, then a new code replaces the old one', async () => {
  const { email } = await newUser();
  const t0 = Date.now();
  assert.equal((await requestAt(email, t0)).retryAfterSeconds, COOLDOWN_S);
  await settle();
  const first = codeFor(email)!;

  for (const [minutes, left] of [[1, 14 * 60], [10, 5 * 60], [14.5, 30]] as const) {
    assert.equal((await requestAt(email, t0 + minutes * MIN)).retryAfterSeconds, left, `${minutes} min in: ${left}s left`);
  }
  assert.equal((await requestAt(email, t0 + 15 * MIN - 1000)).retryAfterSeconds, 1);
  await settle();
  assert.equal(mailsTo(email), 1, 'nothing sent during the cooldown');

  assert.equal((await requestAt(email, t0 + 15 * MIN)).retryAfterSeconds, COOLDOWN_S, 'after 15 minutes a code is issued again');
  await settle();
  assert.equal(mailsTo(email), 2);
  const second = codeFor(email)!;
  if (first !== second) await assert.rejects(confirmAt(email, first, t0 + 15 * MIN + 1000), /incorrect or has expired/, 'a newer code replaces the older one');
  // ...and the clock restarts from the new code.
  assert.equal((await requestAt(email, t0 + 20 * MIN)).retryAfterSeconds, 10 * 60);
  await settle();
  assert.equal(mailsTo(email), 2);
});

test('cooldown: the first code keeps its 30-minute life and 5-attempt limit while requests are throttled', async () => {
  const a = await newUser();
  const t0 = Date.now();
  await requestAt(a.email, t0);
  await settle();
  const code = codeFor(a.email)!;
  const wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(confirmAt(a.email, wrong, t0 + MIN), /incorrect or has expired/);
  await requestAt(a.email, t0 + 14 * MIN); // throttled: must not reset the attempt counter or touch the code
  const [row] = await sql`select attempts, used_at from password_reset_codes where user_id = (select id from users where email = ${a.email})`;
  assert.equal(row.attempts, 1, 'attempt counter untouched by a throttled request');
  assert.equal(row.used_at, null, 'code untouched by a throttled request');
  const ok = await confirmAt(a.email, code, t0 + (RESET_CODE_TTL_MINUTES - 1) * MIN);
  assert.ok(ok.token, 'still valid just before 30 minutes');

  const b = await newUser();
  await requestAt(b.email, t0);
  await settle();
  await assert.rejects(confirmAt(b.email, codeFor(b.email)!, t0 + RESET_CODE_TTL_MINUTES * MIN + 1000), /incorrect or has expired/, 'expired after 30 minutes');

  // Five wrong attempts still burn the code, cooldown or not.
  const c = await newUser();
  await requestAt(c.email, t0);
  await settle();
  const cCode = codeFor(c.email)!;
  const cWrong = cCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) await assert.rejects(confirmAt(c.email, cWrong, t0 + (i + 1) * MIN));
  await assert.rejects(confirmAt(c.email, cCode, t0 + 6 * MIN), /incorrect or has expired/, 'burned after too many wrong attempts');
});

test('cooldown survives a restart (it is stored with the code, not just in memory)', async () => {
  const { email } = await newUser();
  await request(email);
  await settle();
  assert.equal(mailsTo(email), 1);
  resetRateLimits(); // what a restart does to everything kept in memory
  const body = (await (await request(email)).json()) as { retryAfterSeconds: number };
  assert.ok(body.retryAfterSeconds > COOLDOWN_S - 30 && body.retryAfterSeconds <= COOLDOWN_S);
  await settle();
  assert.equal(mailsTo(email), 1, 'still no second email');
});

test('cooldown does not reveal whether an account exists: unknown emails get the same answers over time', async () => {
  const { email } = await newUser();
  const ghost = `nobody-${crypto.randomUUID()}@example.com`;
  const t0 = Date.now();
  for (const minutes of [0, 0.5, 1, 7, 14, 15, 16, 22]) {
    const [k, u] = [await requestAt(email, t0 + minutes * MIN), await requestAt(ghost, t0 + minutes * MIN)];
    assert.deepEqual(k, u, `identical answer ${minutes} min in`);
  }
  // Over HTTP too: same status and same body shape, first and second time.
  const [e2, g2] = [(await newUser()).email, `nobody-${crypto.randomUUID()}@example.com`];
  for (let i = 0; i < 2; i++) {
    const [a, b] = [await request(e2), await request(g2)];
    assert.equal(a.status, b.status);
    assert.deepEqual(Object.keys(await a.json() as object).sort(), Object.keys(await b.json() as object).sort());
  }
  await settle();
  assert.equal(outbox.filter((m) => m.to === ghost).length, 0, 'unknown emails never get mail');
});
