import type {
  AccountType,
  B2BRole,
  AgeRange,
  BankItemStatus,
  BankItemType,
  BillingEnvironment,
  Difficulty,
  FlashcardResult,
  Language,
  LegalRef,
  MarketingConsentInput,
  MarketingConsentSource,
  MaterialFormat,
  MaterialKnowledge,
  OnboardingAnswers,
  OrganizationLimits,
  OrganizationBillingPeriod,
  OrganizationMarket,
  OrganizationPlan,
  OrganizationRole,
  PlanId,
  PreparedLevel,
  ReviewFlag,
  StudyMinutes,
  TopicInsight,
  Verification,
} from '@study/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
  /**
   * Unique PER ACCOUNT TYPE (index below): the same address can have one student account and one organization
   * account — two independent identities with their own password, sessions and data. Every lookup by email
   * names the account type (services/accounts.ts).
   */
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  /** Set when the password changes (reset): sessions issued before it stop working. */
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  /** When the student confirmed their email address (link in the verification email). */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  /** New accounts are asked to confirm their email; accounts created before verification existed are not (false). */
  emailVerificationRequired: boolean('email_verification_required').notNull().default(false),
  /** Age group chosen at sign-up (see AGE_RANGES, all 13+); null for accounts created before it was asked. */
  ageRange: text('age_range').$type<AgeRange>(),
  /** Daily study-plan reminder emails (services/study-reminders.ts). On by default; off via Account or the unsubscribe link. */
  studyReminderEmails: boolean('study_reminder_emails').notNull().default(true),
  /**
   * Explicit, optional consent to marketing email (tips, news, offers, invitations to come back) — a different category from
   * the daily study-plan email above. NULL = no consent: the state of every account that never ticked the box, of every account
   * created before this existed, and of everyone who withdrew. Set only by services/marketing-consent.ts, from an explicit
   * request carrying a known wording version; never inferred from verification, activity or account creation. The four columns
   * are all NULL or all set (check below); the history, including withdrawals, is in `marketing_consent_log`.
   */
  marketingConsentAt: timestamp('marketing_consent_at', { withTimezone: true }),
  /** Version of the wording shown when the consent was given (MARKETING_CONSENT_VERSION). */
  marketingConsentVersion: text('marketing_consent_version'),
  /** Language of the wording shown (en, es, fr, ar): with the version, identifies the exact text. */
  marketingConsentLanguage: text('marketing_consent_language'),
  /** Where it was given: `signup` or `account`. Set by the server. */
  marketingConsentSource: text('marketing_consent_source').$type<MarketingConsentSource>(),
  /**
   * student (the existing app; every account created before organizations existed) or organization
   * (opens the organization workspace). Chosen at sign-up, enforced by the server; access to an
   * organization's data always comes from organization_members, never from this value.
   */
  accountType: text('account_type').$type<AccountType>().notNull().default('student'),
  /**
   * B2B staff role, organization accounts only (check below): `owner` = the B2B owner dashboard and unlimited B2B
   * usage. Granted ONLY by the provisioning command (src/scripts/b2b-owner.ts, run on the server) — never at sign-up,
   * never from an email address. The student owner (OWNER_EMAILS / OWNER_USER_IDS) is a different thing.
   */
  b2bRole: text('b2b_role').$type<B2BRole>(),
}, (t) => [
  uniqueIndex('users_email_account_type_unique').on(t.email, t.accountType),
  check('users_b2b_role_check', sql`${t.b2bRole} is null or (${t.b2bRole} = 'owner' and ${t.accountType} = 'organization')`),
  check('users_age_range_check', sql`${t.ageRange} is null or ${t.ageRange} in ('13_17', '18_24', '25_34', '35_plus')`),
  // All four consent columns are NULL (no consent) or all set with valid values: a half-written or invented consent can't exist.
  check(
    'users_marketing_consent_check',
    sql`(${t.marketingConsentAt} is null and ${t.marketingConsentVersion} is null and ${t.marketingConsentLanguage} is null and ${t.marketingConsentSource} is null)
      or (${t.marketingConsentAt} is not null and ${t.marketingConsentVersion} is not null and ${t.marketingConsentLanguage} in ('en', 'es', 'fr', 'ar') and ${t.marketingConsentSource} in ('signup', 'account'))`,
  ),
  check('users_account_type_check', sql`${t.accountType} in ('student', 'organization')`),
  // Signups over time (admin dashboard).
  index('users_created_idx').on(t.createdAt),
]);

