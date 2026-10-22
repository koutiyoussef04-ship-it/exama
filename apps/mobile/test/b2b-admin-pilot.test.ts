/**
 * The owner's "Grant a pilot" form (B2B owner dashboard): what it sends. Pilots are granted by hand only; the server
 * re-checks everything (owner only, end in the future, at most ORGANIZATION_PILOT_MAX_DAYS).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ORGANIZATION_PILOT_MAX_DAYS, ORGANIZATION_PLAN_CATALOG } from '@study/shared';
import { pilotGrantInput } from '../src/lib/b2b-admin';

const NOW = Date.UTC(2026, 9, 22, 12, 0);
const form = (f: Partial<{ days: string; courses: string; drafts: string; seats: string }> = {}) => ({ days: '30', courses: '', drafts: '', seats: '', ...f });

test('length → end date from now; empty allowances keep the pilot defaults', () => {
  assert.deepEqual(pilotGrantInput(form(), ORGANIZATION_PILOT_MAX_DAYS, NOW), { ok: true, input: { plan: 'pilot', pilotEndsAt: new Date(NOW + 30 * 86_400_000).toISOString() } });
  assert.deepEqual(pilotGrantInput(form({ days: ' 14 ', drafts: '300', seats: '5' }), ORGANIZATION_PILOT_MAX_DAYS, NOW), {
    ok: true,
    input: { plan: 'pilot', pilotEndsAt: new Date(NOW + 14 * 86_400_000).toISOString(), limits: { itemsPerMonth: 300, maxMembers: 5 } },
  });
  assert.deepEqual(pilotGrantInput(form({ courses: '0' }), ORGANIZATION_PILOT_MAX_DAYS, NOW).ok, true, 'zero courses is a valid agreement');
});

test('invalid lengths and allowances are refused before anything is sent', () => {
  for (const days of ['', '0', '-3', '1.5', 'abc', String(ORGANIZATION_PILOT_MAX_DAYS + 1)]) assert.deepEqual(pilotGrantInput(form({ days }), ORGANIZATION_PILOT_MAX_DAYS, NOW), { ok: false, error: 'days' }, days);
  for (const f of [{ courses: '-1' }, { drafts: '2.5' }, { seats: '0' }, { drafts: '9999999' }]) assert.deepEqual(pilotGrantInput(form(f), ORGANIZATION_PILOT_MAX_DAYS, NOW), { ok: false, error: 'limit' }, JSON.stringify(f));
});

test('no plan is a real state: no allowances, nothing to sell; a pilot is not a public plan and is only granted from its own form', () => {
  assert.deepEqual([ORGANIZATION_PLAN_CATALOG.none.limits.coursesPerMonth, ORGANIZATION_PLAN_CATALOG.none.limits.itemsPerMonth, ORGANIZATION_PLAN_CATALOG.none.prices], [0, 0, null]);
  const screen = readFileSync(new URL('../src/app/b2b-admin/[id].tsx', import.meta.url), 'utf8');
  assert.match(screen, /const ASSIGNABLE_PLANS = \['none', 'esencial', 'profesional', 'centro'\] as const/, 'the plan selector does not offer the pilot');
  assert.match(screen, /update\.mutate\(\{ pilotEndsAt: new Date\(\)\.toISOString\(\) \}\)/, 'ending a pilot sets its end to now (kept as a record)');
  const dashboard = readFileSync(new URL('../src/app/org/index.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /o\.plan === 'none' && \(/, 'the workspace says when there is no active plan');
});
