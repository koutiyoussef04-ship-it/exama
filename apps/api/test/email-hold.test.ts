/**
 * Deleted-email restriction: exactly 30 days from the deletion, the sign-in normalization (distinct
 * addresses stay distinct), a generic sign-up error, only an irreversible keyed hash stored, expiry and
 * purge, support release, and no record whenever the deletion fails.
 */
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { after, test } from 'node:test';
import { DELETED_EMAIL_HOLD_DAYS, normalizeEmail, type AuthResponse, type DeleteAccountResult } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true' });
const { app } = await import('../src/app.js');
const { sql, db } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { assertEmailNotHeld, emailHoldHash, holdDeletedEmail, HOLD_MS, purgeExpiredEmailHolds, releaseEmailHold } = await import('../src/services/email-hold.js');
after(() => sql.end());

const RUN = Date.now();
type ErrorBody = { error?: string; code?: string; details?: unknown };
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const register = (email: string) =>
  call<AuthResponse & ErrorBody>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'password123', name: 'Hold', ageRange: '18_24' }) });
const remove = (token: string, password = 'password123') => call<DeleteAccountResult & ErrorBody>('/auth/me', { method: 'DELETE', token, body: JSON.stringify({ password }) });
const holdRows = (email: string) => sql`select email_hash, expires_at from deleted_email_holds where email_hash = ${emailHoldHash(email)}`;
const allHolds = () => sql`select * from deleted_email_holds`;

test('normalization is the sign-in rule: case only; dots and +tags make distinct addresses', () => {
  assert.equal(normalizeEmail('Ana.Lopez+Exams@GMail.com'), 'ana.lopez+exams@gmail.com');
  assert.equal(emailHoldHash('Ana@Example.com'), emailHoldHash('ana@example.com'));
  for (const [a, b] of [
    ['ana.lopez@gmail.com', 'analopez@gmail.com'],
    ['ana+exams@gmail.com', 'ana@gmail.com'],
    ['ana@gmail.com', 'ana@googlemail.com'],
    ['ana@example.com', 'ana@example.org'],
  ]) assert.notEqual(emailHoldHash(a), emailHoldHash(b), `${a} vs ${b}`);
});

test('a deleted address is restricted for exactly 30 days from the deletion, with a generic error', async () => {
  const email = `ana.hold+${RUN}@gmail.com`;
  const r = await register(email);
  assert.equal(r.status, 201);
  const before = Date.now();
  const d = await remove(r.body.token);
  const afterDelete = Date.now();
  assert.equal(d.status, 200);
  // Exact timestamp: deletion time + 30 × 24 h, no rounding.
  const ends = new Date(d.body.emailReusableAt).getTime();
  assert.ok(ends >= before + HOLD_MS && ends <= afterDelete + HOLD_MS, `${ends - before - HOLD_MS} ms`);
  assert.equal(HOLD_MS, DELETED_EMAIL_HOLD_DAYS * 24 * 3600 * 1000);
  const [row] = await holdRows(email);
  assert.equal(new Date(row.expires_at).getTime(), ends, 'the stored end is the one returned');

  for (const variant of [email, email.toUpperCase()]) {
    const again = await register(variant);
    assert.equal(again.status, 409, variant);
    assert.equal(again.body.code, 'signup_email_unavailable');
    // Generic: no "deleted", no "recently", no date, no details.
    assert.equal(again.body.details, undefined);
    assert.doesNotMatch(again.body.error ?? '', /delet|recent|account with this|\d{4}|day/i);
  }
  // Distinct addresses are not restricted.
  for (const other of [`anahold+${RUN}@gmail.com`, `ana.hold@gmail.com`.replace('@', `+x${RUN}@`), `ana.hold+${RUN}@googlemail.com`]) {
    assert.equal((await register(other)).status, 201, other);
  }
});

