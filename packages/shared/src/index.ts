/**
 * Contract between the mobile app and the API.
 * Request bodies are zod schemas (validated on the server);
 * responses are plain TypeScript types.
 */
import { z } from 'zod';
import { aiLanguageSchema, languageSchema } from './languages';

// ---------- Auth ----------

export const registerSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).max(100),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});
export type LoginInput = z.input<typeof loginSchema>;

export type User = { id: string; email: string; name: string };
export type AuthResponse = { token: string; user: User };

/**
 * Password reset: the API emails a short one-time code (valid 30 min, 5 attempts, single use).
 * `request` always answers 202 — whether the email has an account is never revealed.
 */
export const PASSWORD_RESET_CODE_LENGTH = 6;
export const passwordResetRequestSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  /** App language, for the email. */
  language: languageSchema.optional(),
});
export type PasswordResetRequestInput = z.input<typeof passwordResetRequestSchema>;
export const passwordResetConfirmSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
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
};

export const submitExamSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.uuid(), answer: z.string().max(5000) }))
    .min(1),
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
