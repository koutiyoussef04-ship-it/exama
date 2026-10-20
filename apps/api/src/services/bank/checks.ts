/**
 * Deterministic review checks on a generated question and the passage it was located in. They never
 * approve or reject anything: they produce flags that sort the review queue and tell the reviewer where to
 * look. (The model's own confidence is deliberately not used.)
 */
import type { GeneratedQuestion } from '../../ai/types.js';
import type { ReviewFlag } from '@study/shared';
import { normalizeText } from '../../lib/grounding.js';
import type { Location } from '../sources/locate.js';

const ALL_NONE = /\b(all|none|neither|both)\s+of\s+the\s+above\b|\b(todas|ninguna)\s+(las\s+)?(anteriores|respuestas)\b|\btoutes?\s+les\s+(réponses|précédentes)\b/i;

/** Numbers (incl. years, decimals, percentages) and article references that must come from the source. */
const numbers = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'));

export function reviewFlags(q: GeneratedQuestion, location: Location | null, passage: string | null): ReviewFlag[] {
  const flags = new Set<ReviewFlag>();
  if (!location) flags.add('unlocated');
  else if (location.matchScore < 1) flags.add('fuzzy_quote');

  if (passage) {
    const inPassage = new Set(numbers(passage));
    const missing = numbers(q.correctAnswer).filter((n) => !inPassage.has(n));
    if (missing.length) flags.add('number_not_in_source');
  }

  if (q.type === 'mcq' && q.options) {
    const norm = q.options.map((o) => normalizeText(o));
    const distinct = new Set(norm);
    const containsAnother = norm.some((a, i) => norm.some((b, j) => i !== j && a.length >= 4 && b.includes(a)));
    if (distinct.size !== norm.length || q.options.some((o) => ALL_NONE.test(o)) || containsAnother) flags.add('weak_distractors');
  }
  return [...flags];
}

/** Adds the verifier's verdict (advisory) to the flags. */
export function withVerdict(flags: ReviewFlag[], verdict: 'supported' | 'partial' | 'unsupported' | 'unavailable'): ReviewFlag[] {
  const out = new Set(flags);
  if (verdict === 'partial') out.add('partial');
  if (verdict === 'unsupported') out.add('unsupported');
  if (verdict === 'unavailable') out.add('verifier_unavailable');
  return [...out];
}
