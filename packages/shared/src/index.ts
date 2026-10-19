/**
 * Contract between the mobile app and the API.
 * Request bodies are zod schemas (validated on the server);
 * responses are plain TypeScript types.
 */
import { z } from 'zod';
import { normalizeEmail } from './email';
import { aiLanguageSchema, languageSchema } from './languages';
import { marketingConsentSchema } from './marketing-consent';

// ---------- Auth ----------

/** Minimum age to create an Exama account. */
export const MINIMUM_SIGNUP_AGE = 13;
/**
 * Age group stored on an account (a range, never a date of birth) — every group is 13 or over.
 * Stored on the account only: never sent to analytics, never returned in `User`, and never used for
 * prices or usage allowances.
 */
export const AGE_RANGES = ['13_17', '18_24', '25_34', '35_plus'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];
/**
 * Answers to the sign-up age question. It is asked neutrally (every age can be chosen, see FTC COPPA
 * FAQ H.3): "under_13" ends sign-up — the app stops without contacting the server, and the API refuses
 * it (403 age_requirement_not_met) without creating or storing anything.
 */
export const SIGNUP_AGE_ANSWERS = ['under_13', ...AGE_RANGES] as const;
export type SignupAgeAnswer = (typeof SIGNUP_AGE_ANSWERS)[number];

export const registerSchema = z.object({
  email: z.email().transform(normalizeEmail),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).max(100),
  /** App language, for the verification email (optional: older apps don't send it). */
  language: languageSchema.optional(),
  /**
   * Required: proves nothing on its own, but every account must state an age group of 13 or over.
   * (The API answers a missing value with 400 age_range_required — older app versions must update —
   * and "under_13" with 403 age_requirement_not_met, before anything is created.)
   */
  ageRange: z.enum(AGE_RANGES),
  /**
   * Optional marketing-email consent (see marketing-consent.ts). Send it ONLY when the box is ticked. Absent, null or
   * false = no consent recorded; the API records consent for nothing else than an explicit, known version.
   */
  marketingConsent: z.union([marketingConsentSchema, z.literal(false)]).nullish(),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().transform(normalizeEmail),
  password: z.string().min(1),
});
export type LoginInput = z.input<typeof loginSchema>;

export type User = { id: string; email: string; name: string };
export type AuthResponse = { token: string; user: User };

/**
 * After an account is deleted, its email address (normalized with `normalizeEmail`, the sign-in rule)
 * can't be used to sign up again for exactly this many days from the deletion. Register then answers
 * 409 `signup_email_unavailable` with a generic message that doesn't say why. The API keeps only a keyed hash
 * of the address, and only for this period (apps/api/src/services/email-hold.ts).
 */
export const DELETED_EMAIL_HOLD_DAYS = 30;
/** DELETE /auth/me. `emailReusableAt`: when (ISO 8601, UTC) this email can be used to sign up again. */
export type DeleteAccountResult = { hadActiveSubscription: boolean; emailReusableAt: string };

/**
 * Password reset: the API emails a short one-time code (valid 30 min, 5 attempts, single use).
 * `request` always answers 202 — whether the email has an account is never revealed.
 */
