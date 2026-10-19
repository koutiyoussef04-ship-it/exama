/**
 * Reactivation email campaign (services/reactivation-campaign.ts). Dry run by default: nothing is sent.
 *
 *   npm run campaign:reactivation -- dry-run [--step 1|2] [--limit 5] [--inactive-days 7] [--include-lapsed] [--any-time] [--list]
 *   npm run campaign:reactivation -- preview [--out ./campaign-previews]     write every email (4 languages, 2 audiences, 2 steps) as HTML
 *   REACTIVATION_CAMPAIGN_SEND=true npm run campaign:reactivation -- send --step 1 --limit 5 --approval <code from the dry run>
 *   npm run campaign:reactivation -- sync                                    read delivery status back from Resend; bounces and complaints are suppressed
 *   npm run campaign:reactivation -- report [--days 14]                      delivery, clicks, returns, plans, unsubscribes, subscriptions
 *   npm run campaign:reactivation -- suppress --email someone@example.com    never email this address
 *
 * On Render (the production database only accepts connections from inside Render): open the exama-api Shell and
 * run the same commands with `npm run campaign:reactivation:prod -w @study/api -- …`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { sql } from '../src/db/client.js';
import {
  CAMPAIGN,
  DEFAULT_INACTIVE_DAYS,
  DEFAULT_MAX_PER_DAY,
  RESEND_DAILY_LIMIT,
  approvalCode,
  campaignReport,
  maskEmail,
  nextBatch,
  preflight,
  selectAudience,
  sendBatch,
  suppress,
  syncDelivery,
  type Audience,
  type ExcludeReason,
} from '../src/services/reactivation-campaign.js';
import { LANGS, VARIANTS, buildCampaignEmail, preheaderOf, segmentOf, type Step } from '../src/services/reactivation-emails.js';

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
const step = (int('step', 1, 1) === 2 ? 2 : 1) as Step;
if (value('step') && !['1', '2'].includes(value('step')!)) fail('--step must be 1 or 2');

const REASON: Record<ExcludeReason, string> = {
  not_verified: 'email address not confirmed',
  no_marketing_consent: 'no explicit marketing consent (never ticked it, existed before it was asked, or withdrew)',
  suppressed: 'on the suppression list (bounce, complaint or manual)',
  minor_or_unknown_age: 'under 18 or no age group given',
  already_sent: 'already got this step',
  step1_missing: 'step 2 only: never got step 1',
  too_soon_for_step2: 'step 2 only: step 1 was less than 5 days ago',
  returned_after_step1: 'step 2 only: opened the app since step 1',
  clicked_after_step1: 'step 2 only: clicked step 1',
  converted_after_step1: 'step 2 only: created a study plan since step 1',
  too_new: 'account younger than 3 days',
  recently_active: 'opened the app recently',
  recently_emailed: 'got another Exama email in the last 7 days',
  owner: 'owner / complimentary account',
  current_subscriber: 'has paid or trial access now',
  checkout_started: 'started a web checkout (payment can’t be ruled out)',
  billing_unknown: 'billing state unreadable (fail closed)',
  lapsed_subscriber: 'former subscriber (held out; --include-lapsed to include)',
  exam_today: 'exam is today',
  plan_limit_reached: 'can’t create another plan this month',
};

function printAudience(a: Audience, maxPerDay: number, limit: number) {
  const count = (pred: (c: Audience['eligible'][number]) => boolean) => a.eligible.filter(pred).length;
  const due = count((c) => c.dueNow);
  const has = count((c) => c.segment === 'has_plan');
  const no = count((c) => c.segment === 'no_plan');
  const v = (x: string) => count((c) => c.variant === x);
  console.log(`\nExama reactivation campaign "${CAMPAIGN}" — step ${a.step} — DRY RUN (nothing is sent)`);
  console.log(`Run at ${a.now.toISOString()}\n`);
  console.log(`Accounts in the database      ${a.usersTotal}`);
  console.log(`Eligible                      ${a.eligible.length}   (inside their send window now: ${due}, waiting for their local evening: ${a.eligible.length - due})`);
  console.log(`  Segment 1 — has a plan      ${has}   exam_upcoming ${v('exam_upcoming')} · exam_passed ${v('exam_passed')}`);
  console.log(`  Segment 2 — no plan         ${no}   course_ready ${v('course_ready')} · no_course ${v('no_course')}`);
  console.log(`  Languages                   ${LANGS.map((l) => `${l} ${count((c) => c.language === l)}`).join(' · ')}`);
  const ex = Object.entries(a.excluded).sort((x, y) => y[1]! - x[1]!);
  console.log(`\nExcluded (first matching rule): ${ex.reduce((n, [, k]) => n + k!, 0)}`);
  for (const [reason, n] of ex) console.log(`  ${String(n).padStart(5)}  ${REASON[reason as ExcludeReason]}  [${reason}]`);
  if (flag('list')) {
    console.log('\nEligible (addresses masked):');
    for (const c of a.eligible) console.log(`  ${maskEmail(c.email).padEnd(28)} ${c.segment}/${c.variant} ${c.language}${c.dueNow ? '' : '  (later)'}`);
  }
  void maxPerDay;
  void limit;
}

async function dryRun() {
  const maxPerDay = int('max-per-day', DEFAULT_MAX_PER_DAY, 1);
  const limit = int('limit', 5, 1);
  const audience = await selectAudience({ step, inactiveDays: int('inactive-days', DEFAULT_INACTIVE_DAYS), includeLapsed: flag('include-lapsed'), anyTime: flag('any-time') });
  printAudience(audience, maxPerDay, limit);
  const batch = nextBatch(audience, Math.min(limit, maxPerDay));
  const pf = preflight();
  console.log(`\nSending plan`);
  console.log(`  Resend free plan: ${RESEND_DAILY_LIMIT} emails a day for everything (password reset and verification share it); campaign cap ${maxPerDay} a day.`);
  console.log(`  Batches of 20 with 1.1 s between emails and 60 s between batches; stops on a quota/domain error or 3 failures in a row.`);
  console.log(`  Next batch: ${batch.length} email${batch.length === 1 ? '' : 's'} (${[...new Set(batch.map((c) => `${c.segment}/${c.language}`))].join(', ') || 'none'})`);
  if (batch.length) {
    const code = approvalCode(step, batch);
    console.log(`  Approval code for exactly this batch and this wording: ${code}`);
    console.log(`  To send it:  REACTIVATION_CAMPAIGN_SEND=true npm run campaign:reactivation:prod -w @study/api -- send --step ${step} --limit ${batch.length} --approval ${code}`);
  }
  console.log(`\nReady to send? ${pf.blockers.length ? 'NO' : 'yes'}`);
  for (const b of pf.blockers) console.log(`  ✗ ${b}`);
  for (const w of pf.warnings) console.log(`  ! ${w}`);
  console.log('');
}

async function send() {
  const maxPerDay = int('max-per-day', DEFAULT_MAX_PER_DAY, 1);
  const limit = int('limit', 0, 1);
  if (!limit) fail('send needs --limit <number of emails> (use the number printed by the dry run).');
  if (limit > maxPerDay) fail(`--limit ${limit} is above the daily cap (${maxPerDay}). Send in daily batches.`);
  const pf = preflight();
  if (pf.blockers.length) fail(`Not sending:\n${pf.blockers.map((b) => `  ✗ ${b}`).join('\n')}`);
  const audience = await selectAudience({ step, inactiveDays: int('inactive-days', DEFAULT_INACTIVE_DAYS), includeLapsed: flag('include-lapsed'), anyTime: flag('any-time') });
  const batch = nextBatch(audience, limit);
  if (!batch.length) fail('Nobody to send to right now (run a dry run to see why).');
  const code = approvalCode(step, batch);
  if (value('approval') !== code) fail(`Approval code does not match the batch that would go out now (${batch.length} emails). The audience or the wording changed since the dry run: run the dry run again and use its code.`);
  console.log(`Sending ${batch.length} email${batch.length === 1 ? '' : 's'} (step ${step}) …`);
  const r = await sendBatch({ step, batch, limit, maxPerDay, batchSize: int('batch-size', 20, 1), pauseMs: int('pause-seconds', 60) * 1000, includeLapsed: flag('include-lapsed'), log: (l) => console.log(`  ${l}`) });
  console.log(`\nBatch ${r.batchId}: attempted ${r.attempted}, sent ${r.sent}, failed ${r.failed}, skipped at the last check ${r.skipped}${r.stopped ? `\nSTOPPED: ${r.stopped}` : ''}`);
  console.log('Next: wait a few hours, then `sync` and `report` before sending more.\n');
  if (r.stopped || r.failed) process.exitCode = 2;
}

async function preview() {
  const out = value('out') ?? './campaign-previews';
  await mkdir(out, { recursive: true });
  const sender = { name: '[Company name]', address: '[Company address]', supportEmail: '[support email]' };
  const links: string[] = [];
  for (const s of [1, 2] as Step[])
    for (const variant of VARIANTS)
      for (const language of LANGS) {
        const mail = buildCampaignEmail({
          to: 'preview@example.com',
          name: 'Alex',
          language,
          step: s,
          variant,
          course: variant === 'no_course' ? null : 'Cell biology',
          daysUntilExam: variant === 'exam_upcoming' ? 9 : null,
          ctaUrl: 'https://api.example/email/click/PREVIEW',
          unsubscribeUrl: 'https://app.example/unsubscribe#token=PREVIEW',
          oneClickUrl: 'https://api.example/email/unsubscribe?token=PREVIEW',
          sender,
        });
        const name = `step${s}-${segmentOf(variant)}-${variant}-${language}`;
        const page = `<!doctype html><meta charset="utf-8"><title>${name}</title><body style="margin:0;background:#f4f5fa;font-family:sans-serif"><div style="max-width:620px;margin:24px auto"><p style="color:#646A7E;font-size:13px;margin:0 0 8px"><b>Subject:</b> ${mail.subject}<br><b>Preview text:</b> ${preheaderOf(language, s, variant)}</p><div style="background:#fff;border-radius:12px;padding:24px">${mail.html}</div></div></body>`;
        await writeFile(join(out, `${name}.html`), page);
        await writeFile(join(out, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
        links.push(`<li><a href="${name}.html">${name}</a> — ${mail.subject}</li>`);
      }
  await writeFile(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Campaign previews</title><body style="font-family:sans-serif;max-width:900px;margin:24px auto"><h1>${CAMPAIGN}</h1><ul>${links.join('')}</ul></body>`);
  console.log(`Wrote ${links.length} previews to ${out}/index.html`);
}

async function report() {
  const days = int('days', 14, 1);
  const rows = await campaignReport(days);
  if (!rows.length) return console.log('\nNothing sent yet.\n');
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  console.log(`\nResults for "${CAMPAIGN}" (people who did it within ${days} days of the email; no control group, so this shows what happened, not what the email caused)\n`);
  for (const r of rows) {
    console.log(`Step ${r.step} · ${r.segment === 'has_plan' ? 'has a plan' : 'no plan'}   sent ${r.sent}`);
    console.log(`  delivered ${r.delivered} (${pct(r.delivered, r.sent)}) · bounced ${r.bounced} · complaints ${r.complained}   [needs \`sync\`]`);
    console.log(`  clicked ${r.clicked} (${pct(r.clicked, r.sent)}; ${r.clickedIncludingScanners} counting link scanners)`);
    console.log(`  returned to the app ${r.returned} (${pct(r.returned, r.sent)}) · created a study plan ${r.planCreated} (${pct(r.planCreated, r.sent)}) · started an exam or practice ${r.studied}`);
    console.log(`  unsubscribed ${r.unsubscribed} (${pct(r.unsubscribed, r.sent)}) · subscribed since the email ${r.subscribed}\n`);
  }
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
      const r = await syncDelivery();
      return console.log(`Checked ${r.checked}, updated ${r.updated}, newly suppressed ${r.suppressed}${r.stopped ? ` — stopped: ${r.stopped}` : ''}`);
    }
    case 'report':
      return report();
    case 'suppress': {
      const email = value('email');
      if (!email || !/^\S+@\S+$/.test(email)) fail('suppress needs --email <address>');
      await suppress(email);
      return console.log('Added to the suppression list.');
    }
    default:
      fail(`Unknown command "${command}". Use dry-run, preview, send, sync, report or suppress.`);
  }
}

void config;
try {
  await main();
} finally {
  await sql.end();
}