/**
 * Daily study-plan reminder emails: one row per user and local day, claimed BEFORE sending, so retries and
 * overlapping scheduler runs (two API instances, a restart mid-run) can never send the same day twice.
 * Rows older than 14 days are purged.
 */
export const studyReminderEmails = pgTable(
  'study_reminder_emails',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** The student's local date (YYYY-MM-DD) the reminder is for. */
    localDate: text('local_date').notNull(),
    /** claimed → sent | failed | skipped (nothing to send after all). */
    status: text('status').$type<'claimed' | 'sent' | 'failed' | 'skipped'>().notNull().default('claimed'),
    attempts: integer('attempts').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] }), index('study_reminder_emails_updated_idx').on(t.updatedAt)],
);

/**
 * Re-engagement campaign emails (services/reactivation-campaign.ts, run by an operator, never by the server):
 * one row per campaign, step and user, claimed BEFORE sending, so a retry, a second run or two operators can
 * never email the same person the same step twice. Deleting the account deletes its rows.
 */
export const emailCampaignSends = pgTable(
  'email_campaign_sends',
  {
    id: id(),
    campaign: text('campaign').notNull(),
    step: integer('step').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Audience of the email; `unverified` = the one-off verification reminder (services/verification-reminders.ts). */
    segment: text('segment').$type<'has_plan' | 'no_plan' | 'unverified'>().notNull(),
    /** Which version of the email this person got (e.g. exam_upcoming, exam_passed, course_ready, no_course). */
    variant: text('variant').notNull(),
    language: text('language').notNull(),
    /** Where the email's button leads inside the web app (path and query), fixed when the email is sent. */
    target: text('target').notNull(),
    /** claimed → sent | failed (retried by a later run, 3 attempts at most). */
    status: text('status').$type<'claimed' | 'sent' | 'failed'>().notNull().default('claimed'),
    attempts: integer('attempts').notNull().default(1),
    /** Resend's email id, to read delivery status back. */
    providerMessageId: text('provider_message_id'),
    /** Short error code of the last failed attempt (never a message with personal data). */
    error: text('error'),
    batchId: text('batch_id'),
    /** Last event Resend reports for the message: delivered | bounced | complained | delivery_delayed | … */
    deliveryStatus: text('delivery_status'),
    deliverySyncedAt: timestamp('delivery_synced_at', { withTimezone: true }),
    claimedAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('email_campaign_sends_uq').on(t.campaign, t.step, t.userId),
    index('email_campaign_sends_user_idx').on(t.userId),
    index('email_campaign_sends_sent_idx').on(t.sentAt),
  ],
);

/** First-party click tracking of the campaign button (GET /email/click/:sendId): no cookies, no IP, no user agent stored. */
export const emailCampaignClicks = pgTable(
  'email_campaign_clicks',
  {
    id: id(),
    sendId: uuid('send_id').notNull().references(() => emailCampaignSends.id, { onDelete: 'cascade' }),
    /** The click came from a link scanner or preview bot (no or a robot-like user agent): not counted as a person. */
    suspectedBot: boolean('suspected_bot').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('email_campaign_clicks_send_idx').on(t.sendId)],
);

/**
 * Addresses no campaign may email: hard bounces and spam complaints read back from Resend, or added by an
 * operator. Lower-case addresses (see normalizeEmail).
 */
export const emailSuppressions = pgTable('email_suppressions', {
  email: text('email').primaryKey(),
  reason: text('reason').$type<'bounced' | 'complained' | 'manual'>().notNull(),
  createdAt: createdAt(),
});

