/**
 * What each tier can do beyond its usage limits (see `Features` in packages/shared/src/billing.ts).
 * Only the server decides; the apps just show or lock UI from the entitlement they receive.
 *
 *   Free, Basic   PDFs/PowerPoints, exams, practice spread over all topics, even study planner.
 *                 Free also gets ONE lecture (≤ 45 min) per account — Basic gets none.
 *   Trial         the full experience (every feature) under the restricted trial caps.
 *   Student, Pro  + audio/video lectures, weak-topic analysis, adaptive practice, adaptive planner.
 *   Owner         everything.
 *
 * Override without a code change via PLAN_FEATURES_OVERRIDE (JSON, partial), e.g. {"basic":{"weakTopicAnalysis":true}}.
 * A feature that costs money (lectures) also needs a non-zero allowance in the tier's limits.
 */
import { FEATURE_KEYS, TIERS, type Features, type Tier } from '@study/shared';
import { z } from 'zod';
import { config } from '../config.js';

const ALL: Features = { lectures: true, adaptivePractice: true, weakTopicAnalysis: true, adaptivePlanner: true };
const CORE: Features = { lectures: false, adaptivePractice: false, weakTopicAnalysis: false, adaptivePlanner: false };

export const DEFAULT_FEATURES: Record<Tier, Features> = {
  free: { ...CORE, lectures: true }, // one lecture per account: limits in limits.ts, counted per account in entitlements.ts
  trial: ALL,
  basic: CORE,
  student: ALL,
  pro: ALL,
};

export const OWNER_FEATURES: Features = ALL;

const featureFlags = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<keyof Features, z.ZodBoolean>).partial().strict();
const overrideSchema = z.object(Object.fromEntries(TIERS.map((t) => [t, featureFlags])) as Record<Tier, typeof featureFlags>).partial().strict();

function loadFeatures(): Record<Tier, Features> {
  if (!config.PLAN_FEATURES_OVERRIDE) return DEFAULT_FEATURES;
  let parsed: z.infer<typeof overrideSchema>;
  try {
    parsed = overrideSchema.parse(JSON.parse(config.PLAN_FEATURES_OVERRIDE));
  } catch (err) {
    throw new Error(`PLAN_FEATURES_OVERRIDE is not valid JSON of the expected shape: ${err instanceof Error ? err.message : err}`);
  }
  const merged = structuredClone(DEFAULT_FEATURES);
  for (const tier of Object.keys(parsed) as Tier[]) merged[tier] = { ...merged[tier], ...parsed[tier] };
  return merged;
}

export const TIER_FEATURES = loadFeatures();
