/**
 * Product analytics event contract.
 *
 * Privacy rules: properties are ids, counts, scores, durations and fixed categories only.
 * Never add free text (names, emails, file names, PDF text, questions, answers, AI output).
 * Client schemas are strict: unknown properties are rejected by the API.
 */
import { z } from 'zod';
import { PAID_TIERS, planIdSchema, type BillingPeriod, type PaidTier, type PlanId } from './billing';
import { aiLanguageSchema, languageSchema, type AiLanguage } from './languages';
import { MATERIAL_KINDS, MATERIAL_STATUSES, type MaterialFormat, type MaterialKind } from './materials';

const platform = z.enum(['ios', 'android', 'web', 'unknown']);
const count = z.number().int().min(0).max(1_000_000);
/** What made the paywall appear. */
export const paywallTriggerSchema = z.enum([
  'limit_courses',
  'limit_course_uploads',
  'limit_exam_generations',
  'limit_practice_questions',
  'premium_feature',
  'account',
  'courses_banner',
  'trial_ended',
  'limit_study_plans',
  'limit_media_uploads',
  'limit_media_minutes',
  'limit_media_length',
  'locked_lectures', // tapped audio/video on a plan without lectures (Basic)
  'locked_weak_topics', // tapped the locked weak-topic analysis (Free, Basic)
  'free_lecture_used', // a Free user's one lecture is used up (or too long for it)
]);
const paywallTrigger = paywallTriggerSchema;
const billingPeriod = z.enum(['monthly', 'yearly']);
export type PaywallTrigger = z.infer<typeof paywallTriggerSchema>;