/**
 * History of marketing-email consent (append only): one row each time consent is granted or withdrawn, with when (server time),
 * which wording version and language, and through what (`signup`, `account` or `unsubscribe_link`). It exists so a consent can be
 * demonstrated and a withdrawal can be shown to have been honoured; the current state is on `users.marketing_consent_*`.
 * No address, no name and no email content. Deleted with the account (cascade).
 */
export const marketingConsentLog = pgTable(
  'marketing_consent_log',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').$type<'granted' | 'withdrawn'>().notNull(),
    /** Wording version and language of the consent that was granted, or that was withdrawn. */
    version: text('version'),
    language: text('language'),
    source: text('source').$type<MarketingConsentSource | 'unsubscribe_link'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('marketing_consent_log_user_idx').on(t.userId, t.createdAt),
    check('marketing_consent_log_action_check', sql`${t.action} in ('granted', 'withdrawn')`),
    check('marketing_consent_log_source_check', sql`${t.source} in ('signup', 'account', 'unsubscribe_link')`),
  ],
);

/**
 * Re-registration hold after account deletion (services/email-hold.ts). One row per recently deleted
 * address, holding only an HMAC (keyed with JWT_SECRET) of the NORMALIZED email — never the address, a
 * name or a user id — and when the hold ends (deletion + DELETED_EMAIL_HOLD_DAYS). Expired rows are
 * ignored at once and purged within hours.
 */
export const deletedEmailHolds = pgTable(
  'deleted_email_holds',
  {
    emailHash: text('email_hash').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('deleted_email_holds_expires_idx').on(t.expiresAt)],
);

/**
 * Email-verification links. Only a keyed hash of the random token is stored. A token works once and
 * for 24 hours; sending a new link expires the older ones.
 */
/**
 * Sign-ups waiting for their email to be confirmed (services/signup.ts). No account exists until the link is
 * opened: then the account (and its organization, onboarding row, marketing consent) is created from this row.
 * One row per registration attempt, each with its own single-use token (only an HMAC is stored); rows expire after
 * 24 hours and are removed a week later.
 */
export const pendingSignups = pgTable(
  'pending_signups',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    accountType: text('account_type').$type<AccountType>().notNull(),
    ageRange: text('age_range').$type<AgeRange>(),
    organizationName: text('organization_name'),
    market: text('market').$type<OrganizationMarket>(),
    marketingConsent: jsonb('marketing_consent').$type<MarketingConsentInput>(),
    language: text('language').$type<Language>().notNull().default('en'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('pending_signups_email_idx').on(t.email, t.createdAt), index('pending_signups_expires_idx').on(t.expiresAt)],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_verification_tokens_user_idx').on(t.userId)],
);

/**
 * Student onboarding (five questions). A row is created with the account, so accounts that predate
 * onboarding have none and are never asked. One row per user: saving again replaces the answers.
 * `answers` holds fixed option ids only (validated by @study/shared) — no free text.
 */
export const userOnboarding = pgTable('user_onboarding', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').$type<'pending' | 'completed' | 'skipped'>().notNull().default('pending'),
  answers: jsonb('answers').$type<OnboardingAnswers>(),
  /** Set when the student completes or skips. */
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-time password-reset codes. Only a keyed hash of the code is stored. A code works once, for
 * 30 minutes and at most 5 attempts; asking for a new code invalidates the older ones.
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_codes_user_idx').on(t.userId)],
);

// ---------------- Organizations (B2B) ----------------

/**
 * A training provider or an oposiciones academy. The tenant of every organization-owned row
 * (courses, question bank, usage). Created by an organization sign-up or by an organization account;
 * deleting one is an owner-only operation, never a cascade from a user.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    market: text('market').$type<OrganizationMarket>().notNull(),
    status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
    /** Commercial plan (billing is manual). New organizations start on the pilot; the owner assigns paid plans. */
    plan: text('plan').$type<OrganizationPlan>().notNull().default('pilot'),
    billingPeriod: text('billing_period').$type<OrganizationBillingPeriod>(),
    /** Pilot only: when it ends. After that no new courses or AI drafts; reading, review and exports keep working. */
    pilotStartedAt: timestamp('pilot_started_at', { withTimezone: true }).notNull().defaultNow(),
    pilotEndsAt: timestamp('pilot_ends_at', { withTimezone: true }),
    /** Owner overrides on top of the plan's allowances (see billing/org-limits.ts). */
    limits: jsonb('limits').$type<Partial<OrganizationLimits>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('organizations_market_check', sql`${t.market} in ('training_provider', 'academy')`),
    check('organizations_plan_check', sql`${t.plan} in ('pilot', 'esencial', 'profesional', 'centro')`),
    check('organizations_billing_period_check', sql`${t.billingPeriod} is null or ${t.billingPeriod} in ('monthly', 'yearly')`),
  ],
);

