import type { BillingEnvironment, MaterialFormat, MaterialKnowledge, PlanId, PreparedLevel, StudyMinutes, TopicInsight } from '@study/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const documentStatus = pgEnum('document_status', ['processing', 'ready', 'failed']);
export const examKind = pgEnum('exam_kind', ['standard', 'follow_up']);
export const examStatus = pgEnum('exam_status', ['in_progress', 'graded']);
export const questionType = pgEnum('question_type', ['mcq', 'short_answer']);

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/** An uploaded piece of course material (a PDF for now). */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    fileKey: text('file_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pageCount: integer('page_count'),
    status: documentStatus('status').notNull().default('processing'),
    error: text('error'),
    /** Stable failure code (translated by the apps): pdf_unreadable | pdf_no_text | ai_<code> | processing_failed. */
    errorCode: text('error_code'),
    /** Requested AI output language: en | es | fr | ar | source (= same as the material). */
    aiLanguage: text('ai_language').notNull().default('en'),
    /** Language the summary/topics were actually written in (ISO 639-1). */
    summaryLanguage: text('summary_language'),
    /** Detected main language of the material (ISO 639-1). */
    sourceLanguage: text('source_language'),
    summary: text('summary'),
    /** All course topics: the original PDF's topics followed by topics added by materials. */
    topics: jsonb('topics').$type<string[]>().notNull().default([]),
    /** Topics from the original PDF only (so removing a material removes only what it added). */
    baseTopics: jsonb('base_topics').$type<string[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('documents_user_idx').on(t.userId)],
);

export const materialKind = pgEnum('material_kind', ['pdf', 'audio', 'video']);
export const materialStatus = pgEnum('material_status', ['processing', 'transcribing', 'analyzing', 'ready', 'failed']);

/**
 * Extra material added to a course: lecture audio/video or another PDF. Its text lives in
 * document_chunks (material_id set), so exams, practice and the planner use it like the PDF.
 * Raw audio/video is deleted once transcribed (`fileKey` → null, `mediaDeletedAt` set).
 */
export const courseMaterials = pgTable(
  'course_materials',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: materialKind('kind').notNull(),
    format: text('format').$type<MaterialFormat>().notNull(),
    title: text('title').notNull(),
    status: materialStatus('status').notNull().default('processing'),
    /** Stable failure code the apps translate (e.g. media_no_speech, ai_unavailable). */
    errorCode: text('error_code'),
    /** Where processing failed: transcription | analysis (retry resumes from there). */
    failedStage: text('failed_stage').$type<'transcription' | 'analysis'>(),
    attempts: integer('attempts').notNull().default(1),
    /** Stored upload; null once deleted (audio/video after transcription, or purge of failed uploads). */
    fileKey: text('file_key'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationSeconds: integer('duration_seconds'),
    pageCount: integer('page_count'),
    /** Minutes reserved in the usage ledger for transcription (settled to the real length). */
    billedMinutes: integer('billed_minutes').notNull().default(0),
    minutesLedgerId: uuid('minutes_ledger_id'),
    transcriptionProvider: text('transcription_provider'),
    /** Requested notes language (en | es | fr | ar | source) and the one actually used. */
    aiLanguage: text('ai_language').notNull().default('en'),
    language: text('language'),
    sourceLanguage: text('source_language'),
    summary: text('summary'),
    knowledge: jsonb('knowledge').$type<MaterialKnowledge>(),
    /** Course topics this material covers, and the subset it introduced. */
    topics: jsonb('topics').$type<string[]>().notNull().default([]),
    newTopics: jsonb('new_topics').$type<string[]>().notNull().default([]),
    mediaDeletedAt: timestamp('media_deleted_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('course_materials_document_idx').on(t.documentId, t.createdAt),
    index('course_materials_user_status_idx').on(t.userId, t.status),
  ],
);

/** Extracted text, split into ~page-sized pieces used as AI context. */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** PDF pages covered (0 for lecture transcripts). */
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    content: text('content').notNull(),
    /** Set for text that came from an added material (null: the course's original PDF). */
    materialId: uuid('material_id').references(() => courseMaterials.id, { onDelete: 'cascade' }),
    /** Lecture transcripts: time range of this chunk in seconds. */
    startSeconds: integer('start_s'),
    endSeconds: integer('end_s'),
  },
  (t) => [index('chunks_document_idx').on(t.documentId, t.position), index('chunks_material_idx').on(t.materialId)],
);

/** A study session: a generated set of questions the student answers. */
export const exams = pgTable(
  'exams',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: examKind('kind').notNull().default('standard'),
    focusTopics: jsonb('focus_topics').$type<string[]>().notNull().default([]),
    status: examStatus('status').notNull().default('in_progress'),
    /** Language the questions and feedback are written in (ISO 639-1). */
    language: text('language').notNull().default('en'),
    score: real('score'),
    createdAt: createdAt(),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
  },
  (t) => [index('exams_user_document_idx').on(t.userId, t.documentId)],
);

export const questions = pgTable(
  'questions',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: questionType('type').notNull(),
    topic: text('topic').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    correctAnswer: text('correct_answer').notNull(),
    explanation: text('explanation').notNull(),
    sourceQuote: text('source_quote').notNull().default(''),
  },
  (t) => [index('questions_exam_idx').on(t.examId, t.position)],
);

