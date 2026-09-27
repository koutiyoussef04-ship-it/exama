/**
 * Study planner service: one plan per course, owned by the course's student.
 *
 *  - AI is used only when a plan is created or explicitly rebuilt (topic importance + focus notes,
 *    one call, counted against `studyPlansPerMonth`). Everything else — the day-by-day schedule,
 *    daily re-planning, adapting to completed/skipped tasks and exam results, preference edits —
 *    is deterministic (planner/schedule.ts) and free.
 *  - Past days are history: unfinished tasks become "missed" and their topics are re-planned into
 *    the remaining days within the same daily limit.
 */
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  MAX_PLAN_DAYS,
  type CreateStudyPlanInput,
  type StudyPlan,
  type StudyPlanNotice,
  type StudyTask,
  type TopicInsight,
  type UpdateStudyPlanInput,
} from '@study/shared';
import { AIError, studyAI } from '../ai/index.js';
import { resolveOutputLanguage } from '../ai/language.js';
import { track } from '../analytics/index.js';
import { getEntitlement, releaseReservation, reserveStudyPlanGeneration } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { documentChunks, studyPlans, studyTasks, topicMastery } from '../db/schema.js';
import { usableChunks } from './chunks.js';
import { HttpError } from '../lib/errors.js';
import { getOwnedDocument } from './documents.js';
import { addDays, diffDays, isValidTimeZone, localDate } from './planner/dates.js';
import { availableDays, buildSchedule, type PlannerTopic } from './planner/schedule.js';

type PlanRow = typeof studyPlans.$inferSelect;
type TaskRow = typeof studyTasks.$inferSelect;
type DocRow = Awaited<ReturnType<typeof getOwnedDocument>>;
type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type Trigger = 'new_day' | 'task_completed' | 'task_skipped' | 'exam_graded' | 'preferences' | 'manual' | 'materials_changed';

const EXCERPT_BUDGET = 20_000;
const REVIEW_ACTIVITIES = new Set(['review', 'weak_review', 'practice']);

// ---------------------------------------------------------------- reads

async function findPlan(userId: string, documentId: string, exec: Tx | typeof db = db): Promise<PlanRow | null> {
  const [row] = await exec.select().from(studyPlans).where(and(eq(studyPlans.documentId, documentId), eq(studyPlans.userId, userId)));
  return row ?? null;
}

async function requirePlan(userId: string, documentId: string): Promise<{ doc: DocRow; plan: PlanRow }> {
  const doc = await getOwnedDocument(userId, documentId); // 404 unless this user owns the course
  const plan = await findPlan(userId, doc.id);
  if (!plan) throw new HttpError(404, 'No study plan for this course yet', 'no_study_plan');
  return { doc, plan };
}

const loadTasks = (planId: string, exec: Tx | typeof db = db) =>
  exec.select().from(studyTasks).where(eq(studyTasks.planId, planId)).orderBy(asc(studyTasks.date), asc(studyTasks.position));

const loadMastery = (userId: string, documentId: string, exec: Tx | typeof db = db) =>
  exec.select().from(topicMastery).where(and(eq(topicMastery.userId, userId), eq(topicMastery.documentId, documentId)));

/** Current state of each course topic, as the scheduler sees it. */
export function topicStates(
  doc: Pick<DocRow, 'topics'>,
  insights: TopicInsight[],
  tasks: Pick<TaskRow, 'topic' | 'activity' | 'status' | 'minutes' | 'completedAt' | 'skippedAt' | 'date'>[],
  mastery: { topic: string; mastery: number; attempts: number; updatedAt: Date }[],
): PlannerTopic[] {
  return doc.topics.map((topic) => {
    const m = mastery.find((r) => r.topic === topic);
    const mine = tasks.filter((t) => t.topic === topic);
    const since = m?.updatedAt ?? new Date(0);
    const reviewedMinutes = mine
      .filter((t) => t.status === 'completed' && REVIEW_ACTIVITIES.has(t.activity) && t.completedAt && t.completedAt > since)
      .reduce((s, t) => s + t.minutes, 0);
    const lastDone = Math.max(0, ...mine.filter((t) => t.status === 'completed' && t.completedAt).map((t) => t.completedAt!.getTime()));
    const catchUp = mine.some(
      (t) => (t.status === 'missed' || t.status === 'skipped') && (t.skippedAt?.getTime() ?? Date.parse(`${t.date}T23:59:59Z`)) > lastDone,
    );
    const importance = insights.find((i) => i.topic === topic)?.importance ?? 2;
    return {
      topic,
      importance,
      mastery: m && m.attempts > 0 ? m.mastery : null,
      learned: (m?.attempts ?? 0) > 0 || mine.some((t) => t.activity === 'learn' && t.status === 'completed'),
      reviewedMinutes,
      catchUp,
    };
  });
}

