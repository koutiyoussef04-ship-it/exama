/**
 * Plan limits — the single place to tune AI usage allowances.
 *
 * Sizing (rough, with the default Claude Sonnet model): processing a 20–40 page PDF ≈ €0.03–0.10,
 * an 8-question exam ≈ €0.02–0.05 incl. grading, a 6-question practice set ≈ €0.02–0.04.
 * A student hitting every monthly cap costs well under their subscription price; revisit these
 * numbers against `npm run analytics:report` and your Anthropic bill once real usage exists.
 *
 * The 7-day free trial is its own tier (`trial`) with deliberately small limits. Its counters
 * cover the WHOLE trial (not a month) and come from the same usage ledger, so deleting a course,
 * reinstalling or signing in again never gives anything back.
 *
 * Override without a code change via PLAN_LIMITS_OVERRIDE (JSON, partial; tiers free/trial/basic/student/pro), e.g.
 *   PLAN_LIMITS_OVERRIDE={"free":{"examGenerationsPerMonth":5},"trial":{"practiceQuestionsPerMonth":10}}
 */
import type { Limits, Tier } from '@study/shared';
import { z } from 'zod';
import { config } from '../config.js';

// studyPlansPerMonth: AI plan generations (create or "rebuild"). Viewing, editing preferences, completing
// tasks and the automatic daily/after-results re-planning are deterministic and never count.
//
// Lectures (audio/video) cost transcription + one Claude extraction each. Estimated at ≈ $0.0035/min
// transcription (AssemblyAI, worst case) + ≈ $0.02–0.12 per lecture for extraction (Claude Sonnet 5,
// $2/$10 per M tokens) — about $0.29–0.33 per hour of lecture. mediaMinutesPerMonth is the cost cap,
// mediaUploadsPerMonth caps the per-file extraction calls, maxMediaMinutesPerFile the longest lecture.
// Free has exactly ONE lecture per account (≤ 45 min) — counted over the account's whole history,
// never renewed (see getEntitlement). Basic has NO lectures (all three media limits are 0).
// Worst case for a free account: one 45-min lecture ≈ $0.22 transcription + ≈ $0.06 extraction.
// Sized so that the YEARLY plans (lowest revenue per month) stay profitable at the cap:
//   Student 300 min ≈ €1.3–1.5/month (of ≈ €7.1 net) · Pro 720 min ≈ €3.2–3.6/month (of ≈ €11.8 net).
// See docs/materials/cost-model.md.
export const DEFAULT_LIMITS: Record<Tier, Limits> = {
  // Enough to experience the loop once or twice: one course, a few exams, a couple of practice sets,
  // and ONE lecture of up to 45 minutes per account (the media limits below are per account for Free).
  free: {
    courses: 1,
    courseUploadsPerMonth: 3,
    examGenerationsPerMonth: 3,
    practiceQuestionsPerMonth: 12,
    maxQuestionsPerExam: 8,
    studyPlansPerMonth: 1,
    mediaUploadsPerMonth: 1,
    mediaMinutesPerMonth: 45,
    maxMediaMinutesPerFile: 45,
  },
  // Free trial — the full experience with totals for the whole trial: 1 course, 1 PDF/PowerPoint,
  // 1 exam of ≤ 8 questions, 5 practice questions, 1 study plan, 1 lecture ≤ 30 min.
  trial: {
    courses: 1,
    courseUploadsPerMonth: 1,
    examGenerationsPerMonth: 1,
    practiceQuestionsPerMonth: 5,
    maxQuestionsPerExam: 8,
    studyPlansPerMonth: 1,
    mediaUploadsPerMonth: 1,
    mediaMinutesPerMonth: 30,
    maxMediaMinutesPerFile: 30,
  },
  // Basic — PDFs and PowerPoints only.
  basic: {
    courses: 8,
    courseUploadsPerMonth: 10,
    examGenerationsPerMonth: 15,
    practiceQuestionsPerMonth: 120,
    maxQuestionsPerExam: 12,
    studyPlansPerMonth: 3,
    mediaUploadsPerMonth: 0,
    mediaMinutesPerMonth: 0,
    maxMediaMinutesPerFile: 0,
  },
  student: {
    courses: 15,
    courseUploadsPerMonth: 30,
    examGenerationsPerMonth: 40,
    practiceQuestionsPerMonth: 300,
    maxQuestionsPerExam: 15,
    studyPlansPerMonth: 10,
    mediaUploadsPerMonth: 30,
    mediaMinutesPerMonth: 300,
    maxMediaMinutesPerFile: 120,
  },
  // Pro — for heavy users: roughly 2.5–4× Student.
  pro: {
    courses: 50,
    courseUploadsPerMonth: 100,
    examGenerationsPerMonth: 150,
    practiceQuestionsPerMonth: 1200,
    maxQuestionsPerExam: 20,
    studyPlansPerMonth: 30,
    mediaUploadsPerMonth: 80,
    mediaMinutesPerMonth: 720,
    maxMediaMinutesPerFile: 180,
  },
};

/**
 * Owner / complimentary access: no monthly caps. Per-request safety bounds still apply
 * (maxQuestionsPerExam by the API schema; maxMediaMinutesPerFile by MEDIA_MAX_MINUTES_PER_FILE).
 */
export const UNLIMITED: Limits = {
  courses: null,
  courseUploadsPerMonth: null,
  examGenerationsPerMonth: null,
  practiceQuestionsPerMonth: null,
  maxQuestionsPerExam: 20,
  studyPlansPerMonth: null,
  mediaUploadsPerMonth: null,
  mediaMinutesPerMonth: null,
  maxMediaMinutesPerFile: config.MEDIA_MAX_MINUTES_PER_FILE,
};

const limitValue = z.number().int().min(0).nullable();
const overrideSchema = z
  .object({
    free: z.record(z.string(), limitValue),
    trial: z.record(z.string(), limitValue),
    basic: z.record(z.string(), limitValue),
    student: z.record(z.string(), limitValue),
    pro: z.record(z.string(), limitValue),
  })
  .partial()
  .strict();

function loadLimits(): Record<Tier, Limits> {
  if (!config.PLAN_LIMITS_OVERRIDE) return DEFAULT_LIMITS;
  let parsed: z.infer<typeof overrideSchema>;
  try {
    parsed = overrideSchema.parse(JSON.parse(config.PLAN_LIMITS_OVERRIDE));
  } catch (err) {
    throw new Error(`PLAN_LIMITS_OVERRIDE is not valid JSON of the expected shape: ${err instanceof Error ? err.message : err}`);
  }
  const merged = structuredClone(DEFAULT_LIMITS);
  for (const tier of Object.keys(parsed) as Tier[]) {
    for (const [key, value] of Object.entries(parsed[tier] ?? {})) {
      if (!(key in merged[tier])) throw new Error(`PLAN_LIMITS_OVERRIDE: unknown limit "${tier}.${key}"`);
      (merged[tier] as Record<string, number | null>)[key] = value;
    }
  }
  return merged;
}

/** No plan may exceed the server-wide hard cap on lecture length. */
function clampToHardCaps(limits: Record<Tier, Limits>): Record<Tier, Limits> {
  const out = structuredClone(limits);
  for (const tier of Object.keys(out) as Tier[]) {
    out[tier].maxMediaMinutesPerFile = Math.min(out[tier].maxMediaMinutesPerFile ?? config.MEDIA_MAX_MINUTES_PER_FILE, config.MEDIA_MAX_MINUTES_PER_FILE);
  }
  return out;
}

export const LIMITS = clampToHardCaps(loadLimits());