test('expiry is exact: still restricted 1 ms before the end, free at the end; expired records are purged', async () => {
  const email = `expiry-${RUN}@example.com`;
  const r = await register(email);
  await remove(r.body.token);
  const [row] = await holdRows(email);
  const end = new Date(row.expires_at);
  await assert.rejects(assertEmailNotHeld(email, new Date(end.getTime() - 1)), (e: { code?: string }) => e.code === 'signup_email_unavailable');
  await assertEmailNotHeld(email, end); // resolves: the restriction is over at its end time
  // Through the API: move the end into the past → sign-up works at once, even before the purge.
  await sql`update deleted_email_holds set expires_at = now() - interval '1 millisecond' where email_hash = ${emailHoldHash(email)}`;
  assert.equal((await register(email)).status, 201);
  assert.ok((await purgeExpiredEmailHolds()) >= 1);
  assert.equal((await holdRows(email)).length, 0, 'purged');
  // Active records survive the purge.
  const still = `active-${RUN}@example.com`;
  await holdDeletedEmail(db, still);
  await purgeExpiredEmailHolds();
  assert.equal((await holdRows(still)).length, 1);
});

test('records hold no recoverable address: only a keyed hash and an end time', async () => {
  const email = `Minimal.Person+${RUN}@Example.com`;
  const r = await register(email);
  await remove(r.body.token);
  const cols = await sql`select column_name from information_schema.columns where table_name = 'deleted_email_holds' order by ordinal_position`;
  assert.deepEqual(cols.map((c) => c.column_name), ['email_hash', 'expires_at']);
  const [row] = await holdRows(email);
  assert.match(row.email_hash, /^[0-9a-f]{64}$/);
  const lower = email.toLowerCase();
  const dump = JSON.stringify(await allHolds()).toLowerCase();
  for (const part of [lower, `minimal.person+${RUN}`, 'example.com', r.body.user.id]) assert.ok(!dump.includes(part), part);
  // Not an unkeyed hash of the address (which could be checked against a list of guesses)…
  for (const algo of ['sha256', 'sha1', 'md5']) assert.notEqual(row.email_hash, createHash(algo).update(lower).digest('hex'));
  assert.notEqual(row.email_hash, createHash('sha256').update(`deleted-email-hold:${lower}`).digest('hex'));
  // …and only the server secret reproduces it.
  assert.notEqual(row.email_hash, createHmac('sha256', 'some-other-secret-of-at-least-32-chars').update(`deleted-email-hold:${lower}`).digest('hex'));
  assert.equal(row.email_hash, createHmac('sha256', config.JWT_SECRET).update(`deleted-email-hold:${lower}`).digest('hex'));
});

test('no record when the deletion fails: wrong password, missing account, or a rolled-back transaction', async () => {
  const email = `fails-${RUN}@example.com`;
  const r = await register(email);
  const count = async () => (await allHolds()).length;
  const n0 = await count();
  assert.equal((await remove(r.body.token, 'not-the-password')).status, 403);
  assert.equal((await holdRows(email)).length, 0);
  assert.equal((await call('/auth/me', { token: r.body.token })).status, 200, 'the account still exists');
  // A failure after the record is written inside the deletion transaction rolls it back too.
  await assert.rejects(
    db.transaction(async (tx) => {
      await holdDeletedEmail(tx, email);
      throw new Error('simulated failure later in the deletion');
    }),
    /simulated failure/,
  );
  assert.equal((await holdRows(email)).length, 0, 'rolled back');
  assert.equal(await count(), n0);
  assert.equal((await register(email)).body.code, 'email_taken', 'the account is untouched');
  // Deleting it for real does create one.
  assert.equal((await remove(r.body.token)).status, 200);
  assert.equal((await holdRows(email)).length, 1);
});

test('support can lift an active restriction early', async () => {
  const email = `release-${RUN}@example.com`;
  const r = await register(email);
  await remove(r.body.token);
  assert.equal((await register(email)).status, 409);
  assert.equal(await releaseEmailHold(email.toUpperCase()), true);
  assert.equal(await releaseEmailHold(email), false, 'nothing left to release');
  assert.equal((await register(email)).status, 201);
});

test('the existing checks still come first: under-13 and an existing account', async () => {
  const email = `order-${RUN}@example.com`;
  const r = await register(email);
  await remove(r.body.token);
  const kid = await call<ErrorBody>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'password123', name: 'K', ageRange: 'under_13' }) });
  assert.equal(kid.status, 403);
  assert.equal(kid.body.code, 'age_requirement_not_met');
  const live = `live-${RUN}@example.com`;
  assert.equal((await register(live)).status, 201);
  assert.equal((await register(live)).body.code, 'email_taken');
});