/** Who belongs to an organization and what they may do there. Leaving or deleting an account removes only the membership. */
export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<OrganizationRole>().notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('organization_members_user_idx').on(t.userId),
    check('organization_members_role_check', sql`${t.role} in ('admin', 'editor', 'reviewer')`),
  ],
);

/**
 * An uploaded piece of course material (a PDF or PowerPoint). Personal course: user_id set, organization_id
 * null. Organization course: organization_id set; user_id is only who uploaded it and becomes null when
 * that account is deleted (the course stays with the organization).
 */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'restrict' }),
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
  (t) => [
    index('documents_user_idx').on(t.userId),
    index('documents_organization_idx').on(t.organizationId, t.createdAt),
    // Lets child tables reference (id, organization_id): a bank item can only point at a course of its own organization.
    uniqueIndex('documents_id_organization_uq').on(t.id, t.organizationId),
    check('documents_owner_check', sql`${t.organizationId} is not null or ${t.userId} is not null`),
  ],
);

/**
 * Every course an account has created (one row per course, kept after the course is deleted). The Free
 * plan's course allowance counts these over the account's whole history, so deleting a course and
 * creating another doesn't get around it. Written in the same transaction as the course (and the plan
 * check), so a refused or failed upload leaves no row. A course whose processing failed and that the
 * student deletes gives its row back (it never became a usable course). Deleted with the account.
 */
export const courseCreations = pgTable(
  'course_creations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The course created (no foreign key: the row outlives the course). */
    documentId: uuid('document_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('course_creations_user_idx').on(t.userId), uniqueIndex('course_creations_document_uq').on(t.documentId)],
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
    /** Who added it. Null once that account is deleted while the course belongs to an organization. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
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
    /** Length of the uploaded recording. Free/trial lectures longer than their allowance are processed up to it only. */
    originalDurationSeconds: integer('original_duration_seconds'),
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
    /** Time the student spent taking the exam, in seconds (reported by the app on submit; null before this was recorded). */
    durationSeconds: integer('duration_seconds'),
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
 * A user's current subscription, normalized across billing providers (mock, Apple, Google Play, Stripe).
 * One row per user; provider events update it. Access is computed from status + dates at read time.
 */
export const subscriptions = pgTable('subscriptions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<'mock' | 'apple' | 'google' | 'stripe'>().notNull(),
  planId: text('plan_id').$type<PlanId>().notNull(),
  status: subscriptionStatus('status').notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEndsAt: timestamp('current_period_ends_at', { withTimezone: true }),
  willRenew: boolean('will_renew').notNull().default(true),
  /** Intro offer (free trial) already consumed — Apple allows one per subscription group. */
  trialUsed: boolean('trial_used').notNull().default(false),
  /** Provider reference: Apple originalTransactionId, Google purchase token, Stripe subscription id (sub_…). Never payment details. */
  providerRef: text('provider_ref'),
  /** test (mock) | sandbox (Apple sandbox/TestFlight) | production — keeps test data out of revenue reports. */
  environment: text('environment').$type<BillingEnvironment>().notNull().default('test'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One store subscription (e.g. Apple originalTransactionId) can belong to one account only.
  uniqueIndex('subscriptions_provider_ref_uq').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
]);

/**
 * The Stripe Customer of an Exama user (web subscriptions). At most one per user (primary key) and one
 * user per Customer (unique), so concurrent checkouts can never create a second Customer for the same
 * account. Holds an identifier only — never card or payment details, which stay with Stripe.
 */
export const stripeCustomers = pgTable('stripe_customers', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  createdAt: createdAt(),
});

/**
 * Stripe webhook events already received (evt_…), so a redelivered event is processed once.
 * `processedAt` stays null while an event is being handled or if handling failed — Stripe retries it.
 */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const usageKind = pgEnum('usage_kind', [
  'course_upload',
  'exam_generation',
  'practice_questions',
  'study_plan_generation',
  'media_upload',
  'media_minutes',
  /** Organizations: AI-generated draft questions (amount = questions kept). */
  'bank_items',
]);

/**
 * Append-only record of AI-costing actions, used for monthly limits.
 * Not tied to documents, so deleting a course doesn't refund usage.
 */
export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: id(),
    /** The student (personal usage), or the staff member who acted for an organization (null once deleted). */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set for organization usage: counts against the organization's allowance, never the person's plan. */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    kind: usageKind('kind').notNull(),
    amount: integer('amount').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_user_kind_time_idx').on(t.userId, t.kind, t.createdAt),
    index('usage_organization_kind_time_idx').on(t.organizationId, t.kind, t.createdAt),
    check('usage_ledger_owner_check', sql`${t.userId} is not null or ${t.organizationId} is not null`),
  ],
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

