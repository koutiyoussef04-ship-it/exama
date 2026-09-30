/**
 * Guards against pricing drift between the marketing site and the app.
 *
 *   1. The site's prices must equal the launch prices (the source of truth is the app, below).
 *   2. When this folder sits inside the Exama monorepo, they must also equal
 *      packages/shared/src/billing.ts — the file the app itself reads. (Skipped, with a notice, if
 *      the site is ever built from a checkout that only contains website/.)
 *
 * Node stdlib only:  npm run check:pricing
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = {
  basic: { monthlyCents: 999, yearlyCents: 7999 },
  student: { monthlyCents: 1499, yearlyCents: 11999 },
  pro: { monthlyCents: 2499, yearlyCents: 19999 },
};
const EXPECTED_TRIAL_DAYS = 7;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

// ---- 1. the site's own data ----
const content = readFileSync(join(root, 'src/data/content.ts'), 'utf8');
const trialMatch = content.match(/export const TRIAL_DAYS = (\d+);/);
const site = { trialDays: trialMatch ? Number(trialMatch[1]) : null, prices: {} };
for (const tier of Object.keys(EXPECTED)) {
  const m = content.match(new RegExp(`${tier}:\\s*\\{\\s*monthlyCents:\\s*(\\d+),\\s*yearlyCents:\\s*(\\d+)\\s*\\}`));
  site.prices[tier] = m ? { monthlyCents: Number(m[1]), yearlyCents: Number(m[2]) } : null;
}

for (const [tier, want] of Object.entries(EXPECTED)) {
  const got = site.prices[tier];
  if (!got) fail(`${tier}: could not parse prices from src/data/content.ts`);
  else if (got.monthlyCents !== want.monthlyCents || got.yearlyCents !== want.yearlyCents) {
    fail(`${tier}: site has ${got.monthlyCents}/${got.yearlyCents} cents, expected ${want.monthlyCents}/${want.yearlyCents}`);
  } else ok(`${tier}: €${(want.monthlyCents / 100).toFixed(2)}/month · €${(want.yearlyCents / 100).toFixed(2)}/year`);
}
if (site.trialDays !== EXPECTED_TRIAL_DAYS) fail(`trial length: site has ${site.trialDays}, expected ${EXPECTED_TRIAL_DAYS}`);
else ok(`trial: ${EXPECTED_TRIAL_DAYS} days`);

// ---- 2. the app's catalog ----
const billingPath = join(root, '..', 'packages', 'shared', 'src', 'billing.ts');
if (!existsSync(billingPath)) {
  console.log('• packages/shared/src/billing.ts not found (site built outside the monorepo) — app cross-check skipped.');
} else {
  const billing = readFileSync(billingPath, 'utf8');
  const appTrial = billing.match(/export const TRIAL_DAYS = (\d+);/);
  if (!appTrial || Number(appTrial[1]) !== site.trialDays) fail(`app billing.ts trial is ${appTrial?.[1] ?? '?'} days, site says ${site.trialDays}`);
  else ok('app billing.ts: trial length matches');

  for (const tier of Object.keys(EXPECTED)) {
    for (const [period, key] of [['monthly', 'monthlyCents'], ['yearly', 'yearlyCents']]) {
      const m = billing.match(new RegExp(`plan\\('${tier}',\\s*'${period}',\\s*(\\d+)\\)`));
      if (!m) fail(`app billing.ts: could not find ${tier} ${period}`);
      else if (Number(m[1]) !== site.prices[tier]?.[key]) fail(`app billing.ts ${tier} ${period} = ${m[1]} cents, site has ${site.prices[tier]?.[key]}`);
    }
  }
  if (!failures) ok('app billing.ts: all six plan prices match the site');
}

if (failures) {
  console.error(`\n${failures} pricing check(s) failed.`);
  process.exit(1);
}
console.log('\nPricing checks passed.');