export const PASSWORD_RESET_CODE_LENGTH = 6;
export const passwordResetRequestSchema = z.object({
  email: z.email().transform(normalizeEmail),
  /** App language, for the email. */
  language: languageSchema.optional(),
});
export type PasswordResetRequestInput = z.input<typeof passwordResetRequestSchema>;
export const passwordResetConfirmSchema = z.object({
  email: z.email().transform(normalizeEmail),
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${PASSWORD_RESET_CODE_LENGTH}}$`), 'Enter the code from the email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type PasswordResetConfirmInput = z.input<typeof passwordResetConfirmSchema>;

/** Account deletion requires the current password, so a stolen or forgotten-open session can't do it alone. */
export const deleteAccountSchema = z.object({ password: z.string().min(1) });
export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;

// ---------- Documents ----------

export type DocumentStatus = 'processing' | 'ready' | 'failed';

export type DocumentSummary = {
  id: string;
  title: string;
  status: DocumentStatus;
  /** pdf, or pptx (then pageCount counts slides). */
  format: 'pdf' | 'pptx';
  pageCount: number | null;
  createdAt: string;
};

export type DocumentDetail = DocumentSummary & {
  summary: string | null;
  topics: string[];
  /** English, user-safe message (fallback). Apps should translate `errorCode` instead. */
  error: string | null;
  /** Stable processing-failure code: pdf_unreadable | pdf_no_text | pptx_unreadable | pptx_no_text | ai_<code> | processing_failed. */
  errorCode: string | null;
  /** Language the summary and topic names are written in (ISO 639-1), once processed. */
  summaryLanguage: string | null;
  /** Detected main language of the uploaded material (ISO 639-1), when known. */
  sourceLanguage: string | null;
};

// ---------- Exams ----------

export type QuestionType = 'mcq' | 'short_answer';
export type ExamKind = 'standard' | 'follow_up';
export type ExamStatus = 'in_progress' | 'graded';

export const createExamSchema = z.object({
  kind: z.enum(['standard', 'follow_up']).default('standard'),
  questionCount: z.number().int().min(3).max(20).default(8),
  /** Language for questions, answers and feedback. Defaults to the course summary's language. */
  language: aiLanguageSchema.optional(),
  /** Started from a study-plan task: the task is completed when this exam is submitted. */
  studyTaskId: z.uuid().optional(),
  /** Practice on one topic of the course (e.g. a planner task) instead of the weakest topics. */
  focusTopic: z.string().trim().min(1).max(200).optional(),
});
export type CreateExamInput = z.input<typeof createExamSchema>;

export type Question = {
  id: string;
  position: number;
  type: QuestionType;
  topic: string;
  prompt: string;
  options: string[] | null; // MCQ only
};

export type GradedQuestion = Question & {
  correctAnswer: string;
  explanation: string;
  /** Excerpt from the course material that supports the answer. */
  sourceQuote: string;
  userAnswer: string;
  score: number; // 0..1
  isCorrect: boolean;
  feedback: string;
};

export type ExamSummary = {
  id: string;
  documentId: string;
  kind: ExamKind;
  status: ExamStatus;
  score: number | null; // 0..1
  questionCount: number;
  /** Language the questions and feedback are written in (ISO 639-1). */
  language: string;
  createdAt: string;
};

export type Exam = ExamSummary & {
  questions: Question[] | GradedQuestion[];
  /** Seconds the student spent taking the exam (graded exams; null when it was not recorded). */
  durationSeconds?: number | null;
};

/** Longest exam time the app reports (24 h). The app clamps to it, so a forgotten open exam never blocks a submit. */
export const MAX_EXAM_DURATION_SECONDS = 24 * 60 * 60;

export const submitExamSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.uuid(), answer: z.string().max(5000) }))
    .min(1),
  /** Time spent taking the exam, measured by the app (optional: older apps do not send it). */
  durationSeconds: z.number().int().min(0).max(MAX_EXAM_DURATION_SECONDS).optional(),
});
export type SubmitExamInput = z.input<typeof submitExamSchema>;

// ---------- Progress / weaknesses ----------

export type TopicMastery = {
  topic: string;
  mastery: number; // 0..1, recency-weighted
  attempts: number;
  lastScore: number; // 0..1, score on the most recent attempt
};

export type DocumentProgress = {
  documentId: string;
  /** Weak-topic analysis isn't in the user's plan (Basic/Free): `topics`/`weakTopics` are empty. */
  analysisLocked: boolean;
  topics: TopicMastery[]; // weakest first
  weakTopics: string[];
  exams: ExamSummary[];
};

/** Mastery below this counts as a weak area. */
export const WEAK_TOPIC_THRESHOLD = 0.7;

/** Error body. `code` is stable and machine-readable; apps translate it (the `error` text is English). */
export type ApiError = { error: string; code?: string; details?: unknown };
export * from './languages';
export * from './analytics';
export * from './billing';
export * from './study-plan';
export * from './materials';
export * from './onboarding';
export * from './email';
export * from './email-verification';
export * from './marketing-consent';
export * from './flashcards';
export * from './admin';
