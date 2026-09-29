/**
 * Password reset: one-time emailed code, no account enumeration, expiry, single use, attempt cap,
 * rate limits, older sessions ended after the reset.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', EMAIL_PROVIDER: 'log', NODE_ENV: 'test' });
const { app } = await import('../src/app.js');
const { sql, db } = await import('../src/db/client.js');
const { passwordResetCodes } = await import('../src/db/schema.js');
const { outbox } = await import('../src/lib/mailer.js');
const { resetRateLimits, RESET_MAX_ATTEMPTS } = await import('../src/services/password-reset.js');
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
const request = (email: string, extra: object = {}, o?: { ip?: string }) => call('/auth/password-reset/request', { email, ...extra }, o);
const confirm = (email: string, code: string, password = 'new-password-2', o?: { ip?: string }) => call('/auth/password-reset/confirm', { email, code, password }, o);

test('request: same 202 answer for known and unknown emails; only real accounts get a code', async () => {
  const { email } = await newUser();
  const before = outbox.length;
  const known = await request(email);
  const unknown = await request(`nobody-${crypto.randomUUID()}@example.com`);
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(await known.json(), await unknown.json(), 'identical bodies: no account enumeration');
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
  // Too-short password rejected before anything is checked.
  await request(email);
  await new Promise((r) => setTimeout(r, 20));
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
  await request(b.email);
  await new Promise((r) => setTimeout(r, 20));
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

  resetRateLimits();
  const before = outbox.filter((m) => m.to === email).length;
  for (let i = 0; i < 5; i++) assert.equal((await request(email)).status, 202, 'same answer even when no email is sent');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(outbox.filter((m) => m.to === email).length - before, 3);

  resetRateLimits();
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await confirm(email, '123456', 'whatever-123', sameIp)).status);
  assert.equal(codes[20], 429);
});
