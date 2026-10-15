/**
 * Student onboarding: five short questions asked once, right after a new account is created.
 *
 * The answers are stored on the account (GET/PUT /onboarding) and only used where Exama can act on
 * them today — see apps/mobile/src/lib/onboarding.ts for exactly where. Option ids are stable,
 * machine-readable values; the app translates them (onboarding.* strings), the API only validates them.
 * Never add free text here: every answer is a fixed category, so nothing personal can be stored.
 */
import { z } from 'zod';

/** One entry per question, in the order they are asked. `options` order is the display order. */
export const ONBOARDING_QUESTIONS = {
  studyField: ['business', 'tech_engineering', 'health', 'law', 'humanities_social', 'science', 'other'],
  examTiming: ['within_7_days', 'one_to_two_weeks', 'three_to_four_weeks', 'over_a_month', 'none_scheduled'],
  mainGoal: ['understand', 'exams', 'practice', 'weak_topics', 'study_plan'],
  /** What the student usually studies from. Exama reads PDFs, PowerPoints, audio and video lectures. */
  materials: ['pdf', 'pptx', 'audio', 'video', 'notes', 'mix'],
  confidence: ['not_confident', 'some_topics', 'fairly', 'very'],
} as const;

export const ONBOARDING_STEPS = ['studyField', 'examTiming', 'mainGoal', 'materials', 'confidence'] as const;
export type OnboardingQuestionId = (typeof ONBOARDING_STEPS)[number];
export type OnboardingOption<Q extends OnboardingQuestionId> = (typeof ONBOARDING_QUESTIONS)[Q][number];

export const onboardingAnswersSchema = z.strictObject({
  studyField: z.enum(ONBOARDING_QUESTIONS.studyField),
  examTiming: z.enum(ONBOARDING_QUESTIONS.examTiming),
  mainGoal: z.enum(ONBOARDING_QUESTIONS.mainGoal),
  materials: z.enum(ONBOARDING_QUESTIONS.materials),
  confidence: z.enum(ONBOARDING_QUESTIONS.confidence),
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export const saveOnboardingSchema = z.strictObject({ answers: onboardingAnswersSchema });
export type SaveOnboardingInput = z.input<typeof saveOnboardingSchema>;

/**
 * pending   — new account that hasn't answered or skipped yet: the app shows the questions.
 * completed — answered (answers are present).
 * skipped   — dismissed; never asked again.
 * none      — accounts created before onboarding existed: never asked.
 */
export const ONBOARDING_STATUSES = ['pending', 'completed', 'skipped', 'none'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export type OnboardingState = {
  status: OnboardingStatus;
  answers: OnboardingAnswers | null;
  /** When the student completed or skipped it. */
  finishedAt: string | null;
};
