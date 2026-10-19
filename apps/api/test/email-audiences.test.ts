/**
 * "Who can Exama email?" (services/email-audiences.ts): the counts per type of email, that unconfirmed addresses are
 * never part of the marketing audience (and confirmed is not "consent": the report says nothing is cleared), that the
 * account-email reminder follows its own rules, and that the report is read-only.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const RUN = Date.now();
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  EMAIL_PROVIDER: 'log',
  WEB_APP_URL: 'https://app.exama.test',
  API_PUBLIC_URL: 'https://api.exama.test',
});
delete process.env.REACTIVATION_CAMPAIGN_SEND;
delete process.env.VERIFICATION_REMINDER_SEND;
await import('./helpers/no-plan-limits.js');
const { sql } = await import('../src/db/client.js');
const { outbox } = await import('../src/lib/mailer.js');
const { emailAudiences } = await import('../src/services/email-audiences.js');
after(() => sql.end());

let n = 0;
async function user(o: { confirmed?: boolean; asked?: boolean; age?: string | null; ageHours: number; linkHoursAgo?: number; emailsOn?: boolean }): Promise<string> {
  const email = `aud-${RUN}-${n++}@example.com`;
  const [u] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, name, created_at, email_verified_at, email_verification_required, age_range, study_reminder_emails)
    values (${email}, 'x', 'Aud', now() - make_interval(hours => ${o.ageHours}), ${o.confirmed ? sql`now() - make_interval(hours => ${o.ageHours} - 1)` : null}, ${o.asked ?? true}, ${o.age === undefined ? '25_34' : o.age}, ${o.emailsOn ?? true})
    returning id`;
  if (o.linkHoursAgo !== undefined)
    await sql`insert into email_verification_tokens (user_id, token_hash, created_at, expires_at) values (${u!.id}, ${`aud-${RUN}-${n++}`}, now() - make_interval(hours => ${o.linkHoursAgo}), now() - make_interval(hours => ${o.linkHoursAgo}) + interval '24 hours')`;
  return u!.id;
}

test('counts per type of email, with the rules that decide them; nothing is cleared for marketing; nothing is sent', async () => {
  const legacyA = await user({ asked: false, age: null, ageHours: 96 });
  const legacyB = await user({ asked: false, age: null, ageHours: 96 });
  const askedOld = await user({ ageHours: 72, linkHoursAgo: 48 });
  const askedYoung = await user({ ageHours: 10, linkHoursAgo: 10 });
  const confirmedAdult = await user({ confirmed: true, ageHours: 24 * 30 });
  const confirmedMinor = await user({ confirmed: true, age: '13_17', ageHours: 24 * 30 });
  const optedOut = await user({ confirmed: true, ageHours: 24 * 30, emailsOn: false });
  const ids = [legacyA, legacyB, askedOld, askedYoung, confirmedAdult, confirmedMinor, optedOut];
  const before = { mails: outbox.length, sends: (await sql`select count(*)::int as n from email_campaign_sends where user_id = any(${ids}::uuid[])`)[0]!.n, tokens: (await sql`select count(*)::int as n from email_verification_tokens where user_id = any(${ids}::uuid[])`)[0]!.n };

  const r = await emailAudiences({ userIds: ids, mx: async () => 'ok' });

  assert.deepEqual(r.accounts, { total: 7, confirmed: 3, unconfirmed: 4, legacyUnconfirmed: 2 });
  assert.deepEqual(
    { now: r.accountReminder.now, within24h: r.accountReminder.within24h, withLegacyNow: r.accountReminder.withLegacyNow, withLegacyWithin24h: r.accountReminder.withLegacyWithin24h },
    { now: 1, within24h: 2, withLegacyNow: 3, withLegacyWithin24h: 4 },
    'the old account today; the 10-hour-old one tomorrow; the two legacy accounts only on request',
  );
  assert.deepEqual(r.accountReminder.heldNow, { legacy_not_asked: 2, too_new: 1 });
  assert.deepEqual(r.dailyStudyEmail, { confirmedWithEmailsOn: 2, ofWhichWithAPlan: 0 });

  const m = r.reactivationMarketing;
  assert.equal(m.passesTechnicalRules, 1, 'only the confirmed adult with the preference on passes the campaign’s technical rules');
  assert.equal(m.excluded.not_verified, 4, 'unconfirmed addresses are never marketing recipients, legacy or not');
  assert.equal(m.excluded.minor_or_unknown_age, 1);
  assert.equal(m.excluded.opted_out, 1);
  assert.equal(m.legallyCleared, false, 'passing the technical rules is not consent');

  assert.deepEqual({ mails: outbox.length, sends: (await sql`select count(*)::int as n from email_campaign_sends where user_id = any(${ids}::uuid[])`)[0]!.n, tokens: (await sql`select count(*)::int as n from email_verification_tokens where user_id = any(${ids}::uuid[])`)[0]!.n }, before, 'read-only');
  assert.equal((await sql`select count(*)::int as n from users where id = any(${ids}::uuid[]) and email_verified_at is not null`)[0]!.n, 3, 'nobody was confirmed by the report');
});

test('bounced and suppressed addresses drop out of the account-email count', async () => {
  const fine = await user({ ageHours: 72, linkHoursAgo: 48 });
  const suppressed = await user({ ageHours: 72, linkHoursAgo: 48 });
  const bounced = await user({ ageHours: 72, linkHoursAgo: 48 });
  const ids = [fine, suppressed, bounced];
  const emails = (await sql<{ id: string; email: string }[]>`select id, email from users where id = any(${ids}::uuid[])`).reduce<Record<string, string>>((o, r) => ({ ...o, [r.id]: r.email }), {});
  await sql`insert into email_suppressions (email, reason) values (${emails[suppressed]!}, 'manual') on conflict do nothing`;
  const history = { byAddress: new Map([[emails[bounced]!, { emails: 1, bad: 'bounced' as const }]]), emails: 1, complete: true };
  const r = await emailAudiences({ userIds: ids, history, mx: async () => 'ok' });
  assert.equal(r.accountReminder.now, 1);
  assert.deepEqual(r.accountReminder.heldNow, { suppressed: 1, delivery_failed_before: 1 });
});
