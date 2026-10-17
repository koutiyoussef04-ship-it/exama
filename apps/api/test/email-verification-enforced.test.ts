/**
 * Email verification with enforcement ON (EMAIL_VERIFICATION_REQUIRED=true, 1-hour grace period):
 * new accounts keep full access during the grace period; afterwards courses and exams answer 403
 * email_not_verified until the email is confirmed, while sign-in, account, onboarding, billing and
 * account deletion keep working. Older accounts are never restricted.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, EmailVerificationState } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', EMAIL_VERIFICATION_REQUIRED: 'true', EMAIL_VERIFICATION_GRACE_HOURS: '1' });
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { outbox } = await import('../src/lib/mailer.js');
after(() => sql.end());

const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
let n = 0;
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.8.${++n % 250}.1`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string; details?: Record<string, unknown> } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
async function signUp(tag: string) {
  const email = `enf-${tag}-${RUN}-${++n}@example.com`;
  const r = await call<AuthResponse>('/auth/register', json('POST', { email, password: PASSWORD, name: 'Eve', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  return { email, token: r.body.token, id: r.body.user.id };
}
async function linkToken(email: string) {
  for (let i = 0; i < 100; i++) {
    const m = [...outbox].reverse().find((x) => x.to === email && x.text.includes('#token='));
    if (m) return /#token=([A-Za-z0-9_-]+)/.exec(m.text)![1];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('no verification email');
}
const pastGrace = (userId: string) => sql`update users set created_at = now() - interval '2 hours' where id = ${userId}`;
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
const upload = (token: string) => {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  return call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
};

test('during the grace period a new unverified account can use everything', async () => {
  const u = await signUp('grace');
  const s = (await call<EmailVerificationState>('/auth/email-verification', { token: u.token })).body;
  assert.equal(s.required, true);
  assert.equal(s.restricted, false);
  const hours = (new Date(s.restrictedFrom!).getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 0.95 && hours <= 1, `restricted from sign-up + 1 h (${hours})`);
  assert.equal((await call('/documents', { token: u.token })).status, 200);
  assert.equal((await upload(u.token)).status, 201);
});

test('after the grace period courses and exams are blocked on the server; everything else keeps working', async () => {
  const u = await signUp('after');
  const doc = await upload(u.token);
  assert.equal(doc.status, 201);
  await pastGrace(u.id);

  const s = (await call<EmailVerificationState>('/auth/email-verification', { token: u.token })).body;
  assert.equal(s.restricted, true);
  for (const [path, init] of [
    ['/documents', {}],
    [`/documents/${doc.body.id}`, {}],
    [`/documents/${doc.body.id}/progress`, {}],
    [`/documents/${doc.body.id}/study-plan`, {}],
    [`/documents/${doc.body.id}/materials`, {}],
    [`/documents/${doc.body.id}/exams`, json('POST', { questionCount: 3 })],
    ['/exams/00000000-0000-4000-8000-000000000000', {}],
    [`/documents/${doc.body.id}/flashcards`, {}],
    [`/documents/${doc.body.id}/flashcards`, json('POST', {})],
    ['/flashcards/00000000-0000-4000-8000-000000000000', {}],
  ] as const) {
    const r = await call(path, { ...init, token: u.token });
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'email_not_verified', path);
  }
  assert.equal((await upload(u.token)).status, 403, 'no new uploads');

  // Still available while restricted.
  assert.equal((await call('/auth/me', { token: u.token })).status, 200);
  assert.equal((await call('/auth/login', json('POST', { email: u.email, password: PASSWORD }))).status, 200);
  assert.equal((await call('/onboarding', { token: u.token })).status, 200);
  assert.equal((await call('/billing/status', { token: u.token })).status, 200);
  assert.equal((await call('/billing/plans?platform=web')).status, 200);
  assert.equal((await call('/auth/email-verification/resend', { ...json('POST', {}), token: u.token })).status, 200, 'cooldown answer, not blocked');
  // No session at all is still a 401, not a 403.
  assert.equal((await call('/documents')).status, 401);

  // Confirming the email lifts the restriction immediately.
  assert.equal((await call('/auth/email-verification/verify', json('POST', { token: await linkToken(u.email) }))).status, 200);
  assert.equal((await call('/documents', { token: u.token })).status, 200);
  assert.equal((await call(`/documents/${doc.body.id}`, { token: u.token })).status, 200);
});

test('accounts created before verification existed are never restricted', async () => {
  const u = await signUp('legacy');
  await sql`update users set email_verification_required = false, created_at = now() - interval '200 days' where id = ${u.id}`;
  assert.equal((await call('/documents', { token: u.token })).status, 200);
  assert.equal((await call<EmailVerificationState>('/auth/email-verification', { token: u.token })).body.restricted, false);
});

test('a restricted student can still delete their account', async () => {
  const u = await signUp('delete');
  await pastGrace(u.id);
  assert.equal((await call('/documents', { token: u.token })).status, 403);
  assert.equal((await call('/auth/me', { ...json('DELETE', { password: PASSWORD }), token: u.token })).status, 200);
});