/** Events the mobile app may send (things only the client can observe). */
export const clientEventSchema = z.discriminatedUnion('name', [
  z.object({
    name: z.literal('app_opened'),
    properties: z.strictObject({
      platform,
      authenticated: z.boolean(),
      // Optional so older app builds keep working.
      app_language: languageSchema.optional(),
      ai_language: aiLanguageSchema.optional(),
    }),
  }),
  z.object({
    name: z.literal('upload_started'),
    properties: z.strictObject({ platform, file_size_kb: count.optional() }),
  }),
  z.object({
    name: z.literal('upload_failed'),
    properties: z.strictObject({
      platform,
      failure_reason: z.enum(['network', 'too_large', 'not_pdf', 'server', 'unknown']),
    }),
  }),
  z.object({
    name: z.literal('course_opened'),
    properties: z.strictObject({ document_id: z.uuid(), status: z.enum(['processing', 'ready', 'failed']) }),
  }),
  z.object({
    name: z.literal('exam_started'),
    properties: z.strictObject({ exam_id: z.uuid(), document_id: z.uuid(), question_count: count }),
  }),
  z.object({
    name: z.literal('practice_started'),
    properties: z.strictObject({ exam_id: z.uuid(), document_id: z.uuid(), question_count: count }),
  }),
  // Monetization (client-observed). No payment details, ever.
  z.object({
    name: z.literal('paywall_viewed'),
    properties: z.strictObject({ platform, trigger: paywallTrigger }),
  }),
  z.object({
    name: z.literal('plan_selected'),
    // tier/period repeat what plan_id says so reports can group by Basic / Student / Pro directly.
    properties: z.strictObject({ platform, plan_id: planIdSchema, tier: z.enum(PAID_TIERS), period: billingPeriod, trigger: paywallTrigger }),
  }),
  z.object({
    name: z.literal('upgrade_started'),
    properties: z.strictObject({ platform, plan_id: planIdSchema, tier: z.enum(PAID_TIERS), period: billingPeriod, with_trial: z.boolean(), trigger: paywallTrigger }),
  }),
  // Study planner (the plan text itself is never sent).
  z.object({
    name: z.literal('study_plan_setup_started'),
    properties: z.strictObject({ platform, document_id: z.uuid(), editing: z.boolean() }),
  }),
  z.object({
    name: z.literal('study_plan_opened'),
    properties: z.strictObject({ platform, document_id: z.uuid(), days_until_exam: z.number().int().min(-10_000).max(10_000) }),
  }),
  z.object({
    name: z.literal('study_plan_task_started'),
    properties: z.strictObject({ platform, document_id: z.uuid(), activity: z.enum(['learn', 'review', 'practice', 'exam', 'weak_review']) }),
  }),
  // Course materials (lectures / extra PDFs). Never file names or content.
  z.object({
    name: z.literal('material_upload_started'),
    // entry: where the student started — the course screen, or "Add material" on the course list.
    properties: z.strictObject({ platform, document_id: z.uuid(), kind: z.enum(MATERIAL_KINDS), file_size_kb: count.optional(), entry: z.enum(['course', 'home']).optional() }),
  }),
  z.object({
    name: z.literal('material_upload_failed'),
    properties: z.strictObject({
      platform,
      document_id: z.uuid(),
      kind: z.enum(MATERIAL_KINDS),
      failure_reason: z.enum(['network', 'too_large', 'unsupported_format', 'too_long', 'limit', 'server', 'unknown']),
    }),
  }),
  z.object({
    name: z.literal('material_opened'),
    properties: z.strictObject({ platform, document_id: z.uuid(), material_id: z.uuid(), kind: z.enum(MATERIAL_KINDS), status: z.enum(MATERIAL_STATUSES) }),
  }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientEventName = ClientEvent['name'];
export type ClientEventProperties<N extends ClientEventName> = Extract<ClientEvent, { name: N }>['properties'];

export const trackEventsSchema = z.object({
  /** Random per-install id (not tied to any personal data); links pre-login events to a device. */
  anonymousId: z.uuid(),
  events: z.array(clientEventSchema).min(1).max(20),
});
export type TrackEventsInput = z.infer<typeof trackEventsSchema>;

/** Events recorded by the API itself (authoritative; cannot be sent by clients). */
export type ServerEvents = {
  signup_completed: Record<string, never>;
  login_completed: Record<string, never>;
  upload_succeeded: { document_id: string; file_size_kb: number; ai_language: AiLanguage };
  document_processing_completed: {
    document_id: string;
    success: boolean;
    duration_ms: number;
    page_count?: number;
    topic_count?: number;
    /** Detected language of the material (ISO 639-1) and the language the summary was written in. */
    source_language?: string;
    summary_language?: string;
    failure_reason?: string;
  };
  course_deleted: { document_id: string };
  exam_generation_started: { document_id: string; kind: 'standard' | 'follow_up'; question_count: number; language: string };
  exam_generation_completed: {
    document_id: string;
    kind: 'standard' | 'follow_up';
    success: boolean;
    duration_ms: number;
    exam_id?: string;
    question_count?: number;
    focus_topic_count?: number;
    failure_reason?: string;
  };
  exam_completed: CompletedProps;
  practice_completed: CompletedProps;
  // Monetization (server-authoritative). `provider` lets reports exclude mock/test data.
  trial_started: SubscriptionProps;
  /** change: first paid plan (`new`), a higher/lower tier, or the same tier with another billing period. */
  subscription_started: SubscriptionProps & { from_trial: boolean; previous_plan_id?: PlanId; change: 'new' | 'upgrade' | 'downgrade' | 'period_change' };
  subscription_cancelled: SubscriptionProps;
  subscription_expired: SubscriptionProps & { was_trial: boolean };
  subscription_restored: SubscriptionProps;
  // Account lifecycle. Recorded without a user id (the account no longer exists).
  account_deleted: { had_active_subscription: boolean };
  // Study planner — ids, counts and categories only (never the plan text or topic names).
  study_plan_created: StudyPlanProps & { regenerated: boolean; topic_count: number };
  study_plan_task_completed: { document_id: string; activity: string; via: 'manual' | 'exam'; completed_task_count: number; task_count: number };
  study_plan_task_skipped: { document_id: string; activity: string };
  study_plan_recalculated: StudyPlanProps & {
    trigger: 'new_day' | 'task_completed' | 'task_skipped' | 'exam_graded' | 'preferences' | 'manual' | 'materials_changed';
  };
  study_plan_generation_failed: { document_id: string; failure_reason: string; regenerated: boolean };
  // Course materials — ids, sizes, durations, counts and categories only (never transcripts,
  // file names or AI-extracted content).
  /** lecture_allowance: which allowance paid for a lecture — `once` = the Free plan's single lecture. */
  material_processing_started: MaterialProps & {
    format: MaterialFormat;
    file_size_kb: number;
    duration_s?: number;
    reserved_minutes?: number;
    attempt: number;
    lecture_allowance?: 'once' | 'trial' | 'monthly' | 'unlimited';
  };
  material_transcription_completed: MaterialProps & {
    success: boolean;
    provider: string;
    transcription_ms: number;
    duration_s?: number;
    billed_minutes?: number;
    source_language?: string;
    failure_reason?: string;
  };
  material_processing_completed: MaterialProps & {
    processing_ms: number;
    topic_count: number;
    new_topic_count: number;
    chunk_count: number;
    duration_s?: number;
    page_count?: number;
    language: string;
  };
  material_processing_failed: MaterialProps & { stage: 'upload' | 'transcription' | 'analysis'; failure_reason: string; attempt: number };
  material_deleted: MaterialProps & { status: string };
};
type MaterialProps = { material_id: string; document_id: string; kind: MaterialKind };
/**
 * `provider` + `environment` separate real revenue from test data:
 * mock → environment "test"; Apple sandbox/TestFlight → "sandbox"; App Store → "production".
 */
type SubscriptionProps = { plan_id: PlanId; tier: PaidTier; period: BillingPeriod; provider: 'mock' | 'apple' | 'google'; environment: BillingEnvironment };
export type BillingEnvironment = 'test' | 'sandbox' | 'production';
type StudyPlanProps = { document_id: string; days_until_exam: number; study_minutes_per_day: number; task_count: number; language: string };
type CompletedProps = {
  exam_id: string;
  document_id: string;
  question_count: number;
  answered_count: number;
  score_pct: number;
  weak_topic_count: number;
  duration_s: number;
};
export type ServerEventName = keyof ServerEvents;
