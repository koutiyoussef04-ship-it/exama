/**
 * Study planner contract: a day-by-day plan from today to the exam, adapted to the student's results.
 * Dates are the student's local calendar dates ("YYYY-MM-DD"); the server works out "today" from
 * the plan's IANA time zone.
 */
import { z } from 'zod';
import { aiLanguageSchema } from './languages';

export const STUDY_MINUTES_OPTIONS = [30, 60, 120, 180] as const;
export type StudyMinutes = (typeof STUDY_MINUTES_OPTIONS)[number];

export const PREPARED_LEVELS = ['zero', 'familiar', 'confident'] as const;
export type PreparedLevel = (typeof PREPARED_LEVELS)[number];

export const TASK_ACTIVITIES = ['learn', 'review', 'practice', 'exam', 'weak_review'] as const;
export type TaskActivity = (typeof TASK_ACTIVITIES)[number];

export const PLAN_PHASES = ['learn', 'practice', 'test', 'review', 'final'] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

/** missed = a past day's task that wasn't done (its topic is re-planned, never silently dropped). */
export const TASK_STATUSES = ['pending', 'completed', 'skipped', 'missed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Why a task is in the plan (translated by the app). */
export const TASK_REASONS = [
  'new_material', // not studied yet
  'weak_topic', // low mastery in exams/practice
  'important_topic', // central to the course
  'keep_fresh', // good mastery: light maintenance
  'mock_exam', // exam-style check
  'final_review', // last days before the exam
  'catch_up', // re-planned after a missed/skipped task
  'whole_course', // course without extracted topics
] as const;
export type TaskReason = (typeof TASK_REASONS)[number];

/** Longest supported preparation window. */
export const MAX_PLAN_DAYS = 365;
/** Questions in a planner practice task / mock exam (they use the normal practice/exam allowance). */
export const PLAN_PRACTICE_QUESTIONS = 5;
export const PLAN_EXAM_QUESTIONS = 8;

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealDate, 'Not a real date');

const minutesSchema = z
  .number()
  .int()
  .refine((m) => (STUDY_MINUTES_OPTIONS as readonly number[]).includes(m), 'Choose 30, 60, 120 or 180 minutes');

const prefsShape = {
  examDate: isoDateSchema,
  /** Optional "HH:MM" (24 h). */
  examTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .nullable(),
  minutesPerDay: minutesSchema,
  preparedLevel: z.enum(PREPARED_LEVELS),
  /** Weekdays the student can study: 0 = Sunday … 6 = Saturday. */
  studyDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Choose at least one study day')
    .max(7)
    .transform((d) => [...new Set(d)].sort()),
  unavailableDates: z
    .array(isoDateSchema)
    .max(MAX_PLAN_DAYS)
    .transform((d) => [...new Set(d)].sort()),
  /** IANA time zone of the student's device, e.g. "Europe/Madrid". */
  timezone: z.string().trim().min(1).max(64),
  /** Language for the AI-written parts (topic focus notes). Defaults to the course language. */
  language: aiLanguageSchema,
};

export const createStudyPlanSchema = z.object({
  ...prefsShape,
  examTime: prefsShape.examTime.optional().default(null),
  studyDays: prefsShape.studyDays.optional().default([0, 1, 2, 3, 4, 5, 6]),
  unavailableDates: prefsShape.unavailableDates.optional().default([]),
  timezone: prefsShape.timezone.optional().default('UTC'),
  language: prefsShape.language.optional(),
});
export type CreateStudyPlanInput = z.input<typeof createStudyPlanSchema>;

/** Editing preferences re-plans deterministically (no AI call, no usage). */
export const updateStudyPlanSchema = z.object(prefsShape).partial().strict();
export type UpdateStudyPlanInput = z.input<typeof updateStudyPlanSchema>;

export type StudyTask = {
  id: string;
  date: string;
  position: number;
  /** null = the whole course (mock exams, courses without topics). */
  topic: string | null;
  activity: TaskActivity;
  phase: PlanPhase;
  minutes: number;
  reason: TaskReason;
  /** Mastery (0..1) of the topic when the task was planned, if tested. */
  mastery: number | null;
  status: TaskStatus;
  /** For practice/exam tasks: questions to generate when started. */
  questionCount: number | null;
  /** Exam/practice created from this task (it completes the task when submitted). */
  examId: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type TopicInsight = {
  topic: string;
  /** 1 = minor, 2 = normal, 3 = central to the course. */
  importance: 1 | 2 | 3;
  /** One or two sentences on what to focus on, in the plan language (AI-written, from the material). */
  focus: string;
};

export type StudyPlanNotice =
  | 'not_enough_time' // uncoveredTopics can't all fit: weakest/most important first
  | 'no_study_days' // no available day left before the exam
  | 'no_topics' // course has no extracted topics: whole-course tasks
  | 'exam_today'
  | 'exam_passed'
  | 'light_schedule' // plenty of time: shorter daily sessions than the maximum
  | 'new_material'; // the course gained topics (e.g. a new lecture) that the plan hasn't scheduled yet

export type StudyPlan = {
  id: string;
  documentId: string;
  examDate: string;
  examTime: string | null;
  minutesPerDay: StudyMinutes;
  preparedLevel: PreparedLevel;
  studyDays: number[];
  unavailableDates: string[];
  timezone: string;
  /** Language of the AI-written parts (ISO 639-1). */
  language: string;
  /** The student's local date the plan was computed for. */
  today: string;
  /** 0 = exam today, negative = exam passed. */
  daysUntilExam: number;
  /** Planned minutes per study day (≤ minutesPerDay; lower when there is plenty of time). */
  dailyMinutes: number;
  /** Completed share of the plan's work (0..1). */
  progress: number;
  /** Internal indicator from mastery + completed preparation (0..1); null until there are results. Not a prediction. */
  readiness: number | null;
  notices: StudyPlanNotice[];
  /** Topics that don't fit in the remaining time (lowest priority first dropped). */
  uncoveredTopics: string[];
  topics: TopicInsight[];
  tasks: StudyTask[];
  /**
   * Adaptive planner (Student, Pro, trial): topics are prioritised by importance and the student's
   * mastery, and the plan re-prioritises after each result. False (Basic, Free): topics are spread
   * evenly, results don't change priorities, and there is no readiness indicator.
   */
  adaptive: boolean;
  createdAt: string;
  updatedAt: string;
};
