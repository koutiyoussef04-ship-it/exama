/**
 * Optional marketing-email consent (services/marketing-consent.ts, migration 0021): recorded only when the person ticks the
 * box with a known wording version; never inferred from sign-up, verification, sign-in or any other update; stamped by the
 * server; safe under retries and tampering; withdrawable everywhere; separate from the daily study-plan email; absent for
 * every account that existed before; enforced by the database; and applied on a fresh and on an existing database.
 * Nothing here sends a marketing email: the only mail in the outbox is the sign-up confirmation link the account already gets.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { AuthResponse, EmailPreferences } from '@study/shared';

const RUN = Date.now();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'log',
  WEB_APP_URL: 'https://app.exama.test',
  API_PUBLIC_URL: 'https://api.exama.test',
});
delete process.env.EMAIL_VERIFICATION_REQUIRED;
delete process.env.REACTIVATION_CAMPAIGN_SEND;
delete process.env.VERIFICATION_REMINDER_SEND;
await import('./helpers/no-plan-limits.js');
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { outbox } = await import('../src/lib/mailer.js');
const consent = await import('../src/services/marketing-consent.js');
const { unsubscribeToken } = await import('../src/services/study-reminders.js');
const { selectAudience } = await import('../src/services/reactivation-campaign.js');
const { resetVerificationRateLimits } = await import('../src/services/email-verification.js');
const { resetUnsubscribeRateLimit } = await import('../src/routes/email.js');
after(() => sql.end());

const PASSWORD = 'correct-horse-battery-staple';
const VERSION = '2026-10-v1';
let n = 0;
let ip = 0;

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.8.${RUN % 200}.${++ip % 250}`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as T & { code?: string } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const emailFor = (tag: string) => `consent-${tag}-${RUN}-${++n}@example.com`;
const register = (email: string, extra: Record<string, unknown> = {}) =>
  call<AuthResponse>('/auth/register', json('POST', { email, password: PASSWORD, name: 'Lina', ageRange: '18_24', language: 'es', ...extra }));
const tick = (language = 'es', version = VERSION) => ({ marketingConsent: { version, language } });

type Row = { at: string | null; version: string | null; language: string | null; source: string | null };
const row = async (id: string) =>
  (await sql<Row[]>`select marketing_consent_at::text as at, marketing_consent_version as version, marketing_consent_language as language, marketing_consent_source as source from users where id = ${id}`)[0]!;
const history = async (id: string) => (await sql<{ action: string; version: string | null; language: string | null; source: string }[]>`select action, version, language, source from marketing_consent_log where user_id = ${id} order by created_at, action`).map((r) => ({ ...r }));
const NONE: Row = { at: null, version: null, language: null, source: null };
const userExists = async (email: string) => (await sql`select 1 from users where email = ${email}`).length === 1;
const prefs = (token: string) => call<EmailPreferences>('/email/preferences', { token });
const patch = (token: string, body: unknown) => call<EmailPreferences>('/email/preferences', { ...json('PATCH', body), token });

async function signUp(over: Record<string, unknown> = {}) {
  const email = emailFor('u');
  const r = await register(email, over);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, id: r.body.user.id, token: r.body.token };
}

// ---------------------------------------------------------------- sign-up

test('sign-up with the box unticked records no consent: omitted, null or false', async () => {
  for (const extra of [{}, { marketingConsent: null }, { marketingConsent: false }]) {
    const u = await signUp(extra);
    assert.deepEqual(await row(u.id), NONE, JSON.stringify(extra));
    assert.deepEqual(await history(u.id), []);
    const p = await prefs(u.token);
    assert.equal(p.body.marketing, false);
  }
});

test('sign-up with the box ticked records the consent: server time, the wording version and language, source "signup", one history row', async () => {
  const [{ t0 }] = await sql<{ t0: string }[]>`select clock_timestamp()::text as t0`;
  const u = await signUp(tick('fr'));
  const [{ t1 }] = await sql<{ t1: string }[]>`select clock_timestamp()::text as t1`;
  const r = await row(u.id);
  assert.equal(r.version, VERSION);
  assert.equal(r.language, 'fr');
  assert.equal(r.source, 'signup');
  assert.ok(r.at && new Date(r.at) >= new Date(t0) && new Date(r.at) <= new Date(t1), 'stamped by the server, within the request');
  assert.deepEqual(await history(u.id), [{ action: 'granted', version: VERSION, language: 'fr', source: 'signup' }]);
  assert.equal((await prefs(u.token)).body.marketing, true);
});

test('the API cannot be made to record consent by omitting or changing a field: anything but an explicit, known version and language is refused and no account is created', async () => {
  const bad: [string, Record<string, unknown>][] = [
    ['unknown version', { marketingConsent: { version: '1999-01-v9', language: 'en' } }],
    ['missing version', { marketingConsent: { language: 'en' } }],
    ['missing language', { marketingConsent: { version: VERSION } }],
    ['unsupported language', { marketingConsent: { version: VERSION, language: 'de' } }],
    ['a bare true', { marketingConsent: true }],
    ['the string "true"', { marketingConsent: 'true' }],
    ['a number', { marketingConsent: 1 }],
    ['an empty object', { marketingConsent: {} }],
    ['a client-chosen timestamp', { marketingConsent: { version: VERSION, language: 'en', at: '2000-01-01T00:00:00Z' } }],
    ['a client-chosen source', { marketingConsent: { version: VERSION, language: 'en', source: 'account' } }],
  ];
  for (const [what, extra] of bad) {
    const email = emailFor('bad');
    const r = await register(email, extra);
    assert.equal(r.status, 400, what);
    assert.equal(await userExists(email), false, `${what}: nothing was created, so no half-recorded consent`);
  }
});

test('retrying sign-up cannot record, change or duplicate a consent', async () => {
  const email = emailFor('retry');
  const first = await register(email); // unticked
  assert.equal(first.status, 201);
  const again = await register(email, tick('en')); // retry, now ticked: the account exists
  assert.equal(again.status, 409);
  assert.deepEqual(await row(first.body.user.id), NONE, 'a retry cannot add a consent to an existing account');
  assert.deepEqual(await history(first.body.user.id), []);

  const second = await signUp(tick('es'));
  const email2 = (await sql<{ email: string }[]>`select email from users where id = ${second.id}`)[0]!.email;
  const before = await row(second.id);
  assert.equal((await register(email2, tick('en'))).status, 409);
  assert.equal((await register(email2)).status, 409);
  assert.deepEqual(await row(second.id), before, 'consent unchanged: same time, same language');
  assert.equal((await history(second.id)).length, 1, 'no duplicate history row');
});

// ---------------------------------------------------------------- nothing else creates or refreshes consent

test('confirming the email address is not consent: an account that never ticked the box has none after verifying', async () => {
  resetVerificationRateLimits();
  const u = await signUp();
  let link: string | undefined;
  for (let i = 0; i < 100 && !link; i++) {
    link = outbox.find((m) => m.to === u.email && /\/verify-email#token=/.test(m.text))?.text;
    if (!link) await new Promise((r) => setTimeout(r, 20));
  }
  const token = /#token=([A-Za-z0-9_-]+)/.exec(link!)![1]!;
  assert.equal((await call('/auth/email-verification/verify', json('POST', { token }))).status, 200);
  assert.ok((await sql`select email_verified_at from users where id = ${u.id}`)[0]!.email_verified_at, 'the address is confirmed');
  assert.deepEqual(await row(u.id), NONE);
  assert.deepEqual(await history(u.id), []);
  assert.equal(await consent.hasMarketingConsent(u.id), false);
});

test('sign-in, study-reminder changes and a failed or empty preference update never grant, refresh or withdraw consent', async () => {
  const consented = await signUp(tick('en'));
  const never = await signUp();
  const before = await row(consented.id);

  for (const u of [consented, never]) {
    const login = await call<AuthResponse>('/auth/login', json('POST', { email: (await sql<{ email: string }[]>`select email from users where id = ${u.id}`)[0]!.email, password: PASSWORD }));
    assert.equal(login.status, 200);
    assert.equal((await patch(u.token, { studyReminders: false })).status, 200);
    assert.equal((await patch(u.token, { studyReminders: true })).status, 200);
    assert.equal((await patch(u.token, {})).status, 400, 'an empty update is refused, not treated as a choice');
    assert.equal((await patch(u.token, { marketing: true })).status, 400);
    assert.equal((await patch(u.token, { marketing: { consent: true } })).status, 400, 'granting needs the version and language shown');
    assert.equal((await patch(u.token, { marketing: { consent: true, version: 'old', language: 'en' } })).status, 400);
    assert.equal((await patch(u.token, { studyReminders: true, extra: 1 })).status, 400);
  }
  assert.deepEqual(await row(consented.id), before, 'the consent is exactly as it was');
  assert.deepEqual(await row(never.id), NONE, 'and none appeared');
  assert.equal((await history(consented.id)).length, 1);
  assert.equal((await history(never.id)).length, 0);
});

// ---------------------------------------------------------------- withdrawal and explicit (re)consent

test('withdrawing in Account clears the consent, keeps the history, is idempotent, and re-consenting needs an explicit new yes', async () => {
  const u = await signUp(tick('en'));
  const w = await patch(u.token, { marketing: { consent: false } });
  assert.equal(w.status, 200);
  assert.equal(w.body.marketing, false);
  assert.deepEqual(await row(u.id), NONE);
  assert.equal((await patch(u.token, { marketing: { consent: false } })).status, 200);
  assert.deepEqual(await history(u.id), [
    { action: 'granted', version: VERSION, language: 'en', source: 'signup' },
    { action: 'withdrawn', version: VERSION, language: 'en', source: 'account' },
  ]);
  // Nothing re-enables it by itself.
  await call('/auth/login', json('POST', { email: (await sql<{ email: string }[]>`select email from users where id = ${u.id}`)[0]!.email, password: PASSWORD }));
  assert.equal((await patch(u.token, { studyReminders: true })).body.marketing, false);
  // An explicit new yes in Account: a new consent with source "account".
  const g = await patch(u.token, { marketing: { consent: true, version: VERSION, language: 'ar' } });
  assert.equal(g.body.marketing, true);
  const r = await row(u.id);
  assert.deepEqual({ version: r.version, language: r.language, source: r.source }, { version: VERSION, language: 'ar', source: 'account' });
  // A second yes while consented changes nothing: same timestamp, no duplicate.
  const at = r.at;
  assert.equal((await patch(u.token, { marketing: { consent: true, version: VERSION, language: 'fr' } })).status, 200);
  assert.deepEqual(await row(u.id), r);
  assert.equal((await history(u.id)).length, 3);
  assert.equal(at, (await row(u.id)).at);
});

test('the unsubscribe link stops exactly the category it names: marketing, study reminders, or both; links without a category keep their old meaning', async () => {
  resetUnsubscribeRateLimit();
  const make = async () => {
    const u = await signUp(tick('en'));
    return { ...u, token: unsubscribeToken(u.id) };
  };
  const study = async (id: string) => (await sql<{ on: boolean }[]>`select study_reminder_emails as on from users where id = ${id}`)[0]!.on;
  const post = (token: string, query = '') => call(`/email/unsubscribe?token=${encodeURIComponent(token)}${query}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const a = await make(); // marketing link: consent withdrawn, the daily plan email untouched
  assert.equal((await post(a.token, '&category=marketing')).status, 200);
  assert.deepEqual({ consent: (await row(a.id)).at, study: await study(a.id) }, { consent: null, study: true });
  assert.deepEqual((await history(a.id)).map((h) => `${h.action}/${h.source}`), ['granted/signup', 'withdrawn/unsubscribe_link']);
  assert.equal((await post(a.token, '&category=marketing')).status, 200);
  assert.equal((await history(a.id)).length, 2, 'clicking again is harmless');

  const b = await make(); // no category (every daily study-plan email already sent): study reminders only
  assert.equal((await post(b.token)).status, 200);
  assert.deepEqual({ consented: !!(await row(b.id)).at, study: await study(b.id) }, { consented: true, study: false });

  const c = await make(); // both
  assert.equal((await post(c.token, '&category=all')).status, 200);
  assert.deepEqual({ consented: !!(await row(c.id)).at, study: await study(c.id) }, { consented: false, study: false });

  const d = await make();
  assert.equal((await post(d.token, '&category=everything')).status, 400, 'an unknown category is not guessed at');
  assert.equal((await post('not-a-token', '&category=marketing')).status, 400);
  assert.equal((await post(`${d.id}.${'x'.repeat(32)}`, '&category=marketing')).status, 400, 'a forged signature is refused');
  assert.deepEqual({ consented: !!(await row(d.id)).at, study: await study(d.id) }, { consented: true, study: true });

  // The web page link keeps the category.
  const page = await call(`/email/unsubscribe?token=${encodeURIComponent(d.token)}&category=marketing`);
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `https://app.exama.test/unsubscribe#token=${d.token}&category=marketing`);
  assert.doesNotMatch((await call(`/email/unsubscribe?token=${encodeURIComponent(d.token)}`)).headers.get('location')!, /category/);

  const links = consent.marketingUnsubscribeLinks(d.id);
  assert.match(links.pageUrl, /#token=.+&category=marketing$/);
  assert.match(links.oneClickUrl!, /\/email\/unsubscribe\?token=.+&category=marketing$/);
});

test('account (transactional) emails follow neither setting: with marketing withdrawn and study reminders off, a password-reset code is still sent', async () => {
  const u = await signUp(tick('en'));
  const unsub = (category: string) => call(`/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(u.id))}&category=${category}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  resetUnsubscribeRateLimit();
  assert.equal((await unsub('all')).status, 200); // marketing withdrawn AND study reminders off
  const state = (await sql<{ on: boolean; at: string | null }[]>`select study_reminder_emails as on, marketing_consent_at::text as at from users where id = ${u.id}`)[0]!;
  assert.deepEqual({ ...state }, { on: false, at: null });

  const before = outbox.length;
  const reset = await call('/auth/password-reset/request', json('POST', { email: u.email, language: 'en' }));
  assert.equal(reset.status, 202);
  const sent = outbox.slice(before).filter((m) => m.to === u.email && /password reset code/i.test(m.subject)); // (the sign-up confirmation link may land in the same window)
  assert.equal(sent.length, 1, 'the reset code is an account email: no preference or consent gates it');
  assert.equal(sent[0]!.headers?.['List-Unsubscribe'], undefined, 'and it carries no marketing unsubscribe: there is nothing to unsubscribe from');
});

// ---------------------------------------------------------------- existing accounts and the campaign

test('accounts that existed before consent was asked have none, can opt in only explicitly, and stay out of the campaign until they do', async () => {
  // An account as it was before this migration: none of the consent columns set.
  const email = emailFor('old');
  const [old] = await sql<{ id: string }[]>`insert into users (email, password_hash, name, created_at, email_verified_at, age_range) values (${email}, 'x', 'Old', now() - interval '60 days', now() - interval '59 days', '25_34') returning id`;
  const id = old!.id;
  assert.deepEqual(await row(id), NONE);
  assert.equal((await selectAudience({ step: 1, userIds: [id], anyTime: true })).excluded.no_marketing_consent, 1, 'confirmed, adult, inactive — and still out: confirming is not consent');

  // Opting in later, explicitly (Account switch), is what makes them eligible.
  const login = await call<AuthResponse>('/auth/password-reset/request', json('POST', { email })); // an unrelated, ordinary account action
  assert.equal(login.status, 202);
  assert.deepEqual(await row(id), NONE, 'ordinary account actions do not touch consent');
  await consent.grantMarketingConsent(id, { version: VERSION, language: 'en' }, 'account');
  const a = await selectAudience({ step: 1, userIds: [id], anyTime: true });
  assert.equal(a.eligible.length, 1);
  await consent.withdrawMarketingConsent(id, 'account');
  assert.equal((await selectAudience({ step: 1, userIds: [id], anyTime: true })).eligible.length, 0, 'withdrawn: out of every future audience');
});

test('an unconfirmed account stays out of marketing even when it ticked the box; confirming alone does not let an unticked one in', async () => {
  const ticked = await signUp(tick('en'));
  const unticked = await signUp();
  await sql`update users set created_at = now() - interval '30 days' where id in (${ticked.id}, ${unticked.id})`;
  const before = await selectAudience({ step: 1, userIds: [ticked.id, unticked.id], anyTime: true });
  assert.equal(before.eligible.length, 0);
  assert.equal(before.excluded.not_verified, 2);
  await sql`update users set email_verified_at = now() where id in (${ticked.id}, ${unticked.id})`;
  const after = await selectAudience({ step: 1, userIds: [ticked.id, unticked.id], anyTime: true });
  assert.deepEqual(after.eligible.map((c) => c.userId), [ticked.id]);
  assert.equal(after.excluded.no_marketing_consent, 1);
});

// ---------------------------------------------------------------- the database enforces it

test('the database refuses half-written or invented consent, and invalid history rows', async () => {
  const u = await signUp();
  const fails = async (what: string, run: () => Promise<unknown>) => {
    await assert.rejects(run(), (e: { code?: string }) => e.code === '23514', what);
  };
  await fails('a timestamp alone', () => sql`update users set marketing_consent_at = now() where id = ${u.id}`);
  await fails('a version alone', () => sql`update users set marketing_consent_version = 'x' where id = ${u.id}`);
  await fails('an unsupported language', () => sql`update users set marketing_consent_at = now(), marketing_consent_version = ${VERSION}, marketing_consent_language = 'de', marketing_consent_source = 'signup' where id = ${u.id}`);
  await fails('an unknown source', () => sql`update users set marketing_consent_at = now(), marketing_consent_version = ${VERSION}, marketing_consent_language = 'en', marketing_consent_source = 'import' where id = ${u.id}`);
  await fails('a bad history action', () => sql`insert into marketing_consent_log (user_id, action, source) values (${u.id}, 'maybe', 'signup')`);
  await fails('a bad history source', () => sql`insert into marketing_consent_log (user_id, action, source) values (${u.id}, 'granted', 'script')`);
  assert.deepEqual(await row(u.id), NONE);
  await sql`update users set marketing_consent_at = now(), marketing_consent_version = ${VERSION}, marketing_consent_language = 'en', marketing_consent_source = 'signup' where id = ${u.id}`; // a complete one is fine
});

test('deleting the account deletes its consent history', async () => {
  const u = await signUp(tick('en'));
  await patch(u.token, { marketing: { consent: false } });
  assert.equal((await history(u.id)).length, 2);
  const del = await call('/auth/me', { ...json('DELETE', { password: PASSWORD }), token: u.token });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await history(u.id)).length, 0);
});

test('preferences describe the two categories separately and report whether email can be sent at all', async () => {
  const u = await signUp(tick('en'));
  const p = (await prefs(u.token)).body;
  assert.equal(p.marketing, true);
  assert.equal(typeof p.studyReminders, 'boolean');
  assert.equal(p.marketingAvailable, config.EMAIL_PROVIDER !== 'disabled');
  await patch(u.token, { studyReminders: false });
  const q = (await prefs(u.token)).body;
  assert.deepEqual({ study: q.studyReminders, marketing: q.marketing }, { study: false, marketing: true }, 'switching the daily plan email off does not touch marketing consent');
  await patch(u.token, { marketing: { consent: false } });
  assert.deepEqual({ study: (await prefs(u.token)).body.studyReminders, marketing: (await prefs(u.token)).body.marketing }, { study: false, marketing: false });
});

test('consent changes never send an email', async () => {
  const u = await signUp(tick('en'));
  for (let i = 0; i < 100 && !outbox.some((m) => m.to === (m.to === u.email ? u.email : '')); i++) await new Promise((r) => setTimeout(r, 20));
  const sent = outbox.length;
  await patch(u.token, { marketing: { consent: false } });
  await patch(u.token, { marketing: { consent: true, version: VERSION, language: 'en' } });
  await consent.withdrawMarketingConsent(u.id, 'account');
  await consent.unsubscribeByCategory(unsubscribeToken(u.id), 'all');
  assert.equal(outbox.length, sent);
  assert.equal(process.env.REACTIVATION_CAMPAIGN_SEND, undefined);
  assert.equal(process.env.VERIFICATION_REMINDER_SEND, undefined);
});

// ---------------------------------------------------------------- migration 0021: fresh database and existing database

const postgresModule = await import('postgres');
const { drizzle } = await import('drizzle-orm/postgres-js');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const DRIZZLE = new URL('../drizzle/', import.meta.url).pathname;

async function withTempDatabase(run: (connect: () => ReturnType<typeof postgresModule.default>) => Promise<void>) {
  const name = `migtest_${RUN}_${++n}`;
  const adminUrl = new URL(config.DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgresModule.default(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(config.DATABASE_URL);
  url.pathname = `/${name}`;
  const clients: ReturnType<typeof postgresModule.default>[] = [];
  try {
    await run(() => {
      const c = postgresModule.default(url.toString(), { max: 1, onnotice: () => {} });
      clients.push(c);
      return c;
    });
  } finally {
    await Promise.all(clients.map((c) => c.end()));
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

const consentColumns = ['marketing_consent_at', 'marketing_consent_language', 'marketing_consent_source', 'marketing_consent_version'];
async function assertSchema(db: ReturnType<typeof postgresModule.default>) {
  const cols = (await db<{ column_name: string; is_nullable: string; column_default: string | null }[]>`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'users' and column_name like 'marketing_consent_%' order by column_name`).map((c) => ({ ...c }));
  assert.deepEqual(cols.map((c) => c.column_name), consentColumns);
  assert.ok(cols.every((c) => c.is_nullable === 'YES' && c.column_default === null), 'nullable, no default: nobody gets a consent from the migration');
  assert.equal((await db`select 1 from pg_constraint where conname = 'users_marketing_consent_check'`).length, 1);
  assert.equal((await db`select count(*)::int as n from marketing_consent_log`)[0]!.n, 0, 'the log starts empty');
}

test('migration 0021 on a FRESH database: all migrations apply in order and consent starts absent', async () => {
  const journal = JSON.parse(await readFile(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  // 0021 is in the journal, after 0020 (later migrations, e.g. 0022_organizations, may follow it).
  assert.ok(journal.entries.findIndex((e) => e.tag === '0021_marketing_consent') === journal.entries.findIndex((e) => e.tag === '0020_reactivation_campaign') + 1);
  await withTempDatabase(async (connect) => {
    const db = connect();
    await migrate(drizzle(db), { migrationsFolder: DRIZZLE });
    assert.equal((await db`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n, journal.entries.length);
    await assertSchema(db);
    const [u] = await db<{ id: string }[]>`insert into users (email, password_hash, name) values ('fresh@example.test', 'x', 'F') returning id`;
    assert.deepEqual({ ...(await db`select marketing_consent_at, marketing_consent_version, marketing_consent_language, marketing_consent_source from users where id = ${u!.id}`)[0] }, { marketing_consent_at: null, marketing_consent_version: null, marketing_consent_language: null, marketing_consent_source: null });
  });
});

test('migration 0021 on an EXISTING database: accounts keep every value, get no consent, and the previous schema keeps working', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'exama-migrations-'));
  try {
    // The migrations as they were before 0021: everything up to 0020 (0021 and anything after it removed).
    await cp(DRIZZLE, folder, { recursive: true });
    const journalPath = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string; idx: number }[] };
    const first = journal.entries.find((e) => e.tag === '0021_marketing_consent')!;
    for (const e of journal.entries.filter((e) => e.idx >= first.idx)) {
      await rm(join(folder, `${e.tag}.sql`));
      await rm(join(folder, `meta/${e.tag.slice(0, 4)}_snapshot.json`));
    }
    journal.entries = journal.entries.filter((e) => e.idx < first.idx);
    await writeFile(journalPath, JSON.stringify(journal));

    await withTempDatabase(async (connect) => {
      const db = connect();
      await migrate(drizzle(db), { migrationsFolder: folder });
      assert.equal((await db`select count(*)::int as n from information_schema.columns where table_name = 'users' and column_name like 'marketing_consent_%'`)[0]!.n, 0, 'the "before" database has no consent columns');
      await db`insert into users (email, password_hash, name, created_at, email_verified_at, email_verification_required, age_range, study_reminder_emails)
        values ('a@example.test', 'hash-a', 'Ana', '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z', true, '25_34', true),
               ('b@example.test', 'hash-b', 'Bea', '2026-10-05T10:00:00Z', null, false, null, false),
               ('c@example.test', 'hash-c', 'Cy',  '2026-10-09T10:00:00Z', null, true, '13_17', true)`;
      const before = (await db`select id, email, name, created_at::text as created, email_verified_at::text as verified, age_range, study_reminder_emails from users order by email`).map((r) => ({ ...r }));

      await migrate(drizzle(db), { migrationsFolder: DRIZZLE }); // the upgrade
      await assertSchema(db);
      const after = (await db`select id, email, name, created_at::text as created, email_verified_at::text as verified, age_range, study_reminder_emails from users order by email`).map((r) => ({ ...r }));
      assert.deepEqual(after, before, 'every existing value is untouched');
      assert.equal((await db`select count(*)::int as n from users where marketing_consent_at is not null or marketing_consent_version is not null or marketing_consent_language is not null or marketing_consent_source is not null`)[0]!.n, 0, 'no existing account was given a consent');
      // The old shape of the table still accepts an insert that knows nothing about consent.
      await db`insert into users (email, password_hash, name) values ('d@example.test', 'x', 'D')`;
      // Running the migrations again is a no-op.
      await migrate(drizzle(db), { migrationsFolder: DRIZZLE });
      assert.equal((await db`select count(*)::int as n from users`)[0]!.n, 4);
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