function toTaskDto(t: TaskRow): StudyTask {
  return {
    id: t.id,
    date: t.date,
    position: t.position,
    topic: t.topic,
    activity: t.activity,
    phase: t.phase,
    minutes: t.minutes,
    reason: t.reason as StudyTask['reason'],
    mastery: t.mastery,
    status: t.status,
    questionCount: t.questionCount,
    examId: t.examId,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

export function planProgress(tasks: Pick<TaskRow, 'status' | 'minutes'>[]): number {
  const done = tasks.filter((t) => t.status === 'completed').reduce((s, t) => s + t.minutes, 0);
  const pending = tasks.filter((t) => t.status === 'pending').reduce((s, t) => s + t.minutes, 0);
  return done + pending === 0 ? 0 : Math.round((done / (done + pending)) * 100) / 100;
}

/**
 * Internal readiness indicator (NOT a prediction): importance-weighted mastery of all course topics
 * (untested = 0), plus a small share for completed preparation. Null until there is a result.
 */
export function planReadiness(states: PlannerTopic[], progress: number): number | null {
  if (!states.some((s) => s.mastery !== null)) return null;
  const weight = states.reduce((s, t) => s + t.importance, 0);
  const masteryPart = states.reduce((s, t) => s + t.importance * (t.mastery ?? 0), 0) / Math.max(weight, 1);
  return Math.round((0.85 * masteryPart + 0.15 * progress) * 100) / 100;
}

/**
 * Planner inputs for the user's plan. Basic/Free get the even planner: every topic the same
 * importance and no mastery (so results never re-prioritise); Student/Pro/trial the adaptive one.
 */
async function plannerInputs(userId: string, insights: TopicInsight[], mastery: Awaited<ReturnType<typeof loadMastery>>, exec: Tx | typeof db = db) {
  const adaptive = (await getEntitlement(userId, exec)).features.adaptivePlanner;
  return adaptive
    ? { adaptive, insights, mastery }
    : { adaptive, insights: insights.map((i): TopicInsight => ({ ...i, importance: EVEN_IMPORTANCE })), mastery: [] as typeof mastery };
}
const EVEN_IMPORTANCE: TopicInsight['importance'] = 2;

function toPlanDto(plan: PlanRow, doc: DocRow, tasks: TaskRow[], states: PlannerTopic[], today: string, input: { adaptive: boolean; insights: TopicInsight[] }): StudyPlan {
  const daysUntilExam = diffDays(today, plan.examDate);
  const notices: StudyPlanNotice[] = [];
  if (daysUntilExam < 0) notices.push('exam_passed');
  if (daysUntilExam === 0) notices.push('exam_today');
  if (doc.topics.length === 0) notices.push('no_topics');
  if (daysUntilExam > 0 && availableDays(plan, today).length === 0) notices.push('no_study_days');
  if (daysUntilExam >= 0 && plan.uncoveredTopics.length) notices.push('not_enough_time');
  if (daysUntilExam > 0 && plan.dailyMinutes < plan.minutesPerDay) notices.push('light_schedule');
  // A lecture/PDF added topics the plan hasn't scheduled yet: offer "Update plan" (never automatic).
  const planned = new Set([...tasks.map((t) => t.topic), ...plan.uncoveredTopics].filter(Boolean));
  if (daysUntilExam > 0 && tasks.length && doc.topics.some((t) => !planned.has(t))) notices.push('new_material');
  const progress = planProgress(tasks);
  return {
    id: plan.id,
    documentId: plan.documentId,
    examDate: plan.examDate,
    examTime: plan.examTime,
    minutesPerDay: plan.minutesPerDay,
    preparedLevel: plan.preparedLevel,
    studyDays: plan.studyDays,
    unavailableDates: plan.unavailableDates,
    timezone: plan.timezone,
    language: plan.language,
    today,
    daysUntilExam,
    dailyMinutes: plan.dailyMinutes,
    progress,
    readiness: planReadiness(states, progress),
    notices,
    uncoveredTopics: daysUntilExam >= 0 ? plan.uncoveredTopics : [],
    topics: input.insights,
    tasks: tasks.map(toTaskDto),
    adaptive: input.adaptive,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- (re)planning

/**
 * Re-plans the future deterministically. Past pending tasks become "missed"; untouched pending tasks
 * from `start` on are replaced. `keepToday` keeps today's list stable after a single task changes.
 */
async function replan(plan: PlanRow, doc: DocRow, trigger: Trigger, now: Date, keepToday: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    // One re-plan per plan at a time (e.g. two devices opening the plan on a new day).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`plan:${plan.id}`}, 0))`);
    const [fresh] = await tx.select().from(studyPlans).where(eq(studyPlans.id, plan.id));
    if (!fresh) return;
    const today = localDate(now, fresh.timezone);
    await tx
      .update(studyTasks)
      .set({ status: 'missed' })
      .where(and(eq(studyTasks.planId, fresh.id), eq(studyTasks.status, 'pending'), lt(studyTasks.date, today)));

    const start = keepToday ? addDays(today, 1) : today;
    await tx
      .delete(studyTasks)
      .where(
        and(
          eq(studyTasks.planId, fresh.id),
          eq(studyTasks.status, 'pending'),
          gte(studyTasks.date, start),
          sql`${studyTasks.startedAt} is null`,
        ),
      );

    const [tasks, rawMastery] = await Promise.all([loadTasks(fresh.id, tx), loadMastery(fresh.userId, doc.id, tx)]);
    const input = await plannerInputs(fresh.userId, fresh.topicInsights, rawMastery, tx);
    const usedOnStart =
      start === today
        ? tasks.filter((t) => t.date === today && (t.status === 'completed' || t.status === 'pending')).reduce((s, t) => s + t.minutes, 0)
        : 0;
    const result = buildSchedule({
      today,
      examDate: fresh.examDate,
      minutesPerDay: fresh.minutesPerDay,
      studyDays: fresh.studyDays,
      unavailableDates: fresh.unavailableDates,
      preparedLevel: fresh.preparedLevel,
      topics: topicStates(doc, input.insights, tasks, input.mastery),
      startDate: start,
      usedMinutesOnStart: usedOnStart,
    });

    const nextPos = new Map<string, number>();
    for (const t of tasks) nextPos.set(t.date, Math.max(nextPos.get(t.date) ?? 0, t.position + 1));
    if (result.tasks.length) {
      await tx.insert(studyTasks).values(
        result.tasks.map((t) => {
          const position = nextPos.get(t.date) ?? 0;
          nextPos.set(t.date, position + 1);
          return { planId: fresh.id, ...t, position };
        }),
      );
    }
    await tx
      .update(studyPlans)
      .set({ dailyMinutes: result.dailyMinutes, uncoveredTopics: result.uncoveredTopics, plannedFor: today, updatedAt: new Date() })
      .where(eq(studyPlans.id, fresh.id));

    void track('study_plan_recalculated', fresh.userId, {
      document_id: doc.id,
      trigger,
      days_until_exam: result.daysUntilExam,
      study_minutes_per_day: fresh.minutesPerDay,
      task_count: result.tasks.length,
      language: fresh.language,
    });
  });
}

async function view(userId: string, doc: DocRow, planId: string, now: Date): Promise<StudyPlan> {
  const [plan] = await db.select().from(studyPlans).where(and(eq(studyPlans.id, planId), eq(studyPlans.userId, userId)));
  if (!plan) throw new HttpError(404, 'No study plan for this course yet', 'no_study_plan');
  const [tasks, rawMastery] = await Promise.all([loadTasks(plan.id), loadMastery(userId, doc.id)]);
  const input = await plannerInputs(userId, plan.topicInsights, rawMastery);
  const today = localDate(now, plan.timezone);
  return toPlanDto(plan, doc, tasks, topicStates(doc, input.insights, tasks, input.mastery), today, input);
}

// ---------------------------------------------------------------- AI step

/** Representative excerpts: an even spread of the course, within budget. */
async function sampleExcerpts(documentId: string): Promise<string[]> {
  const chunks = await db
    .select({ content: documentChunks.content })
    .from(documentChunks)
    .where(usableChunks(documentId))
    .orderBy(asc(documentChunks.position));
  const step = Math.max(1, Math.ceil(chunks.length / 10));
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < chunks.length; i += step) {
    const c = chunks[i].content.slice(0, 4000);
    if (used + c.length > EXCERPT_BUDGET && out.length) break;
    out.push(c);
    used += c.length;
  }
  return out;
}

/** Validates the model's answer: known topics only, importance 1-3, bounded focus text. */
export function sanitizeInsights(topics: string[], raw: { topic: string; importance: number; focus: string }[]): TopicInsight[] {
  return topics.map((topic) => {
    const hit = raw.find((r) => r.topic === topic) ?? raw.find((r) => r.topic.trim().toLowerCase() === topic.toLowerCase());
    const importance = hit && Number.isFinite(hit.importance) ? (Math.min(3, Math.max(1, Math.round(hit.importance))) as 1 | 2 | 3) : 2;
    const focus = hit ? hit.focus.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    return { topic, importance, focus };
  });
}

/** One AI call, charged against the study-plan allowance (released if it fails). */
async function generateInsights(userId: string, doc: DocRow, language: string, regenerated: boolean): Promise<TopicInsight[]> {
  const reservation = await reserveStudyPlanGeneration(userId);
  try {
    if (doc.topics.length === 0) return [];
    const raw = await studyAI.planTopics({ topics: doc.topics, summary: doc.summary ?? '', excerpts: await sampleExcerpts(doc.id), language });
    return sanitizeInsights(doc.topics, raw);
  } catch (err) {
    await releaseReservation(reservation);
    void track('study_plan_generation_failed', userId, {
      document_id: doc.id,
      failure_reason: err instanceof AIError ? `ai_${err.code}` : 'other',
      regenerated,
    });
    throw err;
  }
}

// ---------------------------------------------------------------- validation

function checkDates(today: string, examDate: string) {
  const days = diffDays(today, examDate);
  if (days < 0) throw new HttpError(400, 'The exam date is in the past', 'exam_date_past');
  if (days > MAX_PLAN_DAYS) throw new HttpError(400, `The exam must be within ${MAX_PLAN_DAYS} days`, 'exam_date_too_far', { maxDays: MAX_PLAN_DAYS });
}

const zone = (tz: string | undefined) => (tz && isValidTimeZone(tz) ? tz : 'UTC');

// ---------------------------------------------------------------- commands

export async function getStudyPlan(userId: string, documentId: string, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  // First look on a new day: mark yesterday's leftovers missed and re-plan from today.
  if (plan.plannedFor < localDate(now, plan.timezone)) await replan(plan, doc, 'new_day', now, false);
  return view(userId, doc, plan.id, now);
}

export async function createStudyPlan(userId: string, documentId: string, input: CreateStudyPlanInput & { timezone: string; studyDays: number[]; unavailableDates: string[]; examTime: string | null }, now = new Date()): Promise<StudyPlan> {
  const doc = await getOwnedDocument(userId, documentId);
  if (doc.status !== 'ready') throw new HttpError(409, 'Document is still processing', 'document_processing');
  if (await findPlan(userId, doc.id)) throw new HttpError(409, 'This course already has a study plan', 'study_plan_exists');
  const timezone = zone(input.timezone);
  const today = localDate(now, timezone);
  checkDates(today, input.examDate);

  const language = resolveOutputLanguage(input.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en');
  const insights = await generateInsights(userId, doc, language, false);
  let plan: PlanRow;
  try {
    [plan] = await db
      .insert(studyPlans)
      .values({
        userId,
        documentId: doc.id,
        examDate: input.examDate,
        examTime: input.examTime,
        minutesPerDay: input.minutesPerDay as PlanRow['minutesPerDay'],
        preparedLevel: input.preparedLevel,
        studyDays: input.studyDays,
        unavailableDates: input.unavailableDates.filter((d) => d >= today && d < input.examDate),
        timezone,
        language,
        topicInsights: insights,
        dailyMinutes: input.minutesPerDay,
        plannedFor: today,
      })
      .returning();
  } catch (err) {
    // Two creates racing for the same course: the unique index keeps one.
    if (String((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === '23505') {
      throw new HttpError(409, 'This course already has a study plan', 'study_plan_exists');
    }
    throw err;
  }
  await replan(plan, doc, 'preferences', now, false);
  const dto = await view(userId, doc, plan.id, now);
  void track('study_plan_created', userId, {
    document_id: doc.id,
    days_until_exam: dto.daysUntilExam,
    study_minutes_per_day: dto.minutesPerDay,
    task_count: dto.tasks.length,
    language,
    regenerated: false,
    topic_count: doc.topics.length,
  });
  return dto;
}

/** Edit exam date / time / preferences: deterministic re-plan, no AI call, no usage. */
export async function updateStudyPlan(userId: string, documentId: string, input: UpdateStudyPlanInput, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  const timezone = input.timezone !== undefined ? zone(input.timezone) : plan.timezone;
  const today = localDate(now, timezone);
  const examDate = input.examDate ?? plan.examDate;
  if (input.examDate !== undefined) checkDates(today, examDate);
  const set: Partial<typeof studyPlans.$inferInsert> = { timezone, updatedAt: new Date() };
  if (input.examDate !== undefined) set.examDate = input.examDate;
  if (input.examTime !== undefined) set.examTime = input.examTime;
  if (input.minutesPerDay !== undefined) set.minutesPerDay = input.minutesPerDay as PlanRow['minutesPerDay'];
  if (input.preparedLevel !== undefined) set.preparedLevel = input.preparedLevel;
  if (input.studyDays !== undefined) set.studyDays = [...new Set(input.studyDays)].sort();
  if (input.unavailableDates !== undefined) set.unavailableDates = [...new Set(input.unavailableDates)].filter((d) => d >= today && d < examDate).sort();
  // Changing the AI language only affects the next rebuild (no AI call here).
  if (input.language !== undefined) set.language = resolveOutputLanguage(input.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en');
  const [updated] = await db.update(studyPlans).set(set).where(eq(studyPlans.id, plan.id)).returning();
  await replan(updated, doc, 'preferences', now, false);
  return view(userId, doc, plan.id, now);
}

/** Rebuild: re-run the AI topic analysis (e.g. new language) and re-plan. Counts as a generation. */
export async function regenerateStudyPlan(userId: string, documentId: string, input: { language?: CreateStudyPlanInput['language'] }, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  const language = input.language ? resolveOutputLanguage(input.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en') : plan.language;
  const insights = await generateInsights(userId, doc, language, true);
  const [updated] = await db.update(studyPlans).set({ topicInsights: insights, language, updatedAt: new Date() }).where(eq(studyPlans.id, plan.id)).returning();
  await replan(updated, doc, 'manual', now, false);
  const dto = await view(userId, doc, plan.id, now);
  void track('study_plan_created', userId, {
    document_id: doc.id,
    days_until_exam: dto.daysUntilExam,
    study_minutes_per_day: dto.minutesPerDay,
    task_count: dto.tasks.length,
    language,
    regenerated: true,
    topic_count: doc.topics.length,
  });
  return dto;
}

/** Deterministic re-plan on request (no AI, no usage). */
export async function recalculateStudyPlan(userId: string, documentId: string, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  await replan(plan, doc, 'manual', now, false);
  return view(userId, doc, plan.id, now);
}

/**
 * Course topics changed because a material was removed: re-plan the future (history and today's
 * list are kept) so no task points at a topic the course no longer has. New topics from an added
 * material are NOT scheduled automatically — the plan shows a "new_material" notice instead.
 */
export async function onCourseTopicsChanged(userId: string, documentId: string, now = new Date()): Promise<void> {
  const plan = await findPlan(userId, documentId);
  if (!plan) return;
  const doc = await getOwnedDocument(userId, documentId);
  await replan(plan, doc, 'materials_changed', now, true);
}

export async function deleteStudyPlan(userId: string, documentId: string): Promise<void> {
  const { plan } = await requirePlan(userId, documentId);
  await db.delete(studyPlans).where(eq(studyPlans.id, plan.id));
}

async function requireTask(planId: string, taskId: string): Promise<TaskRow> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new HttpError(404, 'Task not found', 'not_found');
  const [task] = await db.select().from(studyTasks).where(and(eq(studyTasks.id, taskId), eq(studyTasks.planId, planId)));
  if (!task) throw new HttpError(404, 'Task not found', 'not_found');
  return task;
}

/** Mark a task done (no AI call). Today's list stays as it is; later days adapt. */
export async function completeTask(userId: string, documentId: string, taskId: string, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  const task = await requireTask(plan.id, taskId);
  if (task.status === 'completed') return view(userId, doc, plan.id, now);
  if (task.status === 'skipped') throw new HttpError(409, 'This task was skipped', 'task_not_pending');
  await db.update(studyTasks).set({ status: 'completed', completedAt: now }).where(eq(studyTasks.id, task.id));
  await trackCompleted(userId, doc.id, plan.id, task.activity, 'manual');
  await replan(plan, doc, 'task_completed', now, true);
  return view(userId, doc, plan.id, now);
}

/** Skip a task: its topic is re-planned later (never dropped silently). */
export async function skipTask(userId: string, documentId: string, taskId: string, now = new Date()): Promise<StudyPlan> {
  const { doc, plan } = await requirePlan(userId, documentId);
  const task = await requireTask(plan.id, taskId);
  if (task.status !== 'pending' && task.status !== 'missed') throw new HttpError(409, 'Only open tasks can be skipped', 'task_not_pending');
  await db.update(studyTasks).set({ status: 'skipped', skippedAt: now }).where(eq(studyTasks.id, task.id));
  void track('study_plan_task_skipped', userId, { document_id: doc.id, activity: task.activity });
  await replan(plan, doc, 'task_skipped', now, true);
  return view(userId, doc, plan.id, now);
}

async function trackCompleted(userId: string, documentId: string, planId: string, activity: string, via: 'manual' | 'exam') {
  const rows = await db.select({ status: studyTasks.status }).from(studyTasks).where(eq(studyTasks.planId, planId));
  void track('study_plan_task_completed', userId, {
    document_id: documentId,
    activity,
    via,
    completed_task_count: rows.filter((r) => r.status === 'completed').length,
    task_count: rows.length,
  });
}

// ---------------------------------------------------------------- exam integration

/** Validates a task a student starts an exam/practice from (before any AI cost). */
export async function taskForExam(userId: string, documentId: string, taskId: string): Promise<TaskRow> {
  const plan = await findPlan(userId, documentId);
  if (!plan) throw new HttpError(404, 'Task not found', 'not_found');
  const task = await requireTask(plan.id, taskId);
  if (task.status !== 'pending' && task.status !== 'missed') throw new HttpError(409, 'This task is already done', 'task_not_pending');
  if (task.activity !== 'practice' && task.activity !== 'exam') throw new HttpError(400, 'This task has no questions', 'invalid_request');
  return task;
}

export async function linkExamToTask(taskId: string, examId: string, now = new Date()) {
  await db.update(studyTasks).set({ examId, startedAt: now }).where(eq(studyTasks.id, taskId));
}

/**
 * After any exam/practice on a course is graded: complete the task it was started from, then adapt
 * the plan to the new mastery (keeping today's list). Never throws — grading must not fail on it.
 */
export async function onExamGraded(userId: string, documentId: string, examId: string, now = new Date()): Promise<void> {
  try {
    const plan = await findPlan(userId, documentId);
    if (!plan) return;
    const linked = await db
      .update(studyTasks)
      .set({ status: 'completed', completedAt: now })
      .where(and(eq(studyTasks.planId, plan.id), eq(studyTasks.examId, examId), inArray(studyTasks.status, ['pending', 'missed'])))
      .returning({ activity: studyTasks.activity });
    for (const t of linked) await trackCompleted(userId, documentId, plan.id, t.activity, 'exam');
    const doc = await getOwnedDocument(userId, documentId);
    await replan(plan, doc, 'exam_graded', now, true);
  } catch (err) {
    console.error('[study-plan] could not adapt the plan after grading:', err instanceof Error ? err.message : err);
  }
}
