/**
 * Checks that AI-generated questions are anchored in the uploaded material:
 * each question's "sourceQuote" must actually appear in the text we sent.
 * Tolerant of PDF-extraction noise (case, punctuation, line breaks, hyphenation).
 */
import type { GeneratedQuestion } from '../ai/types.js';

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/-\s+/g, '') // words hyphenated across lines
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const trigrams = (words: string[]) => {
  const out: string[] = [];
  for (let i = 0; i + 2 < words.length; i++) out.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
};

export class MaterialIndex {
  private text: string;
  private grams: Set<string>;
  constructor(excerpts: string[]) {
    this.text = normalizeText(excerpts.join(' '));
    this.grams = new Set(trigrams(this.text.split(' ')));
  }

  /** True if the quote is (almost) verbatim from the material. */
  contains(quote: string, minOverlap = 0.8): boolean {
    const q = normalizeText(quote);
    const words = q.split(' ').filter(Boolean);
    if (words.length < 4) return false;
    if (this.text.includes(q)) return true;
    const g = trigrams(words);
    return g.filter((x) => this.grams.has(x)).length / g.length >= minOverlap;
  }
}

export type RejectReason = 'ungrounded' | 'bad_topic' | 'bad_mcq';

/**
 * Keeps only well-formed, grounded questions and snaps topic names to the allowed list.
 * Returns kept questions plus rejection counts (for logging).
 */
export function validateQuestions(
  questions: GeneratedQuestion[],
  opts: { material: MaterialIndex; allowedTopics: string[] },
) {
  const byLower = new Map(opts.allowedTopics.map((t) => [t.toLowerCase().trim(), t]));
  const rejected: Record<RejectReason, number> = { ungrounded: 0, bad_topic: 0, bad_mcq: 0 };
  const kept: GeneratedQuestion[] = [];

  for (const q of questions) {
    const topic = byLower.get(q.topic.toLowerCase().trim());
    if (!topic) {
      rejected.bad_topic++;
      continue;
    }
    if (q.type === 'mcq') {
      const options = q.options ?? [];
      const unique = new Set(options.map((o) => o.trim().toLowerCase()));
      if (options.length < 3 || unique.size !== options.length || !options.includes(q.correctAnswer)) {
        rejected.bad_mcq++;
        continue;
      }
    }
    if (!opts.material.contains(q.sourceQuote)) {
      rejected.ungrounded++;
      continue;
    }
    kept.push({ ...q, topic });
  }
  return { kept, rejected };
}