/**
 * Flashcard decks generated from a course (one row per generation). Reviewed in rounds; the state of
 * the current round lives on each card. Deleted with the course or the account.
 */
export const flashcardDecks = pgTable(
  'flashcard_decks',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    /** Current review round (starts at 1). */
    round: integer('round').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('flashcard_decks_user_document_idx').on(t.userId, t.documentId)],
);

export const flashcards = pgTable(
  'flashcards',
  {
    id: id(),
    deckId: uuid('deck_id').notNull().references(() => flashcardDecks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    topic: text('topic').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    sourceQuote: text('source_quote').notNull(),
    /** Part of the current round. */
    inRound: boolean('in_round').notNull().default(true),
    /** Answer in the current round (null = not reviewed yet). */
    roundResult: text('round_result').$type<FlashcardResult>(),
    /** Most recent answer in any round. */
    lastResult: text('last_result').$type<FlashcardResult>(),
    knownCount: integer('known_count').notNull().default(0),
    practiceCount: integer('practice_count').notNull().default(0),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('flashcards_deck_idx').on(t.deckId),
    check('flashcards_round_result_check', sql`${t.roundResult} is null or ${t.roundResult} in ('known', 'practice')`),
    check('flashcards_last_result_check', sql`${t.lastResult} is null or ${t.lastResult} in ('known', 'practice')`),
  ],
);

// ---------------- Admin / operations ----------------

/**
 * One row per AI provider call (recorded by the provider, best effort): who it was for, which feature,
 * the model and the token counts the provider reported, latency and outcome. Never prompts, answers or
 * course content. `estimated_cost_micro_usd` is an ESTIMATE from the pricing table version stored with
 * it (billing/ai-pricing.ts) — null when the model has no known price. Kept with the account; the user
 * link is cleared when the account is deleted (counts stay for cost reporting).
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the call was made for an organization (cost per customer). */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** document_processing | exam_generation | practice_generation | grading | study_plan | flashcards | material_processing | bank_generation | bank_verification | unknown */
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    success: boolean('success').notNull(),
    /** Provider-neutral error category (AIError code) — never the message. */
    errorCode: text('error_code'),
    estimatedCostMicroUsd: integer('estimated_cost_micro_usd'),
    pricingVersion: text('pricing_version'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_time_idx').on(t.createdAt),
    index('ai_usage_user_time_idx').on(t.userId, t.createdAt),
    index('ai_usage_organization_time_idx').on(t.organizationId, t.createdAt),
  ],
);

/**
 * Owner access to the admin dashboard: who, which endpoint, the (bounded, non-secret) query parameters,
 * the outcome. Refused attempts by non-owners are recorded too. Read-only actions only in this phase.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: id(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    /** The customer looked at, for customer-detail views. */
    targetUserId: uuid('target_user_id'),
    params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
    allowed: boolean('allowed').notNull(),
    status: integer('status'),
    createdAt: createdAt(),
  },
  (t) => [index('admin_audit_time_idx').on(t.createdAt), index('admin_audit_actor_time_idx').on(t.actorUserId, t.createdAt)],
);

