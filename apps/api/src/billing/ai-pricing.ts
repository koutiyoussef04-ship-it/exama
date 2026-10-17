/**
 * Prices used to ESTIMATE AI and transcription costs for the admin dashboard. They are not charges:
 * the provider's invoice is the real cost. Update the table AND bump the version when a provider changes
 * its prices or the model changes; each recorded AI call keeps the version it was estimated with, so
 * older estimates are never silently recomputed.
 *
 * Source: provider price pages, as recorded in docs/materials/cost-model.md (checked 2026-09-26).
 */
export const AI_PRICING_VERSION = '2026-09-26';

/** USD per million tokens. A model missing here gets no estimate (shown as "unpriced", never guessed). */
export const AI_MODEL_PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheWritePerMTok?: number }> = {
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
};

/** AssemblyAI pre-recorded transcription, USD per audio minute (Universal-3.5 Pro, the higher of the two models used). */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.0035;

export type TokenCounts = { inputTokens: number | null; outputTokens: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null };

/** Estimated cost in micro-USD (1e-6 USD), or null when the model is unpriced or the provider reported no usage. */
export function estimateAICostMicroUsd(model: string, t: TokenCounts): number | null {
  const p = AI_MODEL_PRICES[model];
  if (!p || t.inputTokens == null || t.outputTokens == null) return null;
  const usd =
    (t.inputTokens * p.inputPerMTok + t.outputTokens * p.outputPerMTok + (t.cacheReadTokens ?? 0) * (p.cacheReadPerMTok ?? p.inputPerMTok) + (t.cacheWriteTokens ?? 0) * (p.cacheWritePerMTok ?? p.inputPerMTok)) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
