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
const EXPECTED_TRIAL_DAYS = 3; // the web (Stripe) trial: STRIPE_TRIAL_DAYS in the app

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
  const appTrial = billing.match(/export const STRIPE_TRIAL_DAYS = (\d+);/);
  if (!appTrial || Number(appTrial[1]) !== site.trialDays) fail(`app billing.ts STRIPE_TRIAL_DAYS is ${appTrial?.[1] ?? '?'} days, site says ${site.trialDays}`);
  else ok('app billing.ts: web trial length (STRIPE_TRIAL_DAYS) matches');

  for (const tier of Object.keys(EXPECTED)) {
    for (const [period, key] of [['monthly', 'monthlyCents'], ['yearly', 'yearlyCents']]) {
      const m = billing.match(new RegExp(`plan\\('${tier}',\\s*'${period}',\\s*(\\d+)\\)`));
      if (!m) fail(`app billing.ts: could not find ${tier} ${period}`);
      else if (Number(m[1]) !== site.prices[tier]?.[key]) fail(`app billing.ts ${tier} ${period} = ${m[1]} cents, site has ${site.prices[tier]?.[key]}`);
    }
  }
  if (!failures) ok('app billing.ts: all six plan prices match the site');
}

// ---- 3. organizations (B2B) plans: site data vs the app's catalog ----
console.log('\nOrganizations (B2B) plans');
// The publicly presented paid plans (Centro is custom). A pilot is never a public plan: it must not appear in the site's data.
const ORG_EXPECTED = {
  esencial: { coursesPerMonth: 10, itemsPerMonth: 500, maxMembers: 10, prices: { monthlyCents: 14900, yearlyCents: 149000 } },
  profesional: { coursesPerMonth: 100, itemsPerMonth: 2000, maxMembers: 25, prices: { monthlyCents: 34900, yearlyCents: 349000 } },
};
const ORG_EXPECTED_PER_REQUEST = 20;
const b2b = readFileSync(join(root, 'src/data/b2b.ts'), 'utf8');
const limitsOf = (src, plan) => {
  const m = src.match(new RegExp(`${plan}:\\s*\\{[^}]*?coursesPerMonth:\\s*([\\d_]+),\\s*itemsPerMonth:\\s*([\\d_]+),(?:\\s*maxItemsPerRequest:\\s*[\\d_]+,)?\\s*maxMembers:\\s*([\\d_]+)`));
  return m ? { coursesPerMonth: Number(m[1].replace(/_/g, '')), itemsPerMonth: Number(m[2].replace(/_/g, '')), maxMembers: Number(m[3].replace(/_/g, '')) } : null;
};
const pricesOf = (src, plan) => {
  const m = src.match(new RegExp(`${plan}:\\s*\\{\\s*monthlyCents:\\s*([\\d_]+),\\s*yearlyCents:\\s*([\\d_]+)\\s*\\}`));
  return m ? { monthlyCents: Number(m[1].replace(/_/g, '')), yearlyCents: Number(m[2].replace(/_/g, '')) } : null;
};
const sameLimits = (a, b) => a && b && a.coursesPerMonth === b.coursesPerMonth && a.itemsPerMonth === b.itemsPerMonth && a.maxMembers === b.maxMembers;
const samePrices = (a, b) => (a === null && b === null) || (a && b && a.monthlyCents === b.monthlyCents && a.yearlyCents === b.yearlyCents);
const fmt = (l) => `${l.coursesPerMonth} courses · ${l.itemsPerMonth} drafts · ${l.maxMembers} admins/editors`;
for (const [plan, want] of Object.entries(ORG_EXPECTED)) {
  const limits = limitsOf(b2b, plan);
  const prices = pricesOf(b2b, plan);
  if (!sameLimits(limits, want)) fail(`${plan}: site allowances are ${limits ? fmt(limits) : 'unparseable'}, expected ${fmt(want)}`);
  else if (!samePrices(prices, want.prices)) fail(`${plan}: site prices are ${prices?.monthlyCents}/${prices?.yearlyCents} cents, expected ${want.prices.monthlyCents}/${want.prices.yearlyCents}`);
  else ok(`${plan}: ${fmt(want)} · €${want.prices.monthlyCents / 100}/month · €${want.prices.yearlyCents / 100}/year (ex-VAT)`);
}
const order = b2b.match(/export const ORG_PLAN_ORDER = \[([^\]]*)\]/);
const shown = order ? order[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean) : null;
if (!shown || shown.join(',') !== 'esencial,profesional,centro') fail(`publicly shown plans are ${shown?.join(', ') ?? 'unparseable'}, expected esencial, profesional, centro (never a pilot)`);
else ok('publicly shown plans: Esencial, Profesional, Centro (no pilot plan)');
if (/ORG_PILOT_DAYS|\bpilot:\s*\{/.test(b2b)) fail('src/data/b2b.ts still defines a pilot plan or pilot length: a pilot is negotiated individually, never published');
const perRequest = b2b.match(/export const ORG_MAX_ITEMS_PER_REQUEST = (\d+);/);
if (!perRequest || Number(perRequest[1]) !== ORG_EXPECTED_PER_REQUEST) fail(`drafts per request: site has ${perRequest?.[1] ?? '?'}, expected ${ORG_EXPECTED_PER_REQUEST}`);

const orgPath = join(root, '..', 'packages', 'shared', 'src', 'organizations.ts');
if (!existsSync(orgPath)) {
  console.log('• packages/shared/src/organizations.ts not found (site built outside the monorepo) — app cross-check skipped.');
} else {
  const catalog = readFileSync(orgPath, 'utf8');
  const before = failures;
  for (const plan of Object.keys(ORG_EXPECTED)) {
    const appLimits = limitsOf(catalog, plan);
    const siteLimits = limitsOf(b2b, plan);
    if (!sameLimits(appLimits, siteLimits)) fail(`app organizations.ts ${plan}: ${appLimits ? fmt(appLimits) : 'not found'}, site has ${siteLimits ? fmt(siteLimits) : 'unparseable'}`);
    {
      const m = catalog.match(new RegExp(`${plan}:[^}]*\\}[^}]*prices:\\s*\\{\\s*monthly:\\s*([\\d_]+),\\s*yearly:\\s*([\\d_]+)\\s*\\}`));
      const appPrices = m ? { monthlyCents: Number(m[1].replace(/_/g, '')), yearlyCents: Number(m[2].replace(/_/g, '')) } : null;
      if (!samePrices(appPrices, pricesOf(b2b, plan))) fail(`app organizations.ts ${plan} prices: ${appPrices ? `${appPrices.monthlyCents}/${appPrices.yearlyCents}` : 'not found'}, site differs`);
    }
    const appPerRequest = catalog.match(new RegExp(`${plan}:[^}]*maxItemsPerRequest:\\s*(\\d+)`));
    if (!appPerRequest || Number(appPerRequest[1]) !== ORG_EXPECTED_PER_REQUEST) fail(`app organizations.ts ${plan}: maxItemsPerRequest is ${appPerRequest?.[1] ?? '?'}, site says ${ORG_EXPECTED_PER_REQUEST}`);
  }
  // The app never puts a new organization on a pilot by itself: the column default and the creation code say 'none'.
  const schema = readFileSync(join(root, '..', 'apps', 'api', 'src', 'db', 'schema.ts'), 'utf8');
  if (!/plan: text\('plan'\)[^\n]*\.default\('none'\)/.test(schema)) fail("app schema.ts: organizations.plan must default to 'none' (no automatic pilot)");
  const create = readFileSync(join(root, '..', 'apps', 'api', 'src', 'services', 'organizations.ts'), 'utf8');
  if (!/\.insert\(organizations\)[\s\S]{0,300}plan: 'none'/.test(create)) fail("app services/organizations.ts: createOrganization must create organizations with plan 'none'");
  if (failures === before) ok('app organizations.ts: Esencial and Profesional allowances, prices and drafts per request match the site; new organizations start without a plan');
}

if (failures) {
  console.error(`\n${failures} pricing check(s) failed.`);
  process.exit(1);
}
console.log('\nPricing checks passed.');
