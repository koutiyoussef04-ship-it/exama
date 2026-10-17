/**
 * The Free plan's course allowance is per account, for good: once a Free account has created its course,
 * deleting it doesn't let it create another — not after signing in again, not with parallel requests.
 * Refused uploads and courses whose processing failed don't use it up. Trial and paid plans keep their
 * "courses at the same time" limits. Server-side only: nothing the client sends changes the outcome.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { AuthResponse, DocumentDetail, DocumentSummary, Entitlement, LimitErrorBody } from '@study/shared';

const RUN = Date.now();
const OWNER_ID = crypto.randomUUID();
Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true', OWNER_USER_IDS: OWNER_ID });
delete process.env.PLAN_LIMITS_OVERRIDE;

const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { LIMITS } = await import('../src/billing/limits.js');
after(() => sql.end());

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const post = (body: unknown, token?: string) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

let n = 0;
async function newUser() {
  const email = `courses-${RUN}-${n++}@example.com`;
  const r = await call<AuthResponse>('/auth/register', post({ email, password: 'password123', name: 'Tester', ageRange: '18_24' }));
  assert.equal(r.status, 201);
  return { token: r.body.token, id: r.body.user.id, email };
}
const login = async (email: string) => {
  const r = await call<AuthResponse>('/auth/login', post({ email, password: 'password123' }));
  assert.equal(r.status, 200);
  return r.body.token;
};
async function upload(token: string, file = new File([pdf], 'notes.pdf', { type: 'application/pdf' })) {
  const form = new FormData();
  form.append('file', file);
  return call<DocumentDetail & LimitErrorBody>('/documents', { method: 'POST', body: form, token });
}
async function readyCourse(token: string) {
  const up = await upload(token);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 50; i++) {
    if ((await call<DocumentDetail>(`/documents/${up.body.id}`, { token })).body.status === 'ready') return up.body.id;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('not ready');
}
const del = (token: string, id: string) => call(`/documents/${id}`, { method: 'DELETE', token });
const status = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body;
const courses = async (token: string) => (await call<DocumentSummary[]>('/documents', { token })).body;
const counts = async (userId: string) => {
  const [r] = await sql`select
    (select count(*)::int from course_creations where user_id = ${userId}) as created,
    (select count(*)::int from documents where user_id = ${userId}) as existing,
    (select count(*)::int from usage_ledger where user_id = ${userId} and kind = 'course_upload') as uploads`;
  return r as { created: number; existing: number; uploads: number };
};
const refusedFree = (r: { status: number; body: LimitErrorBody }) => {
  assert.equal(r.status, 402, JSON.stringify(r.body));
  assert.deepEqual([r.body.code, r.body.feature, r.body.limit, r.body.used, r.body.tier], ['limit_reached', 'courses', 1, 1, 'free']);
};

test('Free: the one course can be created; deleting it does not give it back, even in a new session', async () => {
  assert.equal(LIMITS.free.courses, 1);
  const u = await newUser();
  const first = await readyCourse(u.token);
  assert.deepEqual([(await status(u.token)).usage.courses, (await status(u.token)).limits.courses], [1, 1]);
  refusedFree(await upload(u.token));

  // Deleting still works…
  assert.equal((await del(u.token, first)).status, 204);
  assert.deepEqual(await courses(u.token), []);
  // …but the allowance stays used.
  const s = await status(u.token);
  assert.deepEqual([s.tier, s.usage.courses, s.limits.courses], ['free', 1, 1]);
  refusedFree(await upload(u.token));
  assert.deepEqual(await counts(u.id), { created: 1, existing: 0, uploads: 1 }, 'a refused upload leaves no course and no usage');

  // A new session (sign in again: another device, a reinstall, after logout) changes nothing.
  await new Promise((r) => setTimeout(r, 1100)); // a token issued in another second: a genuinely new session
  const again = await login(u.email);
  assert.notEqual(again, u.token);
  assert.equal((await status(again)).usage.courses, 1);
  refusedFree(await upload(again));
  assert.deepEqual(await courses(again), []);
});

test('Free: parallel uploads cannot create more than the one course', async () => {
  const u = await newUser();
  const results = await Promise.all(Array.from({ length: 5 }, () => upload(u.token)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 402, 402, 402, 402]);
  for (const r of results.filter((x) => x.status === 402)) assert.deepEqual([r.body.feature, r.body.tier], ['courses', 'free']);
  assert.deepEqual(await counts(u.id), { created: 1, existing: 1, uploads: 1 });

  // And after deleting it, parallel attempts are all refused.
  await del(u.token, results.find((r) => r.status === 201)!.body.id);
  const retry = await Promise.all(Array.from({ length: 3 }, () => upload(u.token)));
  assert.deepEqual(retry.map((r) => r.status), [402, 402, 402]);
  assert.deepEqual(await counts(u.id), { created: 1, existing: 0, uploads: 1 });
});

test('Free: refused uploads and a course whose processing failed do not use up the allowance', async () => {
  const u = await newUser();
  // Not a PDF/PowerPoint: refused before anything is stored.
  const bad = await upload(u.token, new File([new TextEncoder().encode('just text')], 'notes.txt', { type: 'text/plain' }));
  assert.ok(bad.status >= 400 && bad.status < 500 && bad.status !== 402, `refused: ${bad.status}`);
  assert.deepEqual(await counts(u.id), { created: 0, existing: 0, uploads: 0 });

  // A course whose processing failed (e.g. a scanned PDF without text) and that the student deletes.
  const doc = await readyCourse(u.token);
  await sql`update documents set status = 'failed', error_code = 'pdf_no_text' where id = ${doc}`;
  refusedFree(await upload(u.token)); // still counts while it exists
  assert.equal((await del(u.token, doc)).status, 204);
  assert.equal((await status(u.token)).usage.courses, 0, 'a course that never worked is not counted');

  // The replacement course is the one: deleting a working course keeps it counted.
  const ok = await readyCourse(u.token);
  assert.equal((await del(u.token, ok)).status, 204);
  refusedFree(await upload(u.token));
});

test('trial and paid plans keep their limits; courses created on them still count if the account returns to Free', async () => {
  // Trial: one course at a time (unchanged); deleting it frees the slot within the trial's upload allowance.
  const t = await newUser();
  assert.equal((await call('/billing/purchase', post({ planId: 'student_monthly', startTrial: true }, t.token))).status, 200);
  const t1 = await readyCourse(t.token);
  assert.equal((await upload(t.token)).body.feature, 'courses');
  await del(t.token, t1);
  assert.equal((await upload(t.token)).status, 201, 'trial: deleting frees the slot as before');

  // Basic: 3 at once; deleting frees a slot, however many were created before.
  const b = await newUser();
  assert.equal((await call('/billing/purchase', post({ planId: 'basic_monthly' }, b.token))).status, 200);
  for (let i = 0; i < 4; i++) await del(b.token, await readyCourse(b.token));
  const ids = [await readyCourse(b.token), await readyCourse(b.token), await readyCourse(b.token)];
  const fourth = await upload(b.token);
  assert.deepEqual([fourth.status, fourth.body.feature, fourth.body.limit, fourth.body.used, fourth.body.tier], [402, 'courses', 3, 3, 'basic']);
  await del(b.token, ids[0]!);
  assert.equal((await upload(b.token)).status, 201);

  // Student: well past one course, deletions don't matter.
  const s = await newUser();
  assert.equal((await call('/billing/purchase', post({ planId: 'student_monthly' }, s.token))).status, 200);
  await del(s.token, await readyCourse(s.token));
  await readyCourse(s.token);
  await readyCourse(s.token);
  assert.deepEqual([(await status(s.token)).usage.courses, (await status(s.token)).limits.courses], [2, LIMITS.student.courses]);

  // The subscription ends: back on Free, the courses the account created count (like Free's one lecture).
  await sql`update subscriptions set current_period_ends_at = now() - interval '1 minute' where user_id = ${s.id}`;
  for (const c of await courses(s.token)) await del(s.token, c.id);
  const lapsed = await status(s.token);
  assert.deepEqual([lapsed.tier, lapsed.usage.courses, lapsed.limits.courses], ['free', 3, 1]);
  const refused = await upload(s.token);
  assert.deepEqual([refused.status, refused.body.feature, refused.body.tier], [402, 'courses', 'free']);

  // Owner access stays unlimited.
  await sql`insert into users (id, email, password_hash, name) values (${OWNER_ID}, ${`owner-${RUN}@example.com`}, 'x', 'Owner')`;
  await sql`insert into course_creations (user_id, document_id) select ${OWNER_ID}, gen_random_uuid() from generate_series(1, 5)`;
  const { signToken } = await import('../src/auth/auth.js');
  const ownerToken = await signToken(OWNER_ID);
  assert.equal((await status(ownerToken)).limits.courses, null);
  assert.equal((await upload(ownerToken)).status, 201);
});

test('existing accounts: the migration counts the courses that exist; account deletion removes the records', async () => {
  // An account from before the migration: a course without a course_creations row.
  const u = await newUser();
  const doc = await readyCourse(u.token);
  await sql`delete from course_creations where user_id = ${u.id}`;
  refusedFree(await upload(u.token)); // the existing course still counts (never below what exists)
  // The migration's backfill (0017) records it; running it again changes nothing.
  const backfill = (await readFile(new URL('../drizzle/0017_course_creations.sql', import.meta.url), 'utf8')).split('--> statement-breakpoint').pop()!;
  await sql.unsafe(backfill);
  await sql.unsafe(backfill);
  assert.deepEqual(await counts(u.id), { created: 1, existing: 1, uploads: 1 });
  await del(u.token, doc);
  refusedFree(await upload(u.token));

  assert.equal((await call('/auth/me', { ...post({ password: 'password123' }, u.token), method: 'DELETE' })).status, 200);
  assert.deepEqual(await counts(u.id), { created: 0, existing: 0, uploads: 0 });
});
