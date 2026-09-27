/**
 * Study-plan scheduler (pure, deterministic): dates, capacity, phases, prioritisation, edge cases.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, diffDays, localDate, weekday } from '../src/services/planner/dates.js';
import { buildSchedule, practiceNeed, type PlannerTopic, type ScheduleInput } from '../src/services/planner/schedule.js';

const TODAY = '2026-09-26'; // a Saturday
const T = (topic: string, importance: 1 | 2 | 3, mastery: number | null, extra: Partial<PlannerTopic> = {}): PlannerTopic => ({
  topic,
  importance,
  mastery,
  learned: mastery !== null,
  reviewedMinutes: 0,
  catchUp: false,
  ...extra,
});
const TOPICS = [T('Demand & Supply', 3, null), T('Elasticity', 2, 0.35), T('Market Structures', 3, null), T('Consumer Choice', 2, 0.92), T('Welfare', 2, null)];

const plan = (over: Partial<ScheduleInput> = {}) =>
  buildSchedule({
    today: TODAY,
    examDate: addDays(TODAY, 12),
    minutesPerDay: 60,
    studyDays: [0, 1, 2, 3, 4, 5, 6],
    unavailableDates: [],
    preparedLevel: 'familiar',
    topics: TOPICS,
    startDate: TODAY,
    usedMinutesOnStart: 0,
    ...over,
  });

const minutesByDay = (tasks: { date: string; minutes: number }[]) => {
  const m = new Map<string, number>();
  for (const t of tasks) m.set(t.date, (m.get(t.date) ?? 0) + t.minutes);
  return m;
};
const minutesByTopic = (tasks: { topic: string | null; minutes: number }[]) => {
  const m = new Map<string, number>();
  for (const t of tasks) if (t.topic) m.set(t.topic, (m.get(t.topic) ?? 0) + t.minutes);
  return m;
};

test('date helpers: local dates by time zone, day arithmetic across DST and month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across the EU DST change
  assert.equal(diffDays('2026-09-26', '2026-10-08'), 12);
  assert.equal(diffDays('2026-10-08', '2026-09-26'), -12);
  assert.equal(weekday('2026-09-26'), 6);
  const now = new Date('2026-09-26T23:30:00Z');
  assert.equal(localDate(now, 'UTC'), '2026-09-26');
  assert.equal(localDate(now, 'Europe/Madrid'), '2026-09-27');
  assert.equal(localDate(now, 'America/Los_Angeles'), '2026-09-26');
  assert.equal(localDate(now, 'Not/AZone'), '2026-09-26', 'unknown zones fall back to UTC');
});

test('every day stays within the daily limit; tasks are whole 5-minute blocks; all topics covered with time', () => {
  for (const minutesPerDay of [30, 60, 120, 180]) {
    const r = plan({ minutesPerDay });
    assert.ok(r.dailyMinutes <= minutesPerDay);
    for (const [, m] of minutesByDay(r.tasks)) assert.ok(m <= r.dailyMinutes, `day of ${m} min > ${r.dailyMinutes}`);
    for (const t of r.tasks) assert.ok(t.minutes >= 10 && t.minutes % 5 === 0, `task of ${t.minutes} min`);
    assert.ok(r.tasks.every((t) => t.date >= TODAY && t.date < addDays(TODAY, 12)), 'only study days before the exam');
  }
  const r = plan({ minutesPerDay: 60 });
  assert.deepEqual(r.uncoveredTopics, []);
  assert.equal(new Set(r.tasks.map((t) => t.topic).filter(Boolean)).size, TOPICS.length);
});

test('phases follow the time available: learn → practice/test → review → final', () => {
  const r = plan({ examDate: addDays(TODAY, 21), minutesPerDay: 60 });
  const first = r.tasks.filter((t) => t.date === TODAY);
  const last = r.tasks.filter((t) => t.date === addDays(TODAY, 20));
  assert.ok(first.some((t) => t.activity === 'learn'), 'starts by learning untested topics');
  assert.ok(last.every((t) => t.phase === 'final' && t.reason === 'final_review'), 'final review on the last day');
  assert.ok(last.every((t) => t.activity !== 'learn'), 'no new material the day before');
  assert.ok(r.tasks.some((t) => t.activity === 'exam' && t.questionCount === 8), 'mock exams');
  assert.ok(r.tasks.some((t) => t.activity === 'practice' && t.questionCount === 5), 'practice questions');
  // Learn tasks come before practice on the same topic.
  for (const topic of ['Demand & Supply', 'Market Structures', 'Welfare']) {
    const firstLearn = r.tasks.find((t) => t.topic === topic && t.activity === 'learn')!.date;
    const firstPractice = r.tasks.find((t) => t.topic === topic && t.activity !== 'learn')?.date;
    if (firstPractice) assert.ok(firstPractice >= firstLearn, topic);
  }
});

test('weak topics get more time; high-mastery topics get light repetition only', () => {
  const r = plan({ examDate: addDays(TODAY, 14) });
  const byTopic = minutesByTopic(r.tasks);
  assert.ok(byTopic.get('Elasticity')! > byTopic.get('Consumer Choice')! * 3, JSON.stringify([...byTopic]));
  assert.ok(r.tasks.some((t) => t.topic === 'Elasticity' && t.reason === 'weak_topic'));
  assert.ok(r.tasks.some((t) => t.topic === 'Consumer Choice' && t.reason === 'keep_fresh'));
  // Same topic, better results → less time planned.
  const weak = T('X', 2, 0.3);
  const strong = T('X', 2, 0.9);
  assert.ok(practiceNeed(weak, 'familiar') > practiceNeed(strong, 'familiar') * 4);
  // Improving an exam result reduces the time planned for it next time.
  const after = plan({ examDate: addDays(TODAY, 14), topics: TOPICS.map((t) => (t.topic === 'Elasticity' ? { ...t, mastery: 0.95 } : t)) });
  assert.ok(minutesByTopic(after.tasks).get('Elasticity')! < byTopic.get('Elasticity')! / 2);
});

test('short windows: tomorrow, exam today, a few days — realistic and prioritised', () => {
  const tomorrow = plan({ examDate: addDays(TODAY, 1), minutesPerDay: 60 });
  assert.deepEqual([...minutesByDay(tomorrow.tasks).keys()], [TODAY]);
  assert.ok(minutesByDay(tomorrow.tasks).get(TODAY)! <= 60);
  assert.equal(tomorrow.tasks[0].topic === 'Elasticity' || tomorrow.tasks.some((t) => t.topic === 'Elasticity'), true, 'weak topic reviewed');
  assert.ok(tomorrow.notices.includes('not_enough_time') && tomorrow.uncoveredTopics.length > 0, 'honest about what does not fit');

  const today = plan({ examDate: TODAY, minutesPerDay: 180 });
  assert.ok(today.notices.includes('exam_today'));
  assert.ok(minutesByDay(today.tasks).get(TODAY)! <= 30, 'only a light look on exam day');
  assert.ok(today.tasks.length > 0 && today.tasks.every((t) => t.phase === 'final' && t.activity !== 'learn'), 'no new material on exam day');

  const four = plan({ examDate: addDays(TODAY, 4), minutesPerDay: 30 });
  assert.ok(four.tasks.every((t) => t.minutes <= 30));
  assert.ok(!four.tasks.some((t) => t.activity === 'exam'), 'no 25-min mock in a 30-min, 4-day plan');
  assert.ok(four.tasks.some((t) => t.topic === 'Elasticity'), 'the proven weak topic is never crowded out');
  const most = [...minutesByTopic(four.tasks)].sort((a, b) => b[1] - a[1])[0][0];
  assert.ok(['Demand & Supply', 'Market Structures', 'Elasticity'].includes(most), `prioritised ${most}`);
});

test('long windows: shorter daily sessions, about weekly mock exams, questions every other day', () => {
  const r = plan({ examDate: addDays(TODAY, 200), minutesPerDay: 180 });
  assert.ok(r.dailyMinutes < 180 && r.dailyMinutes >= 20);
  assert.ok(r.notices.includes('light_schedule'));
  const mocks = r.tasks.filter((t) => t.activity === 'exam').length;
  assert.ok(mocks >= 15 && mocks <= 35, `${mocks} mocks`);
  const practiceDays = r.tasks.filter((t) => t.activity === 'practice').map((t) => t.date);
  for (let i = 1; i < practiceDays.length; i++) assert.ok(diffDays(practiceDays[i - 1], practiceDays[i]) >= 2);
  assert.deepEqual(r.uncoveredTopics, []);
});

test('study days, unavailable dates and no available days', () => {
  const weekdaysOnly = plan({ studyDays: [1, 2, 3, 4, 5], unavailableDates: [addDays(TODAY, 3)] });
  assert.ok(weekdaysOnly.tasks.every((t) => ![0, 6].includes(weekday(t.date)) && t.date !== addDays(TODAY, 3)));
  const none = plan({ examDate: addDays(TODAY, 3), studyDays: [1], unavailableDates: [addDays(TODAY, 2)] }); // only Monday, blocked
  assert.deepEqual(none.tasks, []);
  assert.ok(none.notices.includes('no_study_days'));
  const past = plan({ examDate: addDays(TODAY, -1) });
  assert.deepEqual([past.tasks.length, past.notices], [0, ['exam_passed']]);
});

test('no extracted topics: whole-course sessions', () => {
  const r = plan({ topics: [] });
  assert.ok(r.notices.includes('no_topics'));
  assert.ok(r.tasks.length > 0 && r.tasks.every((t) => t.topic === null));
  assert.ok(r.tasks.every((t) => t.activity !== 'practice'), 'no topic-less practice sets');
});

test('re-planning after missed days keeps the same daily limit and catches up on missed topics', () => {
  const original = plan({ examDate: addDays(TODAY, 10), minutesPerDay: 60 });
  // Two days later, nothing done; Elasticity was missed.
  const later = addDays(TODAY, 2);
  const r = plan({
    today: later,
    startDate: later,
    examDate: addDays(TODAY, 10),
    topics: TOPICS.map((t) => (t.topic === 'Elasticity' ? { ...t, catchUp: true } : t)),
  });
  for (const [, m] of minutesByDay(r.tasks)) assert.ok(m <= 60, 'never "study 7 hours today"');
  assert.ok(r.tasks.every((t) => t.date >= later));
  assert.ok(r.tasks.some((t) => t.topic === 'Elasticity' && t.reason === 'catch_up'));
  assert.ok(r.tasks.length <= original.tasks.length);
  // Minutes already done today reduce today's remaining capacity.
  const partly = plan({ usedMinutesOnStart: 45 });
  assert.ok((minutesByDay(partly.tasks).get(TODAY) ?? 0) <= 15);
  // Keeping today stable: planning starts tomorrow.
  const fromTomorrow = plan({ startDate: addDays(TODAY, 1) });
  assert.ok(fromTomorrow.tasks.every((t) => t.date > TODAY));
});

test('learned topics and completed reviews reduce what is planned', () => {
  const fresh = plan();
  const learned = plan({ topics: TOPICS.map((t) => ({ ...t, learned: true })) });
  assert.ok(!learned.tasks.some((t) => t.activity === 'learn'));
  const reviewed = plan({ topics: TOPICS.map((t) => (t.topic === 'Elasticity' ? { ...t, reviewedMinutes: 200 } : t)) });
  assert.ok(minutesByTopic(reviewed.tasks).get('Elasticity')! < minutesByTopic(fresh.tasks).get('Elasticity')!);
});
