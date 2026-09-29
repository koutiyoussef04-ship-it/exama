/**
 * Daily study reminders: at most one a day, at the chosen local time, only when there is something
 * to do (plan tasks, an unfinished exam, weak topics); contextual text in all four languages.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StudyTask } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import { buildReminders, DEFAULT_REMINDER, parseReminderSettings, shiftTime, type ReminderCourse, type ReminderText } from '../src/lib/reminders-core';

const task = (date: string, over: Partial<StudyTask> = {}): StudyTask => ({
  id: `${date}-${Math.random()}`,
  date,
  position: 0,
  topic: 'Photosynthesis',
  activity: 'practice',
  phase: 'learn',
  minutes: 20,
  reason: 'weak_topic',
  mastery: 0.3,
  status: 'pending',
  questionCount: 5,
  examId: null,
  startedAt: null,
  completedAt: null,
  ...over,
});
const course = (over: Partial<ReminderCourse> = {}): ReminderCourse => ({ documentId: 'doc-1', title: 'Biology', plan: null, hasUnfinished: false, hasWeakTopics: false, ...over });
const text: ReminderText = (kind, v) => ({ title: `${kind}:${v.topic}`, body: `${v.course}|${v.minutes}|${v.more}|${v.days}` });
const on = { enabled: true, hour: 18, minute: 30 };
// Monday 2026-10-05 at 09:00 local time.
const now = new Date(2026, 9, 5, 9, 0);

test('off by default and when disabled: nothing is scheduled', () => {
  assert.deepEqual(DEFAULT_REMINDER, { enabled: false, hour: 18, minute: 0 });
  const plan = { examDate: '2026-10-20', tasks: [task('2026-10-05')] };
  assert.deepEqual(buildReminders({ settings: DEFAULT_REMINDER, courses: [course({ plan })], now, text }), []);
});

test('one reminder per day with plan tasks, at the chosen local time; days without tasks are skipped', () => {
  const plan = {
    examDate: '2026-10-20',
    tasks: [
      task('2026-10-05'),
      task('2026-10-05', { topic: 'Cells', minutes: 10 }),
      task('2026-10-06', { status: 'completed' }), // done → nothing to remind
      task('2026-10-08', { topic: 'Respiration' }),
      task('2026-10-09', { status: 'skipped' }),
    ],
  };
  const r = buildReminders({ settings: on, courses: [course({ plan })], now, text });
  assert.deepEqual(r.map((x) => x.date), ['2026-10-05', '2026-10-08']);
  assert.equal(new Set(r.map((x) => x.id)).size, r.length, 'unique id per day (rescheduling replaces, never duplicates)');
  assert.deepEqual([r[0]!.at.getFullYear(), r[0]!.at.getMonth(), r[0]!.at.getDate(), r[0]!.at.getHours(), r[0]!.at.getMinutes()], [2026, 9, 5, 18, 30]);
  assert.deepEqual([r[0]!.title, r[0]!.body, r[0]!.data], ['plan:Photosynthesis', 'Biology|30|1|15', { url: '/plan/doc-1', kind: 'plan' }]);
});

test('the first slot is tomorrow once today’s time has passed; a week ahead at most', () => {
  const tasks = Array.from({ length: 14 }, (_, i) => task(`2026-10-${String(5 + i).padStart(2, '0')}`));
  const evening = new Date(2026, 9, 5, 19, 0);
  const r = buildReminders({ settings: on, courses: [course({ plan: { examDate: '2026-10-30', tasks } })], now: evening, text });
  assert.equal(r[0]!.date, '2026-10-06');
  assert.equal(r.length, 7);
});

test('last days before an exam: "exam coming up"; none after the exam', () => {
  const plan = { examDate: '2026-10-07', tasks: [task('2026-10-05'), task('2026-10-06'), task('2026-10-07', { activity: 'exam', topic: null }), task('2026-10-08')] };
  const r = buildReminders({ settings: on, courses: [course({ plan })], now, text });
  assert.deepEqual(r.map((x) => [x.date, x.data.kind]), [['2026-10-05', 'exam_soon'], ['2026-10-06', 'exam_soon'], ['2026-10-07', 'exam_soon']]);
  assert.equal(r[2]!.title, 'exam_soon:Biology', 'a whole-course task uses the course name');
});

test('several courses: still one reminder a day, about the nearest exam', () => {
  const a = course({ documentId: 'a', title: 'History', plan: { examDate: '2026-11-30', tasks: [task('2026-10-05', { topic: 'Rome' })] } });
  const b = course({ documentId: 'b', title: 'Chemistry', plan: { examDate: '2026-10-10', tasks: [task('2026-10-05', { topic: 'Acids' })] } });
  const r = buildReminders({ settings: on, courses: [a, b], now, text });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0]!.title, r[0]!.data.url, r[0]!.body.split('|')[2]], ['plan:Acids', '/plan/b', '1']);
});

test('no plan: one nudge only if something is ready (unfinished set or weak topics); otherwise nothing', () => {
  assert.deepEqual(buildReminders({ settings: on, courses: [course()], now, text }), []);
  assert.deepEqual(buildReminders({ settings: on, courses: [], now, text }), []);
  const r = buildReminders({ settings: on, courses: [course(), course({ documentId: 'w', title: 'Physics', hasWeakTopics: true })], now, text });
  assert.deepEqual(r.map((x) => [x.date, x.data]), [['2026-10-05', { url: '/documents/w', kind: 'practice' }]]);
});

test('settings are parsed defensively; the time wraps around midnight', () => {
  assert.deepEqual(parseReminderSettings(null), DEFAULT_REMINDER);
  assert.deepEqual(parseReminderSettings('not json'), DEFAULT_REMINDER);
  assert.deepEqual(parseReminderSettings('{"enabled":true,"hour":7,"minute":30}'), { enabled: true, hour: 7, minute: 30 });
  assert.deepEqual(parseReminderSettings('{"enabled":"yes","hour":25,"minute":-1}'), { enabled: false, hour: 18, minute: 0 });
  assert.deepEqual(shiftTime({ hour: 23, minute: 30 }, 30), { hour: 0, minute: 0 });
  assert.deepEqual(shiftTime({ hour: 0, minute: 0 }, -30), { hour: 23, minute: 30 });
});

test('reminder texts render in every language (Arabic plural forms included)', async () => {
  for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
    await initI18n(lang);
    const v = { course: 'Biology', topic: 'Photosynthesis', minutes: 45, more: 2, days: 2 };
    for (const key of ['reminders.planTitle', 'reminders.planBody', 'reminders.exam_soonTitle', 'reminders.exam_soonBody', 'reminders.practiceTitle', 'reminders.practiceBody']) {
      const s = i18n.t(key as 'reminders.planTitle', v);
      assert.ok(s && !s.startsWith('reminders.') && !s.includes('{{'), `${lang} ${key}: ${s}`);
    }
    for (const count of [1, 2, 3, 11, 100]) {
      const s = i18n.t('reminders.planBodyMore', { ...v, count });
      assert.ok(!s.startsWith('reminders.') && !s.includes('{{'), `${lang} planBodyMore(${count}): ${s}`);
    }
  }
  await initI18n('ar');
  assert.match(i18n.t('reminders.planBodyMore', { course: 'Biology', minutes: 45, count: 2 }), /مهمتان/);
});
