/**
 * Student and organization accounts are separate identities: the same email can have one of each, with its own
 * password, sessions, reset codes, verification, deletion hold, memberships and permissions — and nothing is ever
 * shared or granted because the addresses match. Also: the B2B owner role (users.b2b_role), its provisioning command,
 * its dashboard (/b2b-admin) and its server-side unlimited usage; and the student owner (OWNER_EMAILS) unchanged.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { after, beforeEach, test } from 'node:test';
import type { AuthResponse, B2BAccountRow, B2BOrganizationDetail, B2BOrganizationRow, B2BOverview, DocumentDetail, Entitlement, OrganizationMember, OrganizationMembershipSummary, User } from '@study/shared';

const RUN = Date.now();
const STUDENT_OWNER_EMAIL = `sep-owner-${RUN}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', EMAIL_PROVIDER: 'log', NODE_ENV: 'test', BILLING_MOCK_ENABLED: 'true', OWNER_EMAILS: STUDENT_OWNER_EMAIL });
delete process.env.PLAN_LIMITS_OVERRIDE;
delete process.env.PLAN_FEATURES_OVERRIDE;
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { signToken } = await import('../src/auth/auth.js');
const { isOwner } = await import('../src/billing/entitlements.js');
const { outbox } = await import('../src/lib/mailer.js');
const { resetRateLimits } = await import('../src/services/password-reset.js');
const { resetSignupRateLimits } = await import('../src/services/signup.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const run = promisify(execFile);

after(async () => {
  const ids = (await sql`select id from organizations where name like ${`Sep % ${RUN}`}`) as unknown as { id: string }[];
  for (const { id } of ids) {
    await sql`delete from documents where organization_id = ${id}`;
    await sql`delete from organizations where id = ${id}`;
  }
  await flushAnalytics();
  await sql.end();
});
beforeEach(() => {
  resetRateLimits();
  resetSignupRateLimits();
});

let n = 0;
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.77.${++n % 250}.3`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, body: (isJson && text ? JSON.parse(text) : null) as T & { code?: string; error?: string } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const STUDENT_PW = 'student-password-111';
const ORG_PW = 'organization-password-222';
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

const registerStudent = (email: string, password = STUDENT_PW) => call<AuthResponse>('/auth/register', json('POST', { email, password, name: 'Sam Student', ageRange: '18_24' }));
const registerOrg = (email: string, password = ORG_PW, org?: string) =>
  call<AuthResponse>('/auth/register', json('POST', { email, password, name: 'Olga Org', accountType: 'organization', ...(org ? { organizationName: `Sep ${org} ${RUN}`, market: 'training_center' } : {}) }));
const login = (email: string, password: string, accountType?: 'student' | 'organization') => call<AuthResponse>('/auth/login', json('POST', { email, password, ...(accountType && { accountType }) }));
const mailCode = (email: string, predicate: (subject: string) => boolean = () => true) =>
  [...outbox].reverse().find((m) => m.to === email && predicate(m.subject) && /\b\d{6}\b/.test(m.text))?.text.match(/\b(\d{6})\b/)?.[1];
const upload = async (token: string, orgId: string) => {
  const form = new FormData();
  form.append('file', new File([pdf], 'course.pdf', { type: 'application/pdf' }));
  return call<DocumentDetail>(`/orgs/${orgId}/courses`, { method: 'POST', body: form, token });
};

test('the same email registers independently as a student and as an organization; each sign-in selects only its own identity', async () => {
  const email = `same-${RUN}@example.com`;
  const s = await registerStudent(email);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  // Before the split this was 409 email_taken (users.email was unique).
  const o = await registerOrg(email, ORG_PW, 'same');
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.notEqual(o.body.user.id, s.body.user.id, 'two different accounts');
  assert.deepEqual([s.body.user.accountType, o.body.user.accountType], ['student', 'organization']);
  // Still one of each at most.
  assert.equal((await registerStudent(email)).body.code, 'email_taken');
  assert.equal((await registerOrg(email)).body.code, 'email_taken');
  // Database level: (email, account_type) is unique.
  await assert.rejects(sql`insert into users (email, name, password_hash, account_type) values (${email}, 'x', 'x', 'organization')`, /users_email_account_type_unique/);

  // Organization sign-in → the organization identity, even though a student account has the same email.
  const lo = await login(email, ORG_PW, 'organization');
  assert.equal(lo.status, 200);
  assert.equal(lo.body.user.id, o.body.user.id);
  assert.equal(lo.body.user.organizations.length, 1);
  // Student sign-in (explicit, or an older app that sends no type) → the student identity only.
  for (const realm of ['student', undefined] as const) {
    const ls = await login(email, STUDENT_PW, realm);
    assert.equal(ls.status, 200);
    assert.equal(ls.body.user.id, s.body.user.id);
    assert.deepEqual(ls.body.user.organizations, []);
  }
  // Separate credentials: one identity's password never opens the other. With the right password for the OTHER type the
  // answer is 403 wrong_account_type (no token), so the app can offer that sign-in; the caller already holds that password.
  const wrongS = await login(email, STUDENT_PW, 'organization');
  assert.deepEqual([wrongS.status, wrongS.body.code, (wrongS.body as unknown as { details: { accountType: string } }).details.accountType, 'token' in wrongS.body], [403, 'wrong_account_type', 'student', false]);
  const wrongO = await login(email, ORG_PW, 'student');
  assert.deepEqual([wrongO.status, wrongO.body.code, (wrongO.body as unknown as { details: { accountType: string } }).details.accountType, 'token' in wrongO.body], [403, 'wrong_account_type', 'organization', false]);
  assert.equal((await login(email, ORG_PW)).status, 401, 'no type → the student account, whose password this is not (older apps: nothing new is revealed)');
  // A wrong password for both: plain 401, whichever type is chosen — nothing says whether either account exists.
  assert.deepEqual([(await login(email, 'not-either-password', 'student')).status, (await login(email, 'not-either-password', 'organization')).status], [401, 401]);

  // Each session is its own identity.
  const meS = await call<User>('/auth/me', { token: s.body.token });
  const meO = await call<User>('/auth/me', { token: lo.body.token });
  assert.deepEqual([meS.body.id, meS.body.accountType], [s.body.user.id, 'student']);
  assert.deepEqual([meO.body.id, meO.body.accountType], [o.body.user.id, 'organization']);
});

test('an organization-only email still signs in without a type (older apps), as before the split', async () => {
  const email = `orgonly-${RUN}@example.com`;
  const o = await registerOrg(email, ORG_PW, 'orgonly');
  assert.equal(o.status, 201);
  const l = await login(email, ORG_PW);
  assert.equal(l.status, 200);
  assert.equal(l.body.user.id, o.body.user.id);
  const viaStudent = await login(email, ORG_PW, 'student');
  assert.deepEqual([viaStudent.status, viaStudent.body.code, 'token' in viaStudent.body], [403, 'wrong_account_type', false], 'but not through the student sign-in: pointed back to the organization one, no session');
});

test('choosing a type is not authenticating: a single-identity email gets 401 for the other type (no hint), and the hint only follows a correct password', async () => {
  // Student only.
  const sEmail = `only-student-${RUN}@example.com`;
  assert.equal((await registerStudent(sEmail)).status, 201);
  const noOrg = await login(sEmail, STUDENT_PW, 'organization');
  assert.deepEqual([noOrg.status, noOrg.body.code, (noOrg.body as unknown as { details: { accountType: string } }).details.accountType], [403, 'wrong_account_type', 'student'], 'right password, wrong type: pointed to the student sign-in, no session');
  assert.equal((await login(sEmail, 'wrong-password', 'organization')).status, 401, 'wrong password: nothing about the student account is revealed');
  assert.equal((await login(sEmail, 'wrong-password', 'student')).status, 401);
  // Organization only.
  const oEmail = `only-org-${RUN}@example.com`;
  assert.equal((await registerOrg(oEmail, ORG_PW, 'only')).status, 201);
  const noStudent = await login(oEmail, ORG_PW, 'student');
  assert.deepEqual([noStudent.status, noStudent.body.code, (noStudent.body as unknown as { details: { accountType: string } }).details.accountType, 'token' in noStudent.body], [403, 'wrong_account_type', 'organization', false]);
  assert.equal((await login(oEmail, 'wrong-password', 'student')).status, 401);
  // No account at all: 401 for both types, same body as a wrong password.
  const nobody = `nobody-${RUN}@example.com`;
  const n1 = await login(nobody, STUDENT_PW, 'student');
  const n2 = await login(nobody, STUDENT_PW, 'organization');
  assert.deepEqual([n1.status, n2.status, n1.body.code, n2.body.code], [401, 401, 'invalid_credentials', 'invalid_credentials']);
  assert.deepEqual(n1.body, (await login(sEmail, 'wrong-password', 'organization')).body, 'an unknown email and a wrong password are indistinguishable');
});

test('sessions: a token only works as the identity it was issued for; older tokens without the type claim stay valid', async () => {
  const email = `tok-${RUN}@example.com`;
  const s = await registerStudent(email);
  const o = await registerOrg(email, ORG_PW, 'tok');
  // A token claiming the other account type for this account id is refused.
  const forged = await signToken(s.body.user.id, null, 'organization');
  assert.equal((await call('/auth/me', { token: forged })).status, 401);
  // Sessions issued before this change (no `act` claim) keep working, for both account types.
  assert.equal((await call<User>('/auth/me', { token: await signToken(s.body.user.id) })).body.id, s.body.user.id);
  assert.equal((await call<User>('/auth/me', { token: await signToken(o.body.user.id) })).body.id, o.body.user.id);
});

test('independent password resets: the code is for one identity; resetting one never changes the other', async () => {
  const email = `reset-${RUN}@example.com`;
  const s = await registerStudent(email);
  const o = await registerOrg(email, ORG_PW, 'reset');
  const studentSession = s.body.token;

  assert.equal((await call('/auth/password-reset/request', json('POST', { email, accountType: 'organization' }))).status, 202);
  const code = mailCode(email, (subject) => subject.includes('organization account'));
  assert.ok(code, 'the organization reset email says which account it is for');
  // The organization code does not reset the student account.
  const wrongRealm = await call('/auth/password-reset/confirm', json('POST', { email, code, password: 'hijack-password-9', accountType: 'student' }));
  assert.equal(wrongRealm.body.code, 'reset_code_invalid');
  const ok = await call<AuthResponse>('/auth/password-reset/confirm', json('POST', { email, code, password: 'new-org-password-3', accountType: 'organization' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.id, o.body.user.id);
  assert.equal(ok.body.user.accountType, 'organization');

  assert.equal((await login(email, 'new-org-password-3', 'organization')).status, 200);
  assert.equal((await login(email, ORG_PW, 'organization')).status, 401);
  assert.equal((await login(email, STUDENT_PW, 'student')).status, 200, 'student password unchanged');
  assert.equal((await call('/auth/me', { token: studentSession })).status, 200, 'student session not ended by the organization reset');
  assert.equal((await call('/auth/me', { token: o.body.token })).status, 401, 'the organization’s older session is ended');

  // And the other way round; a request without a type is for the student account (older apps).
  resetRateLimits();
  assert.equal((await call('/auth/password-reset/request', json('POST', { email }))).status, 202);
  const studentCode = mailCode(email, (subject) => !subject.includes('organization'));
  assert.ok(studentCode);
  const r2 = await call<AuthResponse>('/auth/password-reset/confirm', json('POST', { email, code: studentCode, password: 'new-student-password-4' }));
  assert.equal(r2.body.user.id, s.body.user.id);
  assert.equal((await login(email, 'new-org-password-3', 'organization')).status, 200, 'organization password unchanged');
});

test('cross-business isolation: students never reach organizations, organization accounts never reach student areas or student billing', async () => {
  const email = `iso-${RUN}@example.com`;
  const s = await registerStudent(email);
  const o = await registerOrg(email, ORG_PW, 'iso');
  const orgId = o.body.user.organizations[0].id;

  // The student with the admin's very email sees nothing of the organization.
  assert.equal((await call(`/orgs/${orgId}`, { token: s.body.token })).status, 404);
  assert.equal((await call(`/orgs/${orgId}/courses`, { token: s.body.token })).status, 404);
  assert.deepEqual((await call<OrganizationMembershipSummary[]>('/orgs', { token: s.body.token })).body, []);
  // The organization account never reaches the student's courses, exams, flashcards or student billing.
  for (const path of ['/documents', '/flashcards/due', '/exams/nope']) {
    const r = await call(path, { token: o.body.token });
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'student_account_required', path);
  }
  for (const path of ['/billing/purchase', '/billing/stripe/checkout', '/billing/cancel']) {
    assert.equal((await call(path, { ...json('POST', {}), token: o.body.token })).body.code, 'student_account_required', path);
  }
  // Reading status stays possible (the app's Account screen) and never shows the student's plan.
  assert.equal((await call<Entitlement>('/billing/status', { token: o.body.token })).status, 200);

  // Adding a member by email matches organization accounts only: a student-only email is "no such account".
  const studentOnly = `studentonly-${RUN}@example.com`;
  const so = await registerStudent(studentOnly);
  const add = await call(`/orgs/${orgId}/members`, { ...json('POST', { email: studentOnly, role: 'editor' }), token: o.body.token });
  assert.equal(add.status, 404);
  assert.equal(add.body.code, 'user_not_found');
  assert.deepEqual((await call<User>('/auth/me', { token: so.body.token })).body.organizations, []);
  // When the person also has an organization account, that account is the one added — never the student one.
  const colleague = await registerOrg(studentOnly, 'colleague-password-5');
  assert.deepEqual(colleague.body.user.organizations, []);
  const added = await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { ...json('POST', { email: studentOnly, role: 'editor' }), token: o.body.token });
  assert.equal(added.status, 201);
  assert.ok(added.body.some((m) => m.userId === colleague.body.user.id));
  assert.ok(!added.body.some((m) => m.userId === so.body.user.id));
  assert.equal((await call(`/orgs/${orgId}`, { token: so.body.token })).status, 404, 'the student account still has no access');
  assert.equal((await call(`/orgs/${orgId}`, { token: colleague.body.token })).status, 200);

  // A membership row pointing at a student account (left over from before the split) grants nothing.
  await sql`insert into organization_members (organization_id, user_id, role, added_by) values (${orgId}, ${s.body.user.id}, 'admin', ${o.body.user.id})`;
  assert.equal((await call(`/orgs/${orgId}`, { token: s.body.token })).status, 404);
  assert.deepEqual((await call<User>('/auth/me', { token: s.body.token })).body.organizations, []);
  const members = await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { token: o.body.token });
  assert.ok(!members.body.some((m) => m.userId === s.body.user.id), 'not listed as a member either');
});

test('deletion holds are per identity: deleting the student account never blocks the organization account, and the reverse', async () => {
  const email = `hold-${RUN}@example.com`;
  const s = await registerStudent(email);
  assert.equal((await call('/auth/me', { ...json('DELETE', { password: STUDENT_PW }), token: s.body.token })).status, 200);
  assert.equal((await registerStudent(email)).body.code, 'signup_email_unavailable');
  const o = await registerOrg(email, ORG_PW);
  assert.equal(o.status, 201, 'the organization sign-up is not held by the student deletion');
  assert.equal((await call('/auth/me', { ...json('DELETE', { password: ORG_PW }), token: o.body.token })).status, 200);
  assert.equal((await registerOrg(email)).body.code, 'signup_email_unavailable');
});

test('student owner (OWNER_EMAILS) is unchanged, and only ever the student account', async () => {
  const s = await registerStudent(STUDENT_OWNER_EMAIL);
  assert.equal((await call('/admin/access', { token: s.body.token })).status, 200);
  assert.equal((await call<Entitlement>('/billing/status', { token: s.body.token })).body.status, 'complimentary');
  assert.equal(await isOwner(s.body.user.id), true);
  // An organization account with the owner's email is NOT the student owner.
  const o = await registerOrg(STUDENT_OWNER_EMAIL, ORG_PW, 'ownermail');
  assert.equal(await isOwner(o.body.user.id), false);
  assert.equal((await call('/admin/access', { token: o.body.token })).status, 403);
  // …nor the B2B owner: the owner email in configuration grants nothing to an organization account.
  assert.equal((await call('/b2b-admin/overview', { token: o.body.token })).status, 404);
  assert.equal(o.body.user.b2bRole, undefined);
  // And the student owner has no B2B owner powers.
  assert.equal((await call('/b2b-admin/overview', { token: s.body.token })).status, 404);
});

test('B2B owner: provisioned only by the server command (idempotent, no password); dashboard owner-only; unlimited usage enforced server-side', async () => {
  const email = `b2b-owner-${RUN}@example.com`;
  // The owner also has a student account with the same email: it must stay exactly as it is.
  const student = await registerStudent(email);
  const cmd = (...args: string[]) => run('npx', ['tsx', '--env-file=.env', 'scripts/b2b-owner.ts', '--email', email, ...args], { cwd: new URL('..', import.meta.url).pathname });

  // A password is never accepted by the command.
  await assert.rejects(cmd('--password', 'x'));
  const first = await cmd();
  assert.match(first.stdout, /created/);
  assert.ok(!first.stdout.includes(email), 'the email is masked in the output');
  assert.match((await cmd()).stdout, /already the B2B owner/, 'idempotent');
  const [row] = (await sql`select id, b2b_role, email_verified_at, password_hash from users where email = ${email} and account_type = 'organization'`) as unknown as { id: string; b2b_role: string; email_verified_at: Date | null; password_hash: string }[];
  assert.equal(row.b2b_role, 'owner');
  assert.ok(row.password_hash.startsWith('$2'), 'only a bcrypt hash of a random secret is stored');
  const [studentRow] = (await sql`select b2b_role from users where id = ${student.body.user.id}`) as unknown as { b2b_role: string | null }[];
  assert.equal(studentRow.b2b_role, null, 'the student account with the same email is untouched');
  // The database refuses the role on a student account.
  await assert.rejects(sql`update users set b2b_role = 'owner' where id = ${student.body.user.id}`, /users_b2b_role_check/);

  // No usable password: the owner sets one with an emailed code through the organization sign-in. The student password
  // does not open the organization account; it only earns the hint that it belongs to the student account (no session).
  const withStudentPw = await login(email, STUDENT_PW, 'organization');
  assert.deepEqual([withStudentPw.status, withStudentPw.body.code, 'token' in withStudentPw.body], [403, 'wrong_account_type', false]);
  assert.equal((await login(email, 'any-other-password', 'organization')).status, 401);
  await call('/auth/password-reset/request', json('POST', { email, accountType: 'organization' }));
  const code = mailCode(email, (subject) => subject.includes('organization account'));
  assert.ok(code);
  const reset = await call<AuthResponse>('/auth/password-reset/confirm', json('POST', { email, code, password: 'owner-chosen-password-6', accountType: 'organization' }));
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.b2bRole, 'owner');
  const owner = (await login(email, 'owner-chosen-password-6', 'organization')).body;
  assert.equal(owner.user.id, row.id);
  // The student account is still the student account, with its own password, and no B2B role.
  const s2 = await login(email, STUDENT_PW, 'student');
  assert.equal(s2.body.user.id, student.body.user.id);
  assert.equal(s2.body.user.b2bRole ?? null, null);
  assert.equal((await call('/b2b-admin/overview', { token: s2.body.token })).status, 404);

  // Dashboard: the owner only. A regular organization admin gets 404 (as for an unknown route).
  const customer = await registerOrg(`customer-${RUN}@example.com`, ORG_PW, 'customer');
  const customerOrg = customer.body.user.organizations[0].id;
  for (const path of ['/b2b-admin/access', '/b2b-admin/overview', '/b2b-admin/organizations', '/b2b-admin/accounts', `/b2b-admin/organizations/${customerOrg}`]) {
    assert.equal((await call(path, { token: customer.body.token })).status, 404, path);
    assert.equal((await call(path)).status, 401, path);
  }
  // A token signed for the owner's account id but claiming the student identity is refused outright.
  assert.equal((await call('/b2b-admin/overview', { token: await signToken(owner.user.id, new Date(), 'student') })).status, 401);
  const ov = await call<B2BOverview>('/b2b-admin/overview', { token: owner.token });
  assert.equal(ov.status, 200);
  assert.ok(ov.body.organizations.total >= 1);
  const list = await call<B2BOrganizationRow[]>('/b2b-admin/organizations', { token: owner.token });
  const custOrgId = customer.body.user.organizations[0].id;
  assert.ok(list.body.some((o) => o.id === custOrgId));
  const accounts = await call<B2BAccountRow[]>('/b2b-admin/accounts', { token: owner.token });
  assert.ok(accounts.body.some((a) => a.id === row.id && a.b2bRole === 'owner'));
  assert.ok(!accounts.body.some((a) => a.id === student.body.user.id), 'student accounts are never listed');
  // Plan assignment and suspension, from the B2B dashboard only.
  assert.equal((await call(`/b2b-admin/organizations/${custOrgId}`, { ...json('PATCH', { plan: 'esencial', billingPeriod: 'monthly' }), token: customer.body.token })).status, 404);
  const patched = await call<B2BOrganizationDetail>(`/b2b-admin/organizations/${custOrgId}`, { ...json('PATCH', { plan: 'esencial', billingPeriod: 'monthly' }), token: owner.token });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.plan, 'esencial');
  assert.equal(patched.body.members.length, 1);
  const audit = (await sql`select count(*)::int as n from admin_audit_log where actor_user_id = ${row.id} and action like 'b2b %'`) as unknown as { n: number }[];
  assert.ok(audit[0].n >= 4, 'dashboard requests are audited');

  // Unlimited usage, enforced on the server: the owner's organization has an expired pilot and zero allowances.
  const created = await call<OrganizationMembershipSummary>('/orgs', { ...json('POST', { name: `Sep owner-org ${RUN}`, market: 'training_center' }), token: owner.token });
  assert.equal(created.status, 201);
  for (const i of [2, 3]) assert.equal((await call('/orgs', { ...json('POST', { name: `Sep owner-org-${i} ${RUN}`, market: 'training_center' }), token: owner.token })).status, 201, 'no organization cap for the owner');
  const orgId = created.body.id;
  await sql`update organizations set pilot_ends_at = now() - interval '1 day', limits = '{"coursesPerMonth":0,"itemsPerMonth":0,"maxMembers":1}'::jsonb where id = ${orgId}`;
  const up = await upload(owner.token, orgId);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 100; i++) {
    const d = await call<DocumentDetail>(`/orgs/${orgId}/courses/${up.body.id}`, { token: owner.token });
    if (d.body.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const gen = await call(`/orgs/${orgId}/courses/${up.body.id}/generate`, { ...json('POST', { count: 3 }), token: owner.token });
  assert.equal(gen.status, 201, JSON.stringify(gen.body));
  // The seat limit doesn't bind the owner either…
  const staff = await registerOrg(`owner-staff-${RUN}@example.com`, ORG_PW);
  assert.equal((await call(`/orgs/${orgId}/members`, { ...json('POST', { email: `owner-staff-${RUN}@example.com`, role: 'admin' }), token: owner.token })).status, 201);
  // …but everyone else in the same organization is bound by the plan: the privilege is the owner's, not the organization's.
  const staffUp = await upload(staff.body.token, orgId);
  assert.equal(staffUp.status, 402);
  assert.equal(staffUp.body.code, 'org_pilot_expired');
  const staffGen = await call(`/orgs/${orgId}/courses/${up.body.id}/generate`, { ...json('POST', { count: 3 }), token: staff.body.token });
  assert.equal(staffGen.status, 402);
  // Usage is still recorded for the dashboard.
  const detail = await call<B2BOrganizationDetail>(`/b2b-admin/organizations/${orgId}`, { token: owner.token });
  assert.ok(detail.body.activity.some((a) => a.kind === 'course_upload'));
  assert.ok(detail.body.usage.coursesThisMonth >= 1);

  // Revoking removes every privilege at once (read from the database on each request).
  assert.match((await cmd('--revoke')).stdout, /revoked/);
  assert.equal((await call('/b2b-admin/overview', { token: owner.token })).status, 404);
  assert.equal((await upload(owner.token, orgId)).body.code, 'org_pilot_expired');
});

test('B2B owner role cannot be obtained by signing up: the sign-up body never sets it', async () => {
  const email = `sneaky-${RUN}@example.com`;
  const r = await call<AuthResponse>('/auth/register', json('POST', { email, password: ORG_PW, name: 'S', accountType: 'organization', b2bRole: 'owner', role: 'owner' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.user.b2bRole, undefined);
  assert.equal((await call('/b2b-admin/overview', { token: r.body.token })).status, 404);
  const [row] = (await sql`select b2b_role from users where id = ${r.body.user.id}`) as unknown as { b2b_role: string | null }[];
  assert.equal(row.b2b_role, null, 'nothing stored either');
  // The confirmed-email sign-up path cannot carry it: pending sign-ups have no such column, and the account is created from that row.
  const cols = (await sql`select column_name from information_schema.columns where table_name = 'pending_signups'`) as unknown as { column_name: string }[];
  assert.ok(!cols.some((c) => c.column_name.includes('role')), 'pending_signups stores no role');
  // No API route writes the role: only scripts/b2b-owner.ts does.
  const { readFileSync, readdirSync } = await import('node:fs');
  const srcDir = new URL('../src/', import.meta.url);
  const files = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const code = (f: URL) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n'); // comments describe the role
  const writers = files(srcDir).filter((f) => /b2bRole\s*:\s*'owner'|b2b_role\s*=\s*'owner'/.test(code(f)) && !f.pathname.endsWith('/db/schema.ts'));
  assert.deepEqual(writers.map((f) => f.pathname.split('/src/')[1]), [], 'no server code sets the role');
});

test('B2B dashboard actions: plan, pilot extension, suspension and reactivation work and are audited; refused attempts are audited too', async () => {
  const owner = await registerOrg(`actions-owner-${RUN}@example.com`, ORG_PW);
  // The role as the provisioning command sets it (that command itself is covered above).
  await sql`update users set b2b_role = 'owner' where id = ${owner.body.user.id}`;
  const customer = await registerOrg(`actions-customer-${RUN}@example.com`, ORG_PW, 'actions');
  const orgId = customer.body.user.organizations[0].id;
  const t = owner.body.token;
  const patch = (body: unknown, token = t) => call<B2BOrganizationDetail>(`/b2b-admin/organizations/${orgId}`, { ...json('PATCH', body), token });

  const before = (await call<B2BOrganizationDetail>(`/b2b-admin/organizations/${orgId}`, { token: t })).body;
  assert.equal(before.plan, 'pilot');
  // Pilot extension: a new end date.
  const newEnd = new Date(Date.parse(before.pilotEndsAt!) + 14 * 86_400_000).toISOString();
  const extended = await patch({ pilotEndsAt: newEnd });
  assert.equal(extended.status, 200, JSON.stringify(extended.body));
  assert.equal(Date.parse(extended.body.pilotEndsAt!), Date.parse(newEnd));
  // Suspension: the organization becomes read-only for its members; reactivation restores it.
  assert.equal((await patch({ status: 'suspended' })).body.status, 'suspended');
  assert.equal((await call(`/orgs/${orgId}`, { ...json('PATCH', { name: 'Renamed' }), token: customer.body.token })).body.code, 'org_suspended');
  assert.equal((await call(`/orgs/${orgId}`, { token: customer.body.token })).status, 200, 'still readable');
  assert.equal((await patch({ status: 'active' })).body.status, 'active');
  assert.equal((await call(`/orgs/${orgId}`, { ...json('PATCH', { name: `Sep actions renamed ${RUN}` }), token: customer.body.token })).status, 200);
  // Plan assignment: the paid plan's allowances apply; the pilot end is cleared.
  const paid = await patch({ plan: 'profesional', billingPeriod: 'yearly' });
  assert.deepEqual([paid.body.plan, paid.body.billingPeriod, paid.body.pilotEndsAt], ['profesional', 'yearly', null]);
  assert.equal(paid.body.limits.coursesPerMonth, 100);
  // Invalid changes are refused without changing anything.
  assert.equal((await patch({ plan: 'pilot', billingPeriod: 'monthly' })).status, 400);
  assert.equal((await patch({ status: 'deleted' })).status, 400);

  // Every allowed change is audited with what it set; the customer's attempts are refused (404) and audited as refused.
  assert.equal((await patch({ status: 'suspended' }, customer.body.token)).status, 404);
  assert.equal((await call('/b2b-admin/overview', { token: customer.body.token })).status, 404);
  const rows = (await sql`select actor_user_id, action, params, allowed, status from admin_audit_log where actor_user_id in (${owner.body.user.id}, ${customer.body.user.id}) and action like 'b2b %' order by created_at`) as unknown as { actor_user_id: string; action: string; params: Record<string, string>; allowed: boolean; status: number }[];
  const changes = rows.filter((r) => r.actor_user_id === owner.body.user.id && r.action === 'b2b PATCH /b2b-admin/organizations/:id');
  assert.deepEqual(changes.map((r) => [r.status, JSON.parse(r.params.change ?? '{}')]), [
    [200, { pilotEndsAt: newEnd }],
    [200, { status: 'suspended' }],
    [200, { status: 'active' }],
    [200, { plan: 'profesional', billingPeriod: 'yearly' }],
    [400, { plan: 'pilot', billingPeriod: 'monthly' }],
    [400, {}],
  ], 'each change attempt, with what it set (an invalid body is refused before it is parsed, so it records no fields)');
  assert.ok(changes.every((r) => r.allowed && r.params.organizationId === orgId));
  const refused = rows.filter((r) => r.actor_user_id === customer.body.user.id);
  assert.deepEqual(refused.map((r) => [r.action, r.allowed, r.status]), [
    [`b2b PATCH /b2b-admin/organizations/${orgId}`, false, 404],
    ['b2b GET /b2b-admin/overview', false, 404],
  ]);
  assert.ok(!JSON.stringify(rows).match(/password|token|hash/i), 'the audit trail holds no secrets');
});
