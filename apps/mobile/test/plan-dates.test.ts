/** Planner calendar helpers and planner translations (all four languages, Arabic plurals/RTL). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import i18n, { initI18n } from '../src/i18n';
import { addDaysIso, diffDaysIso, formatIso, formatTime, monthGrid, stepTime, weekdayNames, weekdayOf, weekOrder } from '../src/lib/plan-dates';

test('date math and month grids (weeks starting Sunday, Monday or Saturday)', () => {
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDaysIso('2026-09-26', '2026-10-08'), 12);
  assert.equal(weekdayOf('2026-09-26'), 6);
  const sep = monthGrid(2026, 9, 1); // Sept 2026 starts on a Tuesday
  assert.deepEqual(sep[0].slice(0, 2), [null, '2026-09-01']);
  assert.ok(sep.every((w) => w.length === 7));
  assert.equal(sep.flat().filter(Boolean).length, 30);
  assert.equal(monthGrid(2026, 9, 0)[0][2], '2026-09-01');
  assert.equal(monthGrid(2026, 9, 6)[0][3], '2026-09-01');
  assert.equal(monthGrid(2028, 2, 1).flat().filter(Boolean).length, 29, 'leap year');
  assert.deepEqual(weekOrder(6), [6, 0, 1, 2, 3, 4, 5]);
});

test('localized weekday/date/time formatting never shifts the day', () => {
  assert.equal(weekdayNames('en', 'short')[0], 'Sun');
  assert.equal(formatIso('2026-10-08', 'en', { day: 'numeric', month: 'long' }), 'October 8');
  assert.match(formatIso('2026-10-08', 'fr', { day: 'numeric', month: 'long' }), /8 octobre/);
  assert.match(formatIso('2026-10-08', 'ar-u-nu-latn', { day: 'numeric', month: 'long' }), /8/);
  assert.equal(stepTime('09:00', 30), '09:30');
  assert.equal(stepTime('06:00', -30), '06:00', 'clamped');
  assert.match(formatTime('14:30', 'en'), /2:30/);
});

test('planner strings exist in every language, with correct countdown plurals (incl. Arabic)', async () => {
  const cases: Record<string, [number, string][]> = {
    en: [[1, '1 day until your exam'], [12, '12 days until your exam']],
    es: [[1, 'Falta 1 día para tu examen'], [12, 'Faltan 12 días para tu examen']],
    fr: [[1, '1 jour avant votre examen'], [12, '12 jours avant votre examen']],
    ar: [[1, 'بقي يوم واحد على اختبارك'], [2, 'بقي يومان على اختبارك'], [5, 'بقيت 5 أيام على اختبارك'], [12, 'بقي 12 يومًا على اختبارك']],
  };
  for (const [lang, list] of Object.entries(cases)) {
    await initI18n(lang as 'en');
    for (const [count, expected] of list) assert.equal(i18n.t('planner.daysLeft', { count }), expected);
    for (const a of ['learn', 'review', 'practice', 'exam', 'weak_review'] as const) assert.ok(!i18n.t(`planner.activity.${a}`).includes('planner.'));
    for (const r of ['new_material', 'weak_topic', 'important_topic', 'keep_fresh', 'mock_exam', 'final_review', 'catch_up', 'whole_course'] as const) {
      assert.ok(!i18n.t(`planner.reason.${r}`).includes('planner.'), `${lang} ${r}`);
    }
  }
  await initI18n('en');
});