export const answers = pgTable('answers', {
  id: id(),
  questionId: uuid('question_id')
    .notNull()
    .unique()
    .references(() => questions.id, { onDelete: 'cascade' }),
  userAnswer: text('user_answer').notNull(),
  score: real('score').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  feedback: text('feedback').notNull(),
  createdAt: createdAt(),
});

/** Running per-topic mastery for a student on a document. Drives weak-area detection. */
export const topicMastery = pgTable(
  'topic_mastery',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    mastery: real('mastery').notNull(),
    lastScore: real('last_score').notNull(),
    attempts: integer('attempts').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mastery_user_doc_topic_uq').on(t.userId, t.documentId, t.topic)],
);

/**
 * First-party product analytics. One row per event; properties are ids/counts/categories only
 * (see packages/shared/src/analytics.ts). Events survive user deletion but lose the user link.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: id(),
    name: text('name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonymousId: text('anonymous_id'),
    source: text('source').$type<'server' | 'client'>().notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('analytics_name_time_idx').on(t.name, t.createdAt), index('analytics_user_time_idx').on(t.userId, t.createdAt)],
);

// ---------------- Billing ----------------

export const subscriptionStatus = pgEnum('subscription_status', ['trialing', 'active', 'cancelled', 'expired']);

/**
 * A user's current subscription, normalized across billing providers (mock today, Apple later).
 * One row per user; provider events update it. Access is computed from status + dates at read time.
 */
export const subscriptions = pgTable('subscriptions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<'mock' | 'apple' | 'google'>().notNull(),
  planId: text('plan_id').$type<PlanId>().notNull(),
  status: subscriptionStatus('status').notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEndsAt: timestamp('current_period_ends_at', { withTimezone: true }),
  willRenew: boolean('will_renew').notNull().default(true),
  /** Intro offer (free trial) already consumed — Apple allows one per subscription group. */
  trialUsed: boolean('trial_used').notNull().default(false),
  /** Provider reference, e.g. Apple originalTransactionId. Never payment details. */
  providerRef: text('provider_ref'),
  /** test (mock) | sandbox (Apple sandbox/TestFlight) | production — keeps test data out of revenue reports. */
  environment: text('environment').$type<BillingEnvironment>().notNull().default('test'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One store subscription (e.g. Apple originalTransactionId) can belong to one account only.
  uniqueIndex('subscriptions_provider_ref_uq').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
]);

export const usageKind = pgEnum('usage_kind', [
  'course_upload',
  'exam_generation',
  'practice_questions',
  'study_plan_generation',
  'media_upload',
  'media_minutes',
]);

/**
 * Append-only record of AI-costing actions, used for monthly limits.
 * Not tied to documents, so deleting a course doesn't refund usage.
 */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: usageKind('kind').notNull(),
    amount: integer('amount').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index('usage_user_kind_time_idx').on(t.userId, t.kind, t.createdAt)],
);

// ---------------- Study planner ----------------

export const preparedLevel = pgEnum('prepared_level', ['zero', 'familiar', 'confident']);
export const taskActivity = pgEnum('study_task_activity', ['learn', 'review', 'practice', 'exam', 'weak_review']);
export const planPhase = pgEnum('study_plan_phase', ['learn', 'practice', 'test', 'review', 'final']);
export const taskStatus = pgEnum('study_task_status', ['pending', 'completed', 'skipped', 'missed']);

/**
 * One study plan per course: the exam date and the student's preferences. Course content is not
 * copied — tasks reference topics by name; AI-written focus notes per topic live in `topicInsights`.
 */
export const studyPlans = pgTable(
  'study_plans',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    examDate: text('exam_date').notNull(), // YYYY-MM-DD, student's local date
    examTime: text('exam_time'), // HH:MM
    minutesPerDay: integer('minutes_per_day').$type<StudyMinutes>().notNull(),
    preparedLevel: preparedLevel('prepared_level').notNull(),
    studyDays: jsonb('study_days').$type<number[]>().notNull(),
    unavailableDates: jsonb('unavailable_dates').$type<string[]>().notNull().default([]),
    timezone: text('timezone').notNull().default('UTC'),
    /** Language of the AI-written focus notes (ISO 639-1). */
    language: text('language').notNull().default('en'),
    topicInsights: jsonb('topic_insights').$type<TopicInsight[]>().notNull().default([]),
    /** Planned minutes per study day and topics that didn't fit, from the last (re)plan. */
    dailyMinutes: integer('daily_minutes').notNull(),
    uncoveredTopics: jsonb('uncovered_topics').$type<string[]>().notNull().default([]),
    /** Local date the future tasks were last re-planned for (daily re-plan trigger). */
    plannedFor: text('planned_for').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('study_plans_document_uq').on(t.documentId), index('study_plans_user_idx').on(t.userId)],
);

/** A day's tasks. Past tasks are kept as history; future pending tasks are re-planned as results come in. */
export const studyTasks = pgTable(
  'study_tasks',
  {
    id: id(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    position: integer('position').notNull(),
    topic: text('topic'),
    activity: taskActivity('activity').notNull(),
    phase: planPhase('phase').notNull(),
    minutes: integer('minutes').notNull(),
    reason: text('reason').notNull(),
    mastery: real('mastery'),
    questionCount: integer('question_count'),
    status: taskStatus('status').notNull().default('pending'),
    examId: uuid('exam_id').references(() => exams.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('study_tasks_plan_date_idx').on(t.planId, t.date, t.position), index('study_tasks_exam_idx').on(t.examId)],
);
