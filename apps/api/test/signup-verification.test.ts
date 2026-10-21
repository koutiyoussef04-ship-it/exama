/**
 * Mandatory email confirmation at sign-up (SIGNUP_EMAIL_VERIFICATION=true, the production behaviour) and the B2B plans.
 *
 * Sign-up: registering stores a pending sign-up and emails a link — no account, organization or session exists until the
 * link is opened; the link is single-use and expires; a new link replaces the old one; duplicates, cooldowns and per-IP
 * limits; organizations are not asked their age group. Plans: pilot (30 days, totals), member seats (admins + editors;
 * reviewers unlimited), an ended pilot keeps data and exports but can't create, the owner assigns paid plans by hand.
 * Tokens are only ever read from the test outbox, never printed.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import type { AdminOrganization, AuthResponse, BankItemList, DocumentDetail, OrganizationMember, OrganizationOverview, SignupPending, VerifyEmailResult } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `sv-owner-${RUN}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', SIGNUP_EMAIL_VERIFICATION: 'true', OWNER_EMAILS: OWNER_EMAIL });
delete process.env.EMAIL_VERIFICATION_REQUIRED;
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { outbox } = await import('../src/lib/mailer.js');
const { resetSignupRateLimits } = await import('../src/services/signup.js');
const { resetVerificationRateLimits } = await import('../src/services/email-verification.js');
after(async () => {
  const ids = (await sql`select id from organizations where name like ${`SV % ${RUN}`}`) as unknown as { id: string }[];
  for (const { id } of ids) {
    await sql`delete from documents where organization_id = ${id}`;
    await sql`delete from organizations where id = ${id}`;
  }
  await sql`delete from pending_signups where email like ${`sv-%-${RUN}-%`}`;
  await sql.end();
});
beforeEach(() => {
  resetSignupRateLimits();
  resetVerificationRateLimits();
});

const PASSWORD = 'correct-horse-battery-staple';
let n = 0;
async function call<T>(path: string, init: RequestInit & { token?: string; ip?: string } = {}) {
  const { token, ip, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': ip ?? `10.7.${++n % 250}.3`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, body: (isJson && text ? JSON.parse(text) : null) as T & { code?: string; details?: Record<string, unknown> } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const emailFor = (tag: string) => `sv-${tag}-${RUN}-${++n}@example.com`;
const links = (to: string) => outbox.filter((m) => m.to === to && /\/verify-email#token=/.test(m.text)).map((m) => /#token=([A-Za-z0-9_-]+)/.exec(m.text)![1]);
const register = (body: Record<string, unknown>, ip?: string) => call<SignupPending>('/auth/register', { ...json('POST', { password: PASSWORD, name: 'Test Person', ...body }), ip });
const verify = (token: string) => call<VerifyEmailResult>('/auth/email-verification/verify', json('POST', { token }));
const login = (email: string, password = PASSWORD) => call<AuthResponse>('/auth/login', json('POST', { email, password }));
const usersWith = async (email: string) => Number(((await sql`select count(*)::int as c from users where email = ${email}`) as unknown as { c: number }[])[0].c);

/** Full sign-up through the emailed link; returns the session the link opens. */
async function signUp(tag: string, extra: Record<string, unknown> = {}) {
  const email = (extra.email as string | undefined) ?? emailFor(tag);
  const r = await register({ ageRange: '25_34', ...extra, email });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const v = await verify(links(email).at(-1)!);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const auth = v.body.auth!;
  return { email, token: auth.token, id: auth.user.id, user: auth.user };
}
const orgSignUp = (tag: string) => signUp(tag, { accountType: 'organization', organizationName: `SV ${tag} ${RUN}`, market: 'training_provider', ageRange: undefined });

// ---------------------------------------------------------------- sign-up

