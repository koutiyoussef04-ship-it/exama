/**
 * Who and what an AI call is for. Callers wrap a StudyAI call in `withAIUsage({ userId, feature }, fn)`;
 * the provider reads the context when it reports usage (AsyncLocalStorage, so nothing has to be threaded
 * through the StudyAI interface). A call without a context is recorded with feature "unknown".
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const AI_FEATURES = ['document_processing', 'exam_generation', 'practice_generation', 'grading', 'study_plan', 'flashcards', 'material_processing', 'bank_generation', 'bank_verification', 'unknown'] as const;
export type AIFeature = (typeof AI_FEATURES)[number];
/** `organizationId`: set when the call is made for an organization (its cost is then attributed to it). */
export type AIUsageContext = { userId: string | null; feature: AIFeature; organizationId?: string | null };

const store = new AsyncLocalStorage<AIUsageContext>();

export const withAIUsage = <T>(ctx: AIUsageContext, fn: () => Promise<T>): Promise<T> => store.run(ctx, fn);
export const currentAIUsage = (): AIUsageContext => store.getStore() ?? { userId: null, feature: 'unknown' };

/** What a provider reports after each call (successful or not). Token counts are null when the provider gave none. */
export type AIUsageReport = {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
};
export type AIUsageSink = (report: AIUsageReport, ctx: AIUsageContext) => void;
