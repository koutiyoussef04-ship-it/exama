/**
 * Onboarding logic, kept pure (no React Native) so it is unit tested: the step-by-step flow, the
 * saved draft, and the few places where the answers change what Exama shows.
 *
 * What each answer is used for today (nothing else reads them):
 *   studyField   stored for product analytics only — Exama does not tailor anything to it yet
 *   examTiming   wording of the "all set" screen; with mainGoal, whether the study plan comes first
 *   mainGoal     with examTiming, whether the study plan is offered before the first exam
 *   materials    the upload type pre-selected in "Add material"; a hint when lectures are the main source
 *   confidence   the "How prepared are you?" default when creating a study plan (still editable)
 * Grading, usage limits and subscriptions never depend on these answers.
 */
import {
  ONBOARDING_QUESTIONS,
  ONBOARDING_STEPS,
  onboardingAnswersSchema,
  type OnboardingAnswers,
  type OnboardingQuestionId,
  type OnboardingState,
  type PreparedLevel,
} from '@study/shared';
import type { MaterialOption } from './material-options';

export const TOTAL_STEPS = ONBOARDING_STEPS.length;

export type Draft = Partial<OnboardingAnswers>;
/** `step` is the index in ONBOARDING_STEPS of the question being shown. */
export type FlowState = { step: number; answers: Draft };

export const initialFlow = (): FlowState => ({ step: 0, answers: {} });

export type FlowAction =
  | { type: 'select'; question: OnboardingQuestionId; value: string }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'restore'; state: FlowState };

export const currentQuestion = (s: FlowState): OnboardingQuestionId => ONBOARDING_STEPS[s.step];
export const isLastStep = (s: FlowState) => s.step === TOTAL_STEPS - 1;
/** A question must be answered before moving on (none is optional). */
export const canContinue = (s: FlowState) => s.answers[currentQuestion(s)] !== undefined;
export const isComplete = (a: Draft): a is OnboardingAnswers => onboardingAnswersSchema.safeParse(a).success;
export const progressParams = (s: FlowState) => ({ current: s.step + 1, total: TOTAL_STEPS });
/** Fraction shown by the progress bar: the question being answered counts as started, not done. */
export const progressFraction = (s: FlowState) => (s.step + 1) / TOTAL_STEPS;

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case 'select': {
      // Only an option of the question on screen counts; anything else is ignored.
      if (a.question !== currentQuestion(s)) return s;
      if (!(ONBOARDING_QUESTIONS[a.question] as readonly string[]).includes(a.value)) return s;
      return { ...s, answers: { ...s.answers, [a.question]: a.value } };
    }
    case 'next':
      return canContinue(s) && !isLastStep(s) ? { ...s, step: s.step + 1 } : s;
    case 'back':
      return s.step > 0 ? { ...s, step: s.step - 1 } : s; // answers are kept
    case 'restore':
      return a.state;
  }
}

// ---------- When to ask ----------

export type OnboardingGate = 'loading' | 'ask' | 'proceed';

/**
 * Decides what the home screen does. Only a new account whose questionnaire is still `pending` is
 * sent to the questions; completed, skipped and older accounts (`none`) go straight to the app. If the
 * state couldn't be read (offline, server error) nobody is blocked — the server keeps it `pending`,
 * so a new account is asked the next time it can be read.
 */
export function onboardingGate(q: { isLoading: boolean; data?: Pick<OnboardingState, 'status'> | undefined }): OnboardingGate {
  if (q.isLoading) return 'loading';
  return q.data?.status === 'pending' ? 'ask' : 'proceed';
}

// ---------- Draft (so a refresh or an interrupted session resumes where the student was) ----------

export const draftKey = (userId: string) => `onboarding_draft_v1_${userId}`;

export const serializeDraft = (s: FlowState) => JSON.stringify({ step: s.step, answers: s.answers });

/**
 * Reads a saved draft defensively: unknown or invalid answers are dropped and the step can never
 * point past the first unanswered question. Anything unreadable gives null (start fresh).
 */
export function parseDraft(raw: string | null): FlowState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { step?: unknown; answers?: unknown };
    const input = data && typeof data.answers === 'object' && data.answers ? (data.answers as Record<string, unknown>) : {};
    const answers: Draft = {};
    for (const q of ONBOARDING_STEPS) {
      const v = input[q];
      if (typeof v === 'string' && (ONBOARDING_QUESTIONS[q] as readonly string[]).includes(v)) (answers as Record<string, string>)[q] = v;
    }
    const firstOpen = ONBOARDING_STEPS.findIndex((q) => answers[q] === undefined);
    const furthest = firstOpen === -1 ? TOTAL_STEPS - 1 : firstOpen;
    const step = typeof data.step === 'number' && Number.isInteger(data.step) ? Math.max(0, Math.min(data.step, furthest)) : furthest;
    return { step, answers };
  } catch {
    return null;
  }
}

// ---------- Personalization ----------

type Answers = OnboardingAnswers | null | undefined;

/** Plan setup: how prepared the student says they are, as the form's starting choice. */
export function preparedLevelDefault(a: Answers): PreparedLevel {
  switch (a?.confidence) {
    case 'not_confident':
      return 'zero';
    case 'fairly':
    case 'very':
      return 'confident';
    default:
      return 'familiar'; // "some topics", skipped, or unknown: the form's usual default
  }
}

/**
 * "Add material": which kind to highlight first. Only a PDF/PowerPoint can start a course, so audio
 * and video (which attach to an existing course) are never pre-selected. Typed or handwritten notes
 * are most often shared as a PDF.
 */
export function preferredMaterialOption(a: Answers): MaterialOption | null {
  switch (a?.materials) {
    case 'pdf':
    case 'notes':
      return 'pdf';
    case 'pptx':
      return 'pptx';
    default:
      return null;
  }
}

/** The first course screen puts the study plan above the first exam when that is what they asked for. */
export const planFirst = (a: Answers): boolean => !!a && a.mainGoal === 'study_plan' && a.examTiming !== 'none_scheduled';

export type DoneAdvice = {
  /** Which sentence the "all set" screen shows. */
  tone: 'soon' | 'later' | 'noExam';
  /** Lectures were named as the main source: remind that a course starts from a PDF or PowerPoint. */
  lecturesNote: boolean;
  /** The study plan will be waiting at the top of the first course. */
  planNote: boolean;
};

export function doneAdvice(a: OnboardingAnswers): DoneAdvice {
  return {
    tone: a.examTiming === 'none_scheduled' ? 'noExam' : a.examTiming === 'within_7_days' || a.examTiming === 'one_to_two_weeks' ? 'soon' : 'later',
    lecturesNote: a.materials === 'audio' || a.materials === 'video',
    planNote: planFirst(a),
  };
}
