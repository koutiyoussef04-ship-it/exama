import type { LimitErrorBody, Tier } from '@study/shared';
import { HttpError } from '../lib/errors.js';
import { LIMITS } from './limits.js';

const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const MESSAGES: Record<LimitErrorBody['feature'], (limit: number, tier: Tier) => string> = {
  lectures: (_l, t) => `Audio and video lectures aren't included in the ${label(t)} plan. Upgrade to Student to add lectures.`,
  courses: (l, t) => `Your ${label(t)} plan includes ${s(l, 'course')}. Upgrade to add more.`,
  course_uploads: (l, t) => `You've used this month's ${s(l, 'PDF/PowerPoint upload')} on the ${label(t)} plan.`,
  exam_generations: (l, t) => `You've used this month's ${s(l, 'exam')} on the ${label(t)} plan.`,
  practice_questions: (l, t) => `You've used this month's ${l} practice questions on the ${label(t)} plan.`,
  exam_length: (l, t) => `The ${label(t)} plan allows up to ${l} questions per exam.`,
  study_plans: (l, t) => `You've used this month's ${s(l, 'study plan')} on the ${label(t)} plan.`,
  media_uploads: (l, t) => `You've used this month's ${s(l, 'lecture upload')} on the ${label(t)} plan.`,
  media_minutes: (l, t) => `This lecture is longer than the lecture minutes left this month on the ${label(t)} plan (${l} min per month).`,
  media_length: (l, t) => `The ${label(t)} plan accepts lectures up to ${l} minutes long.`,
};

/** Free lectures are one per ACCOUNT (not per month): their own messages point to Student. */
const FREE_LECTURE_MESSAGES: Partial<Record<LimitErrorBody['feature'], (limit: number) => string>> = {
  media_uploads: () => `You've used your free lecture. Upgrade to Student for ${LIMITS.student.mediaMinutesPerMonth} minutes of lectures every month.`,
  media_minutes: (l) => `Your free lecture can be up to ${l} minutes. Upgrade to Student for ${LIMITS.student.mediaMinutesPerMonth} minutes of lectures every month.`,
  media_length: (l) => `Your free lecture can be up to ${l} minutes long. Upgrade to Student for lectures up to ${LIMITS.student.maxMediaMinutesPerFile} minutes.`,
};

/** The trial is a one-off allowance, so its messages say "trial" rather than "this month". */
const TRIAL_MESSAGES: Record<LimitErrorBody['feature'], (limit: number) => string> = {
  lectures: () => `Lectures aren't available right now. Subscribe to Student to add lectures.`,
  courses: (l) => `Your free trial includes ${s(l, 'course')}. Subscribe to add more courses.`,
  course_uploads: (l) => `Your free trial includes ${s(l, 'PDF/PowerPoint upload')}, and you've used it. Subscribe to upload more material.`,
  exam_generations: (l) => `You've used the ${s(l, 'exam')} included in your free trial. Subscribe to keep generating exams.`,
  practice_questions: (l) => `You've used the ${s(l, 'practice question')} included in your free trial. Subscribe to keep practising your weak topics.`,
  exam_length: (l) => `Exams in the free trial have up to ${l} questions. Subscribe for longer exams.`,
  study_plans: (l) => `Your free trial includes ${s(l, 'study plan')}. Subscribe to create more plans.`,
  media_uploads: (l) => `Your free trial includes ${s(l, 'lecture upload')}. Subscribe to add more lectures.`,
  media_minutes: (l) => `Your free trial includes ${l} minutes of lectures. Subscribe to add longer or more lectures.`,
  media_length: (l) => `Lectures in the free trial can be up to ${l} minutes long. Subscribe for longer lectures.`,
};

const LABELS: Record<Tier, string> = { free: 'Free', trial: 'free trial', basic: 'Basic', student: 'Student', pro: 'Pro' };
const label = (t: Tier) => LABELS[t];

/** 402 Payment Required with a structured body the app uses to open the paywall. */
export class LimitError extends HttpError {
  readonly body: LimitErrorBody;
  constructor(code: LimitErrorBody['code'], feature: LimitErrorBody['feature'], limit: number, used: number, tier: Tier, requested?: number) {
    const free = tier === 'free' ? FREE_LECTURE_MESSAGES[feature] : undefined;
    const message = free ? free(limit) : tier === 'trial' ? TRIAL_MESSAGES[feature](limit) : MESSAGES[feature](limit, tier);
    super(402, message);
    this.body = { error: message, code, feature, limit, used, tier, ...(requested !== undefined ? { requested } : {}) };
  }
}
