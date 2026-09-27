/**
 * Prints the product funnel, drop-off and retention from analytics_events.
 *   npm run analytics:report              # last 30 days
 *   npm run analytics:report -- --days 7
 *   npm run analytics:report -- --include-test   # also count mock + store sandbox (TestFlight / Play test) purchases
 * Uses apps/api/analytics/queries.sql (the same queries can be run in pgAdmin).
 */
import { readFileSync } from 'node:fs';
import { sql } from '../src/db/client.js';

const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;
if (!Number.isInteger(days) || days < 1) {
  console.error('Usage: npm run analytics:report -- --days <positive integer>');
  process.exit(1);
}

const file = readFileSync(new URL('../analytics/queries.sql', import.meta.url), 'utf8');
const queries = Object.fromEntries(
  file
    .split(/^-- name: /m)
    .slice(1)
    .map((block) => {
      const [name, ...rest] = block.split('\n');
      return [name.trim(), rest.join('\n')];
    }),
);
type Row = Record<string, unknown>;
const includeMock = process.argv.includes('--include-test') || process.argv.includes('--include-mock');
const run = async (name: string) =>
  (await sql.unsafe(queries[name], name === 'monetization' || name === 'plans_by_tier' ? [days, includeMock] : [days])) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);
const rate = (a: number, b: number) => (b === 0 ? '   –' : `${Math.round((a / b) * 100)}%`.padStart(4));

console.log(`\nExama analytics — last ${days} day${days === 1 ? '' : 's'} (UTC)\n`);

// 1–6. Funnel
const f = (await run('funnel'))[0];
const steps: [string, string][] = [
  ['signed_up', 'Signed up'],
  ['uploaded_pdf', 'Uploaded a PDF'],
  ['course_processed', 'Course processed'],
  ['exam_started', 'Started an exam'],
  ['exam_completed', 'Completed an exam'],
  ['practice_started', 'Started weak-topic practice'],
  ['practice_completed', 'Completed practice'],
];
console.log('FUNNEL (users who signed up in this period)');
console.log('  step                              users  of prev  of signups');
let prev = n(f.signed_up);
for (const [key, label] of steps) {
  const v = n(f[key]);
  console.log(`  ${label.padEnd(32)} ${String(v).padStart(6)}   ${rate(v, prev)}     ${rate(v, n(f.signed_up))}`);
  prev = v;
}
const drops = steps.slice(1).map(([k, label], i) => ({ label, lost: n(f[steps[i][0]]) - n(f[k]) }));
const worst = drops.sort((a, b) => b.lost - a.lost)[0];
if (worst && worst.lost > 0) console.log(`  → biggest drop-off: before "${worst.label}" (${worst.lost} users)`);

// Documents & exams
const d = (await run('documents'))[0];
console.log('\nCOURSES');
console.log(`  uploads ${n(d.uploads)} · processed OK ${n(d.processed_ok)} (${rate(n(d.processed_ok), n(d.uploads)).trim()}) · upload failures ${n(d.upload_failures)} · processing failures ${n(d.processing_failures)}`);
console.log(`  avg processing ${d.avg_processing_s ?? '–'}s · avg ${d.avg_pages ?? '–'} pages`);

console.log('\nEXAMS');
for (const r of await run('exams')) {
  console.log(`  ${String(r.kind).padEnd(8)} generated ${n(r.generated)} · failed ${n(r.generation_failed)} · avg generation ${r.avg_generation_s ?? '–'}s`);
}
for (const r of await run('completions')) {
  console.log(`  ${String(r.kind).padEnd(8)} completed ${n(r.completed)} · avg score ${r.avg_score_pct ?? '–'}% · avg answered ${r.avg_answered_pct ?? '–'}% · avg weak topics after ${r.avg_weak_topics_after ?? '–'}`);
}

const failures = await run('failures');
if (failures.length) {
  console.log('\nTOP FAILURE REASONS');
  for (const r of failures) console.log(`  ${String(r.count).padStart(4)}  ${r.name} · ${r.reason}`);
}

// Monetization
const m = (await run('monetization'))[0];
console.log(`\nMONETIZATION${includeMock ? ' (including mock + store sandbox purchases)' : ' (real App Store / Google Play purchases only; add --include-test for test data)'}`);
console.log(`  paywall viewers ${n(m.paywall_viewers)} → upgrade started ${n(m.upgrade_starters)} (${rate(n(m.upgrade_starters), n(m.paywall_viewers)).trim()})`);
console.log(`  trials ${n(m.trials)} · subscribers ${n(m.subscribers)} · trial→paid ${n(m.trial_conversions)} (${rate(n(m.trial_conversions), n(m.trials)).trim()})`);
console.log(`  cancellations ${n(m.cancellations)} · expirations ${n(m.expirations)} · restores ${n(m.restores)}`);
const fl = (await run('free_lecture'))[0];
console.log(`  free lecture used ${n(fl.free_lectures)} → paywall after it ${n(fl.saw_paywall)} → trial or subscription ${n(fl.converted)} (${rate(n(fl.converted), n(fl.free_lectures)).trim()})`);
const TIER_NAMES: Record<string, string> = { basic: 'Basic', student: 'Student', pro: 'Pro' };
for (const t of await run('plans_by_tier')) {
  console.log(
    `  ${(TIER_NAMES[String(t.tier)] ?? String(t.tier)).padEnd(8)} selected ${n(t.selected)} · upgrade started ${n(t.upgrade_starters)} · trials ${n(t.trials)} · subscribers ${n(t.subscribers)} (yearly ${n(t.yearly)}) · upgrades in ${n(t.upgrades_into)} · downgrades in ${n(t.downgrades_into)} · cancelled ${n(t.cancellations)} · expired ${n(t.expirations)}`,
  );
}

// 7. Retention
const r = (await run('retention'))[0];
console.log('\nRETENTION');
console.log(`  active users ${n(r.active_users)} · today ${n(r.active_today)} · last 7 days ${n(r.active_last_7d)} · app opens ${n(r.app_opens)}`);
console.log(`  returned on 2+ days ${n(r.returning_users)} (${rate(n(r.returning_users), n(r.active_users)).trim()}) · avg active days ${r.avg_active_days ?? '–'}`);
console.log(`  day-1 retention ${rate(n(r.d1_returned), n(r.d1_eligible)).trim()} (${n(r.d1_returned)}/${n(r.d1_eligible)}) · week-1 retention ${rate(n(r.w1_returned), n(r.w1_eligible)).trim()} (${n(r.w1_returned)}/${n(r.w1_eligible)})`);
console.log('');

await sql.end();
