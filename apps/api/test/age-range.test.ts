/**
 * Minimum age 13 at sign-up: every age group 13+ is stored; "under_13" is refused before anything is
 * looked up, created, emailed or tracked (also for an email that already has an account); older app
 * versions that don't send an age group can't create accounts; "prefer not to say" and other values
 * are refused; the age group never leaves the server; existing accounts keep working.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { AGE_RANGES, MINIMUM_SIGNUP_AGE, SIGNUP_AGE_ANSWERS, type AuthResponse } from '@study/shared';

process.env.AI_PROVIDER = 'mock';
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { outbox } = await import('../src/lib/mailer.js');
const analytics = await import('../src/analytics/index.js');
const { resetVerificationRateLimits } = await import('../src/services/email-verification.js');
after(() => sql.end());
beforeEach(() => resetVerificationRateLimits());

const RUN = Date.now();
let n = 0;
const email = (tag: string) => `age-${tag}-${RUN}-${++n}@example.com`;
async function register(body: unknown) {
  const res = await app.request('/auth/register', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.6.0.${++n % 250}` } });
  const text = await res.text();
  return { status: res.status, text, body: (text ? JSON.parse(text) : null) as AuthResponse & { code?: string; error?: string } };
}
const stored = async (e: string) => ((await sql`select age_range from users where email = ${e}`) as unknown as { age_range: string | null }[])[0];
const traces = async (e: string) => {
  await analytics.flushAnalytics();
  await new Promise((r) => setTimeout(r, 150)); // let any background email land
  const [row] = (await sql`select (select count(*) from users where email = ${e})::int as users,
                     (select count(*) from user_onboarding o join users u on u.id = o.user_id where u.email = ${e})::int as onboarding,
                     (select count(*) from email_verification_tokens t join users u on u.id = t.user_id where u.email = ${e})::int as tokens`) as unknown as { users: number; onboarding: number; tokens: number }[];
  return { ...row, emails: outbox.filter((m) => m.to === e).length };
};
const NONE = { users: 0, onboarding: 0, tokens: 0, emails: 0 };

test('the rule: minimum age 13; the age groups that can be stored are all 13+', () => {
  assert.equal(MINIMUM_SIGNUP_AGE, 13);
  assert.deepEqual([...AGE_RANGES], ['13_17', '18_24', '25_34', '35_plus']);
  assert.deepEqual([...SIGNUP_AGE_ANSWERS], ['under_13', '13_17', '18_24', '25_34', '35_plus'], 'the question itself is neutral: every age can be answered');
});

test('13 and older: every age group is accepted and stored (with onboarding and a verification email as usual)', async () => {
  for (const ageRange of AGE_RANGES) {
    const e = email(ageRange);
    const r = await register({ email: e, password: 'password123', name: 'Ada', ageRange });
    assert.equal(r.status, 201, ageRange);
    assert.equal((await stored(e)).age_range, ageRange);
    const t = await traces(e);
    assert.deepEqual([t.users, t.onboarding, t.tokens, t.emails], [1, 1, 1, 1], ageRange);
  }
});

test('under 13 (e.g. age 12) is refused: 403, and no account, onboarding row, link, email or analytics', async () => {
  const e = email('twelve');
  const r = await register({ email: e, password: 'password123', name: 'Kid', ageRange: 'under_13' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'age_requirement_not_met');
  assert.match(r.body.error ?? '', /at least 13/);
  assert.ok(!r.text.includes(e) && !r.text.includes('Kid'), 'the answer echoes nothing back');
  assert.deepEqual(await traces(e), NONE);
  const events = (await sql`select count(*)::int as c from analytics_events where properties::text like ${'%' + e + '%'}`) as unknown as { c: number }[];
  assert.equal(events[0].c, 0);
});

test('the age rule comes first: same refusal whatever else is sent (taken email, weak password, older client fields)', async () => {
  const taken = email('taken');
  assert.equal((await register({ email: taken, password: 'password123', name: 'Adult', ageRange: '25_34' })).status, 201);
  const again = await register({ email: taken, password: 'password123', name: 'Kid', ageRange: 'under_13' });
  assert.equal(again.status, 403, 'does not reveal that the email has an account');
  assert.equal((await stored(taken)).age_range, '25_34', 'the existing account is untouched');
  assert.equal((await register({ email: email('weak'), password: 'x', name: 'Kid', ageRange: 'under_13' })).status, 403);
  assert.equal((await register({ email: 'not-an-email', ageRange: 'under_13' })).status, 403);
});

test('older app versions (no age group) and "prefer not to say" cannot create accounts', async () => {
  const old = email('old-client');
  const r = await register({ email: old, password: 'password123', name: 'Old App' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'age_range_required');
  assert.deepEqual(await traces(old), NONE);
  for (const ageRange of [null, '']) assert.equal((await register({ email: email('blank'), password: 'password123', name: 'X', ageRange })).body.code, 'age_range_required');
  const pnts = email('pnts');
  const p = await register({ email: pnts, password: 'password123', name: 'X', ageRange: 'prefer_not_to_say' });
  assert.equal(p.status, 400, '"prefer not to say" is not proof of the minimum age');
  assert.deepEqual(await traces(pnts), NONE);
});

test('invalid values are refused and leave nothing behind', async () => {
  for (const ageRange of ['12', 'Under 13', 'UNDER_13', 'under13', '18-24', 'adult', 18, 12, true, ['18_24'], { min: 13 }, '35_PLUS']) {
    const e = email('bad');
    const r = await register({ email: e, password: 'password123', name: 'Ada', ageRange });
    assert.equal(r.status, 400, JSON.stringify(ageRange));
    assert.deepEqual(await traces(e), NONE, JSON.stringify(ageRange));
  }
  for (const body of [null, [], 'text']) assert.equal((await register(body)).status, 400);
});

test('the age group never leaves the server: not in sign-up/sign-in/me answers, not in analytics', async () => {
  const e = email('private');
  const r = await register({ email: e, password: 'password123', name: 'Ada', ageRange: '13_17' });
  assert.deepEqual(Object.keys(r.body.user).sort(), ['email', 'id', 'name']);
  const me = await app.request('/auth/me', { headers: { Authorization: `Bearer ${r.body.token}` } });
  assert.ok(!(await me.text()).includes('13_17'));
  const login = await app.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: e, password: 'password123' }), headers: { 'Content-Type': 'application/json' } });
  assert.ok(!(await login.text()).includes('13_17'));
  await analytics.flushAnalytics();
  const events = (await sql`select properties::text as p from analytics_events where user_id = ${r.body.user.id}`) as unknown as { p: string }[];
  assert.ok(events.length > 0);
  assert.ok(events.every((ev) => !ev.p.includes('13_17') && !ev.p.includes('age')), 'no age in analytics');
});

test('existing accounts without an age group keep working: sign-in, onboarding, password reset; nothing is locked', async () => {
  const e = email('existing');
  const r = await register({ email: e, password: 'password123', name: 'Old', ageRange: '18_24' });
  await sql`update users set age_range = null, email_verification_required = false where email = ${e}`; // an account from before
  const login = await app.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: e, password: 'password123' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(login.status, 200);
  const ob = await app.request('/onboarding', { headers: { Authorization: `Bearer ${r.body.token}` } });
  assert.equal(((await ob.json()) as { status: string }).status, 'pending');
  const reset = await app.request('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: e }), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.6.9.9' } });
  assert.equal(reset.status, 202);
  const docs = await app.request('/documents', { headers: { Authorization: `Bearer ${r.body.token}` } });
  assert.equal(docs.status, 200);
  // The database refuses values below the minimum or outside the list, even if something bypassed the API.
  await assert.rejects(sql`update users set age_range = 'under_13' where email = ${e}`, /users_age_range_check/);
  await assert.rejects(sql`update users set age_range = 'prefer_not_to_say' where email = ${e}`, /users_age_range_check/);
});
