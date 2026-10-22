/**
 * The Account screen of an ORGANIZATION account shows the organization's plan and the plans for organizations
 * (Esencial, Profesional, Centro) — never the student plans, trial, usage or paywall, which belong to the student
 * account of the same email. Plans are requested by email; Exama activates them (no checkout, nothing charged).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ORGANIZATION_PLAN_CATALOG } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import { isCurrentOrgPlan, ORG_PLAN_CHOICES, orgMaxYearlySavingPct, orgPlanPrice, orgPlanRequestMailto, orgYearlySavingPct } from '../src/lib/org-plans';
import { SUPPORT_EMAIL } from '../src/lib/support';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

test('the offered plans are the organization plans, with the shared list prices (VAT excluded)', () => {
  assert.deepEqual([...ORG_PLAN_CHOICES], ['esencial', 'profesional', 'centro']);
  assert.equal(orgPlanPrice('esencial', 'monthly'), 14_900);
  assert.equal(orgPlanPrice('esencial', 'yearly'), 149_000);
  assert.equal(orgPlanPrice('profesional', 'monthly'), 34_900);
  assert.equal(orgPlanPrice('profesional', 'yearly'), 349_000);
  assert.equal(orgPlanPrice('centro', 'monthly'), null, 'Centro is custom');
  for (const p of ORG_PLAN_CHOICES) {
    const prices = ORGANIZATION_PLAN_CATALOG[p].prices;
    assert.equal(orgPlanPrice(p, 'monthly'), prices?.monthly ?? null, 'one source: the shared catalog');
  }
  assert.equal(orgYearlySavingPct('esencial'), 17);
  assert.equal(orgYearlySavingPct('profesional'), 17);
  assert.equal(orgYearlySavingPct('centro'), null);
  assert.equal(orgMaxYearlySavingPct(), 17);
});

test('"current plan" marks only a paid plan the organization really has (never a pilot or no plan)', () => {
  assert.equal(isCurrentOrgPlan({ plan: 'profesional' }, 'profesional'), true);
  assert.equal(isCurrentOrgPlan({ plan: 'profesional' }, 'esencial'), false);
  for (const p of ORG_PLAN_CHOICES) {
    assert.equal(isCurrentOrgPlan({ plan: 'pilot' }, p), false);
    assert.equal(isCurrentOrgPlan({ plan: 'none' }, p), false);
    assert.equal(isCurrentOrgPlan(null, p), false);
  }
});

test('a plan request is an email to Exama with the subject and body filled in — nothing is sent or charged by the app', () => {
  const url = orgPlanRequestMailto('Exama for organizations: Profesional plan', 'Hello,\n\nOrganization: Centro A & B\n\nThank you.');
  assert.ok(url.startsWith(`mailto:${SUPPORT_EMAIL}?`));
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(params.get('subject'), 'Exama for organizations: Profesional plan');
  assert.equal(params.get('body'), 'Hello,\n\nOrganization: Centro A & B\n\nThank you.');
  assert.ok(!url.includes('+'), 'spaces as %20, which every mail app reads');
  assert.match(url, /%0A/, 'line breaks kept');
});

test('Account: an organization account gets the organization screen; the student screen (plan, trial, usage, paywall) only for students', () => {
  const account = src('app/account.tsx');
  assert.match(account, /return user\?\.accountType === 'organization' \? <OrganizationAccount \/> : <StudentAccount \/>;/);
  const org = between(account, 'function OrganizationAccount()', 'function StudentAccount()');
  assert.match(org, /<OrganizationAccountPlans \/>/);
  for (const studentOnly of ['useEntitlement', 'openPaywall', 'planSummary', 'ReminderSettingsCard', 'MarketingSettingsCard', "t('account.plan')", 'UsageRow']) {
    assert.ok(!org.includes(studentOnly), `the organization screen has no ${studentOnly}`);
  }
  // Both keep the workspace link, owner dashboards, settings (incl. switching identity), help, sign out and deletion.
  assert.match(org, /<AccountLinks \/>[\s\S]*<AccountExit \/>/);
  assert.match(between(account, 'function StudentAccount()', 'function AccountLinks()'), /<AccountLinks \/>[\s\S]*<AccountExit \/>/);

  const plans = src('components/org/account-plans.tsx');
  assert.ok(!/useEntitlement|openPaywall|PAID_TIERS|'\/paywall'/.test(plans), 'no student billing on the organization screen');
  assert.deepEqual([...plans.matchAll(/api\.(\w+)/g)].map((m) => m[1]), ['orgOverview'], 'reads the organization overview only; changes nothing');
  assert.match(plans, /canRequest=\{!selected \|\| canAdmin\(selected\.role\)\}/, 'only admins request a plan for their organization');
  assert.match(plans, /!isCurrent && canRequest && \(/);
});

test('the student paywall sends an organization account to its Account screen', () => {
  const paywall = src('app/paywall.tsx');
  assert.match(paywall, /if \(user\?\.accountType === 'organization'\) return <Redirect href="\/account" \/>;\s*return <StudentPaywall \/>;/);
});

test('plan cards read naturally in every language, incl. Arabic plurals and the email body', async () => {
  const cases = {
    en: ['500 question drafts per month', '10 admins or editors', 'Request Profesional'],
    es: ['500 borradores de preguntas al mes', '10 administradores o editores', 'Solicitar Profesional'],
    fr: ['500 brouillons de questions par mois', '10 administrateurs ou éditeurs', 'Demander Profesional'],
    ar: ['500 مسودة أسئلة شهريًا', '10 مسؤولين أو محرّرين', 'اطلب خطة Profesional'],
  } as const;
  for (const [lang, [drafts, seats, cta]] of Object.entries(cases)) {
    await initI18n(lang as 'en');
    assert.equal(i18n.t('orgAccount.feature.drafts', { count: 500, n: '500' }), drafts);
    assert.equal(i18n.t('orgAccount.feature.seats', { count: 10, n: '10' }), seats);
    assert.equal(i18n.t('orgAccount.request.profesional'), cta);
    const body = i18n.t('orgAccount.mail.body', { plan: 'Esencial', period: i18n.t('orgAccount.mail.period.yearly'), org: 'Centro Norte' });
    assert.ok(body.includes('Esencial') && body.includes('Centro Norte') && !body.includes('{{'), `${lang} mail body`);
  }
  await initI18n('ar');
  assert.equal(i18n.t('orgAccount.feature.seats', { count: 25, n: '25' }), '25 مسؤولًا أو محرّرًا');
  assert.equal(i18n.t('orgAccount.feature.courses', { count: 100, n: '100' }), '100 مقرر مرفوع شهريًا');
  await initI18n('en');
});