test('student sign-up: nothing exists until the link is opened; the link signs in once; the account is verified', async () => {
  const email = emailFor('student');
  const r = await register({ email, ageRange: '18_24', language: 'es' });
  assert.equal(r.status, 202);
  assert.deepEqual([r.body.status, r.body.email], ['verification_pending', email]);
  assert.equal(r.body.retryAfterSeconds, 60);
  assert.equal(await usersWith(email), 0, 'no account before confirmation');
  assert.equal(links(email).length, 1);
  assert.match(outbox.filter((m) => m.to === email).at(-1)!.subject, /confirma|correo/i, 'email in the sign-up language');

  // Before confirming: the right password says "check your email"; a wrong one is an ordinary failure.
  const early = await login(email);
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'signup_pending');
  assert.equal((await login(email, 'wrong-password-123')).status, 401);

  const v = await verify(links(email)[0]);
  assert.equal(v.status, 200);
  assert.equal(v.body.status, 'verified');
  assert.ok(v.body.auth?.token);
  assert.equal(v.body.auth!.user.email, email);
  const [u] = (await sql`select email_verified_at, age_range, account_type from users where email = ${email}`) as unknown as { email_verified_at: Date | null; age_range: string; account_type: string }[];
  assert.ok(u.email_verified_at, 'verified on creation');
  assert.deepEqual([u.age_range, u.account_type], ['18_24', 'student']);
  const me = await call<{ email: string }>('/auth/me', { token: v.body.auth!.token });
  assert.equal(me.status, 200);
  const state = await call<{ verified: boolean; restricted: boolean }>('/auth/email-verification', { token: v.body.auth!.token });
  assert.deepEqual([state.body.verified, state.body.restricted], [true, false]);

  // Single use; sign-in now works normally; the address is taken.
  const again = await verify(links(email)[0]);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'verification_link_used');
  assert.equal((await login(email)).status, 200);
  const dup = await register({ email, ageRange: '18_24' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'email_taken');
  assert.equal(await usersWith(email), 1);
});

test('invalid and expired links; nothing is created', async () => {
  assert.equal((await verify('short')).status, 400);
  assert.equal((await verify('A'.repeat(43))).status, 400, 'well-formed but unknown');

  const email = emailFor('expired');
  assert.equal((await register({ email, ageRange: '25_34' })).status, 202);
  await sql`update pending_signups set expires_at = now() - interval '1 minute' where email = ${email}`;
  const v = await verify(links(email)[0]);
  assert.equal(v.status, 410);
  assert.equal(v.body.code, 'verification_link_expired');
  assert.equal(await usersWith(email), 0);
});

