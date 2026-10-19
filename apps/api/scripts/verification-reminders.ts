/**
 * One reminder to confirm the email address (services/verification-reminders.ts). Dry run by default: nothing is sent,
 * and nobody is ever marked as confirmed by this tool (only the student opening the link does that).
 *
 *   npm run campaign:verification-reminder -- dry-run [--limit 5] [--max-age-days 30] [--include-legacy] [--any-time] [--list]
 *   npm run campaign:verification-reminder -- preview [--out ./reminder-previews]      write the email in every language
 *   VERIFICATION_REMINDER_SEND=true npm run campaign:verification-reminder -- send --limit 5 --approval <code from the dry run>
 *   npm run campaign:verification-reminder -- sync                                     read delivery status back from Resend; bounces and complaints are suppressed
 *   npm run campaign:verification-reminder -- report
 *   npm run campaign:verification-reminder -- check-resend                             why can't the delivery log be read? (two GETs, sends nothing)
 *   npm run campaign:verification-reminder -- inspect-legacy [--list]                  accounts never asked to confirm: when made, ever active, address looks real? (read-only)
 *
 * On Render (the production database only accepts connections from inside Render): open the exama-api Shell and
 * run the same commands with `npm run campaign:verification-reminder:prod -w @study/api -- …`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGUAGES } from '@study/shared';
import { config } from '../src/config.js';
import { sql } from '../src/db/client.js';
import { verificationReminderEmail } from '../src/services/email-verification.js';
import { maskEmail } from '../src/services/reactivation-campaign.js';
import {
  DEFAULT_MAX_ACCOUNT_AGE_DAYS,
  DEFAULT_MAX_PER_DAY,
  REMINDER_CAMPAIGN,
  RESEND_DAILY_LIMIT,
  diagnoseResend,
  explainDiagnosis,
  readDeliveryHistory,
  inspectLegacy,
  nextReminderBatch,
  reminderApprovalCode,
  reminderPreflight,
  reminderReport,
  selectReminderAudience,
  sendReminderBatch,
  syncReminders,
  type DeliveryHistory,
  type ReminderAudience,
  type ReminderExclude,
} from '../src/services/verification-reminders.js';

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'dry-run';
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const int = (name: string, fallback: number, min = 0) => {
  const raw = value(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer ≥ ${min}`);
  return n;
};
function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const REASON: Record<ReminderExclude, string> = {
  suppressed: 'on the suppression list (bounce, complaint or manual)',
  delivery_failed_before: 'an earlier Exama email to this address bounced or was reported (Resend log)',
  already_reminded: 'already got the reminder (one per account, ever)',
  legacy_not_asked: 'account predates email verification, never asked (--include-legacy to include)',
  too_old: 'account older than --max-age-days',
  too_new: 'account younger than 24 h (the sign-up link is still valid)',
  link_still_valid: 'a verification link was sent in the last 24 h',
  invalid_address: 'address is not a valid email address',
  role_address: 'role address (info@, test@, noreply@…): not a person’s inbox',
  disposable_domain: 'disposable-mail domain',
  no_mail_server: 'the domain cannot receive mail (no MX or address record)',
  dns_inconclusive: 'DNS did not answer clearly: held back, run again later',
};

function printAudience(a: ReminderAudience, includeLegacy: boolean, history: DeliveryHistory | null, historyProblem: string | null) {
  const count = (pred: (c: ReminderAudience['eligible'][number]) => boolean) => a.eligible.filter(pred).length;
  const due = count((c) => c.dueNow);
  console.log(`\nVerification reminder "${REMINDER_CAMPAIGN}" — DRY RUN (nothing is sent; nobody is marked confirmed)`);
  console.log(`Run at ${a.now.toISOString()}\n`);
  console.log(`Accounts in the database      ${a.usersTotal}   (address confirmed: ${a.usersTotal - a.unverified} · not confirmed: ${a.unverified})`);
  console.log(`Would get the reminder        ${a.eligible.length}   (inside the send window now: ${due}, waiting for daytime in their time zone: ${a.eligible.length - due})`);
  console.log(`  sign-up link expired unused ${count((c) => c.link === 'expired')}`);
  console.log(`  no link on record           ${count((c) => c.link === 'none')}   (sign-up email never went out or failed)`);
  console.log(`  predate verification        ${count((c) => !c.asked)}${includeLegacy ? '   (included by --include-legacy)' : ''}`);
  console.log(`  Languages                   ${LANGUAGES.map((l) => `${l} ${count((c) => c.language === l)}`).join(' · ')}`);
  const ex = Object.entries(a.excluded).sort((x, y) => y[1]! - x[1]!);
  console.log(`\nNot eligible (first matching rule): ${ex.reduce((n, [, k]) => n + k!, 0)}`);
  for (const [reason, n] of ex) console.log(`  ${String(n).padStart(5)}  ${REASON[reason as ReminderExclude]}  [${reason}]`);
  if (history) {
    const bad = [...history.byAddress.values()].filter((v) => v.bad).length;
    console.log(`\nResend delivery log: ${history.emails} emails to ${history.byAddress.size} addresses; ${bad} address${bad === 1 ? '' : 'es'} with a bounce, complaint or suppression${history.complete ? '' : ' (log incomplete)'}`);
  }
  if (historyProblem) console.log(`\n  ! ${historyProblem}. A send needs this check, so it would refuse.`);
  const t = a.afterConfirming;
  console.log(`\nNot part of this send — what confirming would change for the ${a.unverified} unconfirmed account${a.unverified === 1 ? '' : 's'}:`);
  console.log(`  The reactivation campaign only ever emails confirmed adults (18+): ${t.adult} adult · ${t.minor} under 18 (never) · ${t.noAge} no age group (never).`);
  console.log(`  ${t.withPlan} already have a study plan; confirming also lets the existing daily study-plan email reach them (free accounts only, one-click unsubscribe).`);
  console.log(`  Confirmation is not marketing consent: the campaign’s legal conditions (docs/email/reactivation-campaign.md) still apply after it.`);
  if (flag('list')) {
    console.log('\nWould get the reminder (addresses masked):');
    for (const c of a.eligible) console.log(`  ${maskEmail(c.email).padEnd(28)} ${c.language} ${c.link === 'none' ? 'no link on record' : 'link expired'}${c.asked ? '' : ' · predates verification'}${c.dueNow ? '' : ' · (later)'}`);
  }
}

async function dryRun() {
  const maxPerDay = int('max-per-day', DEFAULT_MAX_PER_DAY, 1);
  const limit = int('limit', 5, 1);
  const includeLegacy = flag('include-legacy');
  const { history, problem } = await readDeliveryHistory();
  const audience = await selectReminderAudience({ maxAgeDays: int('max-age-days', DEFAULT_MAX_ACCOUNT_AGE_DAYS, 1), includeLegacy, anyTime: flag('any-time'), history });
  printAudience(audience, includeLegacy, history, problem);
  const batch = nextReminderBatch(audience, Math.min(limit, maxPerDay));
  const pf = reminderPreflight();
  const sample = verificationReminderEmail('x@example.com', 'TOKEN', 'en');
  console.log(`\nWhat each person would get`);
  console.log(`  From: ${config.EMAIL_FROM ?? '(EMAIL_FROM not set)'}`);
  console.log(`  Subject: ${LANGUAGES.map((l) => `[${l}] ${verificationReminderEmail('x@example.com', 'TOKEN', l).subject}`).join('  ')}`);
  console.log(`  Body: one sentence, one button, the link (${sample.text.split('\n')[2]!.replace('TOKEN', '<new single-use token>')}) and its 24-hour expiry. Nothing else: no study plan, no offer, no unsubscribe (it is an account message, sent once).`);
  console.log(`  Link: a NEW token each (older unused links expire at once); the 60 s cooldown and hourly limit of the normal resend apply.`);
  console.log(`\nSending plan`);
  console.log(`  Resend free plan: ${RESEND_DAILY_LIMIT} emails a day for everything; this tool's cap ${maxPerDay} a day, shared with the reactivation campaign.`);
  console.log(`  Batches of 20 with 1.1 s between emails and 60 s between batches; stops on a quota/domain error or 3 failures in a row.`);
  console.log(`  Next batch: ${batch.length} email${batch.length === 1 ? '' : 's'}`);
  if (batch.length) {
    const code = reminderApprovalCode(batch);
    console.log(`  Approval code for exactly this batch and this wording: ${code}`);
    console.log(`  To send it:  VERIFICATION_REMINDER_SEND=true npm run campaign:verification-reminder:prod -w @study/api -- send --limit ${batch.length} --approval ${code}${includeLegacy ? ' --include-legacy' : ''}`);
  }
  if (includeLegacy && batch.length) console.log(`  Accounts that predate verification have never been emailed: send a small first batch (--limit 3), run \`sync\` a few hours later, and continue only if nothing bounced.`);
  console.log(`\nReady to send? ${pf.blockers.length || problem ? 'NO' : 'yes'}`);
  for (const b of pf.blockers) console.log(`  ✗ ${b}`);
  if (problem) console.log(`  ✗ ${problem}`);
  for (const w of pf.warnings) console.log(`  ! ${w}`);
  console.log('');
}

async function send() {
  const maxPerDay = int('max-per-day', DEFAULT_MAX_PER_DAY, 1);
  const limit = int('limit', 0, 1);
  if (!limit) fail('send needs --limit <number of emails> (use the number printed by the dry run).');
  if (limit > maxPerDay) fail(`--limit ${limit} is above the daily cap (${maxPerDay}). Send in daily batches.`);
  const pf = reminderPreflight();
  if (pf.blockers.length) fail(`Not sending:\n${pf.blockers.map((b) => `  ✗ ${b}`).join('\n')}`);
  const { history, problem } = await readDeliveryHistory();
  if (problem) fail(`Not sending: ${problem}.`);
  const audience = await selectReminderAudience({ maxAgeDays: int('max-age-days', DEFAULT_MAX_ACCOUNT_AGE_DAYS, 1), includeLegacy: flag('include-legacy'), anyTime: flag('any-time'), history });
  const batch = nextReminderBatch(audience, limit);
  if (!batch.length) fail('Nobody to send to right now (run a dry run to see why).');
  const code = reminderApprovalCode(batch);
  if (value('approval') !== code) fail(`Approval code does not match the batch that would go out now (${batch.length} emails). The audience or the wording changed since the dry run: run the dry run again and use its code.`);
  console.log(`Sending ${batch.length} reminder${batch.length === 1 ? '' : 's'} …`);
  const r = await sendReminderBatch({ batch, limit, maxPerDay, batchSize: int('batch-size', 20, 1), pauseMs: int('pause-seconds', 60) * 1000, log: (l) => console.log(`  ${l}`) });
  console.log(`\nBatch ${r.batchId}: attempted ${r.attempted}, sent ${r.sent}, failed ${r.failed}, skipped at the last check ${r.skipped}${r.stopped ? `\nSTOPPED: ${r.stopped}` : ''}`);
  console.log('Next: wait a few hours, then `sync` and `report`.\n');
  if (r.stopped || r.failed) process.exitCode = 2;
}

async function preview() {
  const out = value('out') ?? './reminder-previews';
  await mkdir(out, { recursive: true });
  const links: string[] = [];
  for (const language of LANGUAGES) {
    const mail = verificationReminderEmail('preview@example.com', 'PREVIEW_TOKEN_NOT_A_REAL_LINK', language);
    const name = `verification-reminder-${language}`;
    await writeFile(join(out, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><body style="margin:0;background:#f4f5fa"><div style="max-width:620px;margin:24px auto"><p style="color:#646A7E;font-size:13px;font-family:sans-serif;margin:0 0 8px"><b>Subject:</b> ${mail.subject}</p><div style="background:#fff;border-radius:12px;padding:24px">${mail.html}</div></div></body>`);
    await writeFile(join(out, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
    links.push(`<li><a href="${name}.html">${name}</a> — ${mail.subject}</li>`);
  }
  await writeFile(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Reminder previews</title><body style="font-family:sans-serif;max-width:900px;margin:24px auto"><h1>${REMINDER_CAMPAIGN}</h1><ul>${links.join('')}</ul></body>`);
  console.log(`Wrote ${links.length} previews to ${out}/index.html`);
}

async function main() {
  switch (command) {
    case 'dry-run':
      return dryRun();
    case 'send':
      return send();
    case 'preview':
      return preview();
    case 'sync': {
      const r = await syncReminders();
      return console.log(`Checked ${r.checked} reminders, updated ${r.updated}; read ${r.historyEmails} emails from Resend's log; newly suppressed ${r.suppressed}${r.stopped ? ` — stopped: ${r.stopped}` : ''}`);
    }
    case 'check-resend': {
      if (config.EMAIL_PROVIDER !== 'resend' || !config.RESEND_API_KEY) return console.log('EMAIL_PROVIDER is not resend (or RESEND_API_KEY is missing): there is no delivery log to read here.');
      const d = await diagnoseResend();
      console.log(`\nResend delivery log — read-only check (sends nothing)\n`);
      console.log(`  1. api.resend.com without a key:  ${d.network.ok ? 'answered 401 (the API is reachable)' : d.network.error ?? `HTTP ${d.network.status}`}  [${d.network.ms} ms]`);
      console.log(`  2. delivery log with the key:     ${d.key.ok ? `readable (${d.key.emailsOnFirstPage} emails on the first page)` : `FAILED — ${d.key.kind ?? 'error'}${d.key.status ? ` HTTP ${d.key.status}${d.key.name ? ` ${d.key.name}` : ''}` : ''}`}  [${d.key.ms} ms]`);
      for (const a of d.key.attempts) console.log(`       attempt ${a.attempt}: ${a.outcome}${a.status ? ` HTTP ${a.status}` : ''}${a.name ? ` ${a.name}` : ''} after ${a.ms} ms`);
      console.log(`\n  ${explainDiagnosis(d)}\n`);
      if (!d.key.ok) process.exitCode = 2;
      return;
    }
    case 'inspect-legacy': {
      const { history, problem } = await readDeliveryHistory();
      const r = await inspectLegacy({ history });
      console.log(`\nAccounts never asked to confirm their email (they predate verification) — read-only, nothing is changed or included\n`);
      console.log(`Accounts                      ${r.total}`);
      console.log(`Registered (UTC day)          ${r.byDay.map((d) => `${d.day} ×${d.n}`).join(' · ') || '–'}`);
      console.log(`Age group                     given ${r.ageGroup.given} · none ${r.ageGroup.none}   (only confirmed adults with a group can ever join the marketing campaign)`);
      console.log(`Signed in again after sign-up ${r.activity.loggedInAfterSignup} · opened the app signed in ${r.activity.openedAppSignedIn} · active in the last 7 days ${r.activity.activeLast7Days} · never active ${r.activity.neverActive}`);
      console.log(`Made a course ${r.activity.withCourse} · made a study plan ${r.activity.withPlan}`);
      console.log(`Address domains               ${r.domains.top.map((d) => `${d.domain} ${d.n}`).join(' · ') || '–'}${r.domains.otherDomains ? ` · other: ${r.domains.otherAccounts} account${r.domains.otherAccounts === 1 ? '' : 's'} on ${r.domains.otherDomains} domain${r.domains.otherDomains === 1 ? '' : 's'}` : ''}`);
      const h = r.hygiene;
      console.log(`Address checks                invalid syntax ${h.invalidSyntax} · role address (info@, test@…) ${h.roleAccount} · disposable domain ${h.disposable} · same mailbox twice ${h.sharedMailbox} · domain has no mail server ${h.noMailServer} · DNS inconclusive ${h.lookupInconclusive}`);
      console.log(`Suppressed                    ${r.suppressed}`);
      console.log(`Resend log                    ${r.delivery ? `${r.delivery.addressesEmailed} of these addresses were emailed before (password reset, sign-up link…); ${r.delivery.bounced} bounced or complained` : problem ? `not read: ${problem}` : 'not available with this email provider'}`);
      console.log(`\nReading this: an address is only PROVEN current when its owner opens a confirmation link; the signals above (signed in again, a delivered email, a mail-serving domain, no flags) make it likely, not certain.`);
      if (flag('list')) {
        console.log('\nOne line per account (addresses masked):');
        for (const x of r.rows) console.log(`  ${x.masked.padEnd(26)} ${x.day}  ${x.domain.padEnd(14)} ${x.signedIn ? 'signed in again' : 'never signed in again'}${x.lastActiveDaysAgo === null ? '' : ` · last active ${x.lastActiveDaysAgo} d ago`}${x.courses ? ` · ${x.courses} course${x.courses === 1 ? '' : 's'}` : ''}${x.plans ? ` · ${x.plans} plan${x.plans === 1 ? '' : 's'}` : ''}${x.flags.length ? `  [${x.flags.join(', ')}]` : ''}`);
      }
      console.log('');
      return;
    }
    case 'report': {
      const r = await reminderReport();
      if (!r.sent) return console.log('\nNothing sent yet.\n');
      console.log(`\nResults for "${REMINDER_CAMPAIGN}" (no control group: this shows what happened after the reminder, not what it caused)\n`);
      console.log(`  sent ${r.sent} · delivered ${r.delivered} · bounced ${r.bounced} · complaints ${r.complained}   [needs \`sync\`]`);
      console.log(`  confirmed their address after the reminder ${r.confirmedAfter} · still not confirmed ${r.stillUnverified}\n`);
      return;
    }
    default:
      fail(`Unknown command "${command}". Use dry-run, preview, send, sync, report, check-resend or inspect-legacy.`);
  }
}

try {
  await main();
} finally {
  await sql.end();
}