// ---------------- Question bank (organizations) ----------------

/**
 * A reusable question owned by an organization. Written as `draft` by the AI (or by hand), reviewed by a
 * person, then approved / rejected / retired. Edits create a new version (see bank_item_revisions) and send
 * the item back to draft. The composite foreign key keeps every item inside its own organization's courses.
 */
export const bankItems = pgTable(
  'bank_items',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    type: questionType('type').notNull(),
    topic: text('topic').notNull(),
    /** Optional unit label staff organize by ("Tema 12", "Module 3"). */
    section: text('section'),
    stem: text('stem').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    correctAnswer: text('correct_answer').notNull(),
    explanation: text('explanation').notNull().default(''),
    difficulty: text('difficulty').$type<Difficulty>(),
    status: text('status').$type<BankItemStatus>().notNull().default('draft'),
    version: integer('version').notNull().default(1),
    origin: text('origin').$type<'ai' | 'manual'>().notNull(),
    /** Server-set review flags (see @study/shared REVIEW_FLAGS). */
    reviewFlags: jsonb('review_flags').$type<ReviewFlag[]>().notNull().default([]),
    /** Advisory verifier result (does the passage support the keyed answer?). Never approves anything. */
    verification: jsonb('verification').$type<Verification>(),
    /** Legal source metadata entered by staff (academy market). */
    legalRef: jsonb('legal_ref').$type<LegalRef>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_items_id_organization_uq').on(t.id, t.organizationId),
    index('bank_items_org_doc_status_idx').on(t.organizationId, t.documentId, t.status),
    index('bank_items_org_topic_idx').on(t.organizationId, t.topic),
    foreignKey({ name: 'bank_items_document_fk', columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId] }).onDelete('cascade'),
    check('bank_items_status_check', sql`${t.status} in ('draft', 'approved', 'rejected', 'retired')`),
    check('bank_items_origin_check', sql`${t.origin} in ('ai', 'manual')`),
    check('bank_items_difficulty_check', sql`${t.difficulty} is null or ${t.difficulty} in ('easy', 'medium', 'hard')`),
  ],
);

/**
 * Where a bank item's supporting quote was found. The chunk id can disappear (a course is reprocessed);
 * the quote, page/time range and chunk hash remain, so the reference can be checked later.
 * `located` false = the quote matched the material only across passages: no page or offsets are claimed.
 */
export const questionSources = pgTable(
  'question_sources',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    bankItemId: uuid('bank_item_id').notNull(),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    materialId: uuid('material_id').references(() => courseMaterials.id, { onDelete: 'set null' }),
    chunkId: uuid('chunk_id').references(() => documentChunks.id, { onDelete: 'set null' }),
    chunkHash: text('chunk_hash').notNull(),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    startSeconds: integer('start_s'),
    endSeconds: integer('end_s'),
    quote: text('quote').notNull(),
    quoteStart: integer('quote_start'),
    quoteEnd: integer('quote_end'),
    matchScore: real('match_score').notNull(),
    located: boolean('located').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('question_sources_item_idx').on(t.bankItemId),
    foreignKey({ name: 'question_sources_item_fk', columns: [t.bankItemId, t.organizationId], foreignColumns: [bankItems.id, bankItems.organizationId] }).onDelete('cascade'),
  ],
);

/** Append-only snapshot of every version of a bank item (what an export delivered can always be reproduced). */
export const bankItemRevisions = pgTable(
  'bank_item_revisions',
  {
    bankItemId: uuid('bank_item_id').notNull().references(() => bankItems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.bankItemId, t.version] })],
);

/** Who did what to a bank item (generated, created, edited, approved, rejected, retired, reopened). */
export const bankItemEvents = pgTable(
  'bank_item_events',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    bankItemId: uuid('bank_item_id').notNull().references(() => bankItems.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    version: integer('version').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('bank_item_events_org_time_idx').on(t.organizationId, t.createdAt), index('bank_item_events_item_idx').on(t.bankItemId)],
);
