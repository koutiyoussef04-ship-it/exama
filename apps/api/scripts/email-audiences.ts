/**
 * Who can Exama email, by type of email? Read-only: it sends nothing, stores nothing and changes nothing
 * (services/email-audiences.ts). Run it before deciding anything about reaching users.
 *
 *   npm run email:audiences
 *
 * On Render (the production database only accepts connections from inside Render): open the exama-api Shell and run
 * `npm run email:audiences:prod -w @study/api`.
 */
import { config } from '../src/config.js';
import { sql } from '../src/db/client.js';
import { emailAudiences } from '../src/services/email-audiences.js';
import { readDeliveryHistory } from '../src/services/verification-reminders.js';

const list = (o: Record<string, number | undefined>) => {
  const rows = Object.entries(o).filter(([, n]) => n).sort((a, b) => b[1]! - a[1]!);
  return rows.length ? rows.map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join('\n      ') : '(none)';
};

try {
  const { history, problem } = await readDeliveryHistory();
  const r = await emailAudiences({ history });
  const a = r.accounts;
  const rem = r.accountReminder;
  console.log(`\nWho can Exama email? — read-only report, nothing is sent (${r.now.toISOString()})\n`);
  console.log(`Accounts: ${a.total} · address confirmed ${a.confirmed} · not confirmed ${a.unconfirmed} (of which never asked, they predate verification: ${a.legacyUnconfirmed})`);
  console.log(history ? `Resend delivery log read: ${history.emails} emails, earlier bounces and complaints are excluded below.` : problem ? `! ${problem}. Counts below do NOT exclude earlier bounces, and a send would refuse.` : `Resend delivery log: not available with EMAIL_PROVIDER=${config.EMAIL_PROVIDER ?? 'unset'}.`);

  console.log(`\n1. ACCOUNT EMAIL — one reminder to confirm the address (not marketing; the privacy policy discloses the confirmation email)`);
  console.log(`   Can be sent now: ${rem.now}     in 24 h (if still unconfirmed): ${rem.within24h}`);
  console.log(`   If the operator also includes accounts that predate verification (--include-legacy): now ${rem.withLegacyNow} · in 24 h ${rem.withLegacyWithin24h}`);
  console.log(`   Held out now:\n      ${list(rem.heldNow)}`);
  console.log(`   Rules: unconfirmed · asked at sign-up (legacy only on request) · not suppressed · no bounce or complaint on record · address looks deliverable`);
  console.log(`          (valid, not a role address, not disposable, domain can receive mail) · account 24 h–30 days old · no link sent in the last 24 h · never reminded · one per account, ever.`);

  console.log(`\n2. DAILY STUDY-PLAN EMAIL — already sent by the server, confirmed addresses only`);
  console.log(`   Confirmed with the preference on: ${r.dailyStudyEmail.confirmedWithEmailsOn}, of which with a study plan: ${r.dailyStudyEmail.ofWhichWithAPlan} (it also needs a Free plan and the local send hour). Unconfirmed accounts never get it.`);

  const m = r.reactivationMarketing;
  console.log(`\n3. REACTIVATION MARKETING — the "come back" campaign`);
  console.log(`   Passes the campaign's technical rules: ${m.passesTechnicalRules}`);
  console.log(`   Cleared by the legal register to receive marketing: NONE. Marketing needs consent (docs/legal/open-items.md §3: "none today"); no consent is recorded and the policy does not disclose marketing.`);
  console.log(`   Excluded by the technical rules:\n      ${list(m.excluded)}`);
  console.log(`   Accounts that predate verification have no age group, so they can never pass the campaign's adult-only rule.`);

  console.log(`\n4. ON REQUEST — password reset code and "send me a new confirmation link": any address, only when its owner asks (already works for unconfirmed accounts).\n`);
} finally {
  await sql.end();
}
