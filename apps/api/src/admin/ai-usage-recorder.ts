/**
 * Stores each AI call's reported usage (ai_usage) with a cost ESTIMATE from billing/ai-pricing.ts.
 * Best effort: a failed insert is logged and dropped, never surfaced to the student.
 */
import { AI_PRICING_VERSION, estimateAICostMicroUsd } from '../billing/ai-pricing.js';
import { db } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import type { AIUsageContext, AIUsageReport } from '../ai/usage.js';

let pending: Promise<unknown>[] = [];

export function recordAIUsage(r: AIUsageReport, ctx: AIUsageContext): void {
  const cost = estimateAICostMicroUsd(r.model, r);
  const p = db
    .insert(aiUsage)
    .values({
      userId: ctx.userId,
      organizationId: ctx.organizationId ?? null,
      feature: ctx.feature,
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      latencyMs: Math.max(0, Math.round(r.latencyMs)),
      success: r.success,
      errorCode: r.errorCode,
      estimatedCostMicroUsd: cost,
      pricingVersion: cost === null ? null : AI_PRICING_VERSION,
    })
    .catch((err) => console.error('[ai-usage] could not record usage:', err instanceof Error ? err.message : err));
  pending.push(p);
  void p.finally(() => (pending = pending.filter((x) => x !== p)));
}

/** Tests: wait until recorded rows are written. */
export const flushAIUsage = () => Promise.all(pending);