test('new link: cooldown and hourly cap per address; the new link replaces the old one; same answer for unknown addresses', async () => {
  const email = emailFor('resend');
  assert.equal((await register({ email, ageRange: '25_34' })).status, 202);

  // Registering again right away: 429 with the wait, no second email.
  const quick = await register({ email, ageRange: '25_34' });
  assert.equal(quick.status, 429);
  assert.ok(Number(quick.body.details?.retryAfterSeconds) > 0);
  assert.equal(links(email).length, 1);

  // "Send me a new link" within the cooldown: same 202 answer, nothing sent.
  const request = (e: string) => call<{ retryAfterSeconds: number }>('/auth/email-verification/request', json('POST', { email: e }));
  assert.equal((await request(email)).status, 202);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(links(email).length, 1);

  // After the cooldown: a new link; the first one stops working.
  await sql`update pending_signups set last_sent_at = now() - interval '2 minutes' where email = ${email}`;
  resetVerificationRateLimits(); // the request endpoint's own in-memory cooldown for the address
  assert.equal((await request(email)).status, 202);
  for (let i = 0; i < 100 && links(email).length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const [first, second] = links(email);
  assert.ok(second && second !== first);
  assert.equal((await verify(first)).status, 400, 'the replaced link is invalid');
  assert.equal((await verify(second)).status, 200);

  // Unknown address: identical answer, no email.
  const ghost = emailFor('ghost');
  assert.equal((await request(ghost)).status, 202);
  assert.equal(outbox.filter((m) => m.to === ghost).length, 0);

  // Hourly cap per address (5 emails), even with the cooldown out of the way.
  const capped = emailFor('cap');
  for (let i = 0; i < 5; i++) {
    await sql`update pending_signups set last_sent_at = now() - interval '2 minutes' where email = ${capped}`;
    assert.equal((await register({ email: capped, ageRange: '25_34' })).status, 202, `attempt ${i + 1}`);
  }
  await sql`update pending_signups set last_sent_at = now() - interval '2 minutes' where email = ${capped}`;
  assert.equal((await register({ email: capped, ageRange: '25_34' })).status, 429);
  assert.equal(links(capped).length, 5);
});

test('two pending sign-ups for one address: the opened link decides; the other becomes useless', async () => {
  const email = emailFor('race');
  assert.equal((await register({ email, ageRange: '25_34', name: 'First' })).status, 202);
  await sql`update pending_signups set last_sent_at = now() - interval '2 minutes' where email = ${email}`;
  assert.equal((await register({ email, ageRange: '25_34', name: 'Second' })).status, 202);
  const [a, b] = links(email);
  const v = await verify(b);
  assert.equal(v.status, 200);
  assert.equal(v.body.auth!.user.name, 'Second');
  assert.equal((await verify(a)).status, 400, 'other pending sign-ups are removed');
  assert.equal(await usersWith(email), 1);
});

test('per-IP registration limit (automated sign-ups)', async () => {
  const ip = '10.66.0.1';
  for (let i = 0; i < 10; i++) assert.equal((await register({ email: emailFor('bot'), ageRange: '25_34' }, ip)).status, 202);
  const blocked = await register({ email: emailFor('bot'), ageRange: '25_34' }, ip);
  assert.equal(blocked.status, 429);
  assert.equal((await register({ email: emailFor('human'), ageRange: '25_34' })).status, 202, 'other clients are unaffected');
});

test('organization sign-up: no age question; the organization is created only when the link is opened', async () => {
  const email = emailFor('org');
  const name = `SV org ${RUN}`;
  const r = await register({ email, accountType: 'organization', organizationName: name, market: 'academy' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(((await sql`select count(*)::int as c from organizations where name = ${name}`) as unknown as { c: number }[])[0].c, 0);
  // Students still must answer it; under 13 is still refused first.
  assert.equal((await register({ email: emailFor('noage') })).body.code, 'age_range_required');
  assert.equal((await register({ email: emailFor('kid'), ageRange: 'under_13', accountType: 'organization', organizationName: 'x', market: 'academy' })).status, 403);

  const v = await verify(links(email)[0]);
  assert.equal(v.status, 200);
  const user = v.body.auth!.user;
  assert.equal(user.accountType, 'organization');
  assert.equal(user.organizations.length, 1);
  assert.deepEqual([user.organizations[0].name, user.organizations[0].role], [name, 'admin']);
  const [row] = (await sql`select age_range from users where email = ${email}`) as unknown as { age_range: string | null }[];
  assert.equal(row.age_range, null);
});

// ---------------------------------------------------------------- B2B plans

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
async function upload(token: string, orgId: string) {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  form.append('title', 'notes.pdf');
  return call<DocumentDetail>(`/orgs/${orgId}/courses`, { method: 'POST', body: form, token });
}
async function ready(token: string, orgId: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const d = await call<DocumentDetail>(`/orgs/${orgId}/courses/${id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('course not ready');
}
const generate = (token: string, orgId: string, docId: string, count = 3) => call(`/orgs/${orgId}/courses/${docId}/generate`, { ...json('POST', { count }), token });
const overview = (token: string, orgId: string) => call<OrganizationOverview>(`/orgs/${orgId}`, { token });

test('pilot: 30 days, pilot allowances; seats count admins and editors, reviewers are unlimited', async () => {
  const admin = await orgSignUp('seats');
  const orgId = admin.user.organizations[0].id;
  const o = (await overview(admin.token, orgId)).body;
  assert.equal(o.plan, 'pilot');
  assert.equal(o.billingPeriod, null);
  assert.equal(o.pilotExpired, false);
  const days = (new Date(o.pilotEndsAt!).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, String(days));
  assert.deepEqual(o.limits, { coursesPerMonth: 5, itemsPerMonth: 150, maxItemsPerRequest: 20, maxMembers: 3 });
  assert.equal(o.usage.period, 'pilot');

  const add = (role: string) => signUp(`m-${role}`, { accountType: 'organization' }).then(async (m) => ({ m, r: await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { ...json('POST', { email: m.email, role }), token: admin.token }) }));
  assert.equal((await add('editor')).r.status, 201);
  assert.equal((await add('admin')).r.status, 201);
  const fourth = await add('editor');
  assert.equal(fourth.r.status, 402);
  assert.equal(fourth.r.body.code, 'org_member_limit_reached');
  const reviewers = [await add('reviewer'), await add('reviewer'), await add('reviewer')];
  assert.ok(reviewers.every((x) => x.r.status === 201), 'reviewers are not counted');
  const promote = await call(`/orgs/${orgId}/members/${reviewers[0].m.id}`, { ...json('PATCH', { role: 'editor' }), token: admin.token });
  assert.equal(promote.status, 402, 'promoting a reviewer needs a free seat');
  assert.equal((await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { token: admin.token })).body.length, 6);
});

test('pilot totals count the whole pilot; an ended pilot keeps data and exports but cannot create; the owner assigns paid plans', async () => {
  const owner = await signUp('owner', { email: OWNER_EMAIL });
  const admin = await orgSignUp('expiry');
  const orgId = admin.user.organizations[0].id;
  const up = await upload(admin.token, orgId);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const doc = await ready(admin.token, orgId, up.body.id);
  assert.equal((await generate(admin.token, orgId, doc.id)).status, 201);
  const items = (await call<BankItemList>(`/orgs/${orgId}/items?status=draft`, { token: admin.token })).body;
  assert.ok(items.total > 0);
  await call(`/orgs/${orgId}/items/${items.items[0].id}/approve`, { method: 'POST', token: admin.token });

  // Usage since the pilot started counts, whatever the month; usage before it doesn't.
  await sql`update organizations set pilot_started_at = now() - interval '20 days' where id = ${orgId}`;
  await sql`insert into usage_ledger (organization_id, user_id, kind, amount, created_at) values (${orgId}, ${admin.id}, 'bank_items', 100, now() - interval '15 days'), (${orgId}, ${admin.id}, 'bank_items', 999, now() - interval '25 days')`;
  const used = (await overview(admin.token, orgId)).body.usage.itemsThisMonth;
  assert.ok(used >= 100 && used < 999, String(used));
  await sql`insert into usage_ledger (organization_id, user_id, kind, amount, created_at) values (${orgId}, ${admin.id}, 'bank_items', ${150 - used}, now() - interval '1 day')`;
  const full = await generate(admin.token, orgId, doc.id);
  assert.equal(full.status, 402);
  assert.deepEqual([full.body.code, full.body.details?.period], ['org_limit_reached', 'pilot']);

  // The pilot ends: no new courses or drafts; reading, review and exports keep working.
  await sql`update organizations set pilot_ends_at = now() - interval '1 minute' where id = ${orgId}`;
  const o = (await overview(admin.token, orgId)).body;
  assert.equal(o.pilotExpired, true);
  const g = await generate(admin.token, orgId, doc.id);
  assert.deepEqual([g.status, g.body.code], [402, 'org_pilot_expired']);
  const u = await upload(admin.token, orgId);
  assert.deepEqual([u.status, u.body.code], [402, 'org_pilot_expired']);
  assert.equal((await call<BankItemList>(`/orgs/${orgId}/items`, { token: admin.token })).body.total, items.total, 'questions kept');
  const csv = await app.request(`/orgs/${orgId}/export?format=csv`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('X-Exama-Export-Count'), '1');
  if (items.items[1]) assert.equal((await call(`/orgs/${orgId}/items/${items.items[1].id}/reject`, { ...json('POST', {}), token: admin.token })).status, 200, 'review still works');

  // The owner assigns a paid plan (billing stays manual): monthly allowances, no end date, creating works again.
  assert.equal((await call(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'esencial' }), token: admin.token })).status, 403, 'owner only');
  assert.equal((await call(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'pilot', billingPeriod: 'monthly' }), token: owner.token })).status, 400);
  const paid = await call<AdminOrganization>(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'esencial', billingPeriod: 'yearly' }), token: owner.token });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.deepEqual([paid.body.plan, paid.body.billingPeriod, paid.body.pilotEndsAt, paid.body.pilotExpired], ['esencial', 'yearly', null, false]);
  assert.deepEqual(paid.body.limits, { coursesPerMonth: 10, itemsPerMonth: 500, maxItemsPerRequest: 20, maxMembers: 10 });
  assert.equal(paid.body.usage.period, 'month');
  assert.equal((await generate(admin.token, orgId, doc.id)).status, 201);

  // Centro: custom limits set by hand. Changing plan again starts from that plan's allowances.
  const centro = await call<AdminOrganization>(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'centro', limits: { itemsPerMonth: 5000, maxMembers: 60 } }), token: owner.token });
  assert.deepEqual([centro.body.plan, centro.body.limits.itemsPerMonth, centro.body.limits.maxMembers], ['centro', 5000, 60]);
  const pro = await call<AdminOrganization>(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'profesional', billingPeriod: 'monthly' }), token: owner.token });
  assert.deepEqual(pro.body.limits, { coursesPerMonth: 100, itemsPerMonth: 2000, maxItemsPerRequest: 20, maxMembers: 25 });
  // Back to a pilot: a fresh 30 days.
  const back = await call<AdminOrganization>(`/admin/organizations/${orgId}`, { ...json('PATCH', { plan: 'pilot' }), token: owner.token });
  assert.equal(back.body.billingPeriod, null);
  assert.ok(new Date(back.body.pilotEndsAt!).getTime() > Date.now() + 29 * 86_400_000);
});

test('separate identities with confirmed sign-up: a student and an organization sign-up for one address are independent', async () => {
  const email = emailFor('both');
  const student = await signUp('both', { email });
  // The organization sign-up for the same address is accepted (it used to be 409 email_taken) and is its own pending row.
  const pending = await register({ email, password: 'org-password-77', accountType: 'organization', organizationName: `SV both ${RUN}`, market: 'academy' });
  assert.equal(pending.status, 202, JSON.stringify(pending.body));
  // Signing in to the organization before confirming: "check your email", never the student account.
  const early = await call('/auth/login', json('POST', { email, password: 'org-password-77', accountType: 'organization' }));
  assert.equal(early.body.code, 'signup_pending');
  // A new link for the organization sign-up only.
  resetSignupRateLimits();
  resetVerificationRateLimits();
  await new Promise((r) => setTimeout(r, 5));
  const v = await verify(links(email).at(-1)!);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const org = v.body.auth!;
  assert.equal(org.user.accountType, 'organization');
  assert.notEqual(org.user.id, student.id);
  assert.equal(await usersWith(email), 2);
  // Both sign in, each to its own identity; the student's pending-signup state is not touched.
  assert.equal((await login(email)).body.user.id, student.id);
  assert.equal((await call<AuthResponse>('/auth/login', json('POST', { email, password: 'org-password-77', accountType: 'organization' }))).body.user.id, org.user.id);
  // Another organization sign-up for the address is now refused; a student one too.
  assert.equal((await register({ email, accountType: 'organization' })).body.code, 'email_taken');
  assert.equal((await register({ email, ageRange: '25_34' })).body.code, 'email_taken');
});
