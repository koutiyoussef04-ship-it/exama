/**
 * Validates AI-extracted knowledge before it touches a course:
 *  - a topic survives only if its `sourceQuote` really occurs in the material (grounding);
 *  - names matching an existing course topic are snapped to that exact name;
 *  - new topics are capped so a course stays within MAX_COURSE_TOPICS;
 *  - every list and string is bounded; related topics must be known names.
 * The quote also gives each topic a location (seconds into the lecture, or PDF page).
 */
import type { KnowledgeTopic } from '@study/shared';
import type { KnowledgeExtraction } from '../ai/types.js';
import { MaterialIndex, normalizeText } from './grounding.js';

export const MAX_COURSE_TOPICS = 30;
export const MAX_TOPICS_PER_MATERIAL = 10;

export type SourceSegment = { text: string; startSeconds: number | null; page: number | null };

const key = (name: string) => normalizeText(name.normalize('NFKC'));
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
/** Cleans, drops empties and repeats (models sometimes restate the same point), caps the count. */
const list = (items: string[], maxLen: number, maxCount: number) => {
  const seen = new Set<string>();
  return items
    .map((x) => clean(x, maxLen))
    .filter((x) => x && !seen.has(key(x)) && seen.add(key(x)))
    .slice(0, maxCount);
};

export function sanitizeKnowledge(
  raw: KnowledgeExtraction,
  opts: { existingTopics: string[]; segments: SourceSegment[] },
): { summary: string; topics: KnowledgeTopic[]; rejected: number } {
  const index = new MaterialIndex(opts.segments.map((s) => s.text));
  const perSegment = opts.segments.map((s) => ({ s, index: new MaterialIndex([s.text]) }));
  const existing = new Map(opts.existingTopics.map((t) => [key(t), t]));
  const newBudget = Math.max(0, MAX_COURSE_TOPICS - opts.existingTopics.length);

  const seen = new Set<string>();
  const topics: KnowledgeTopic[] = [];
  const relatedHints: string[][] = [];
  let rejected = 0;
  let added = 0;
  for (const t of raw.topics) {
    const name = clean(t.name, 80);
    const k = key(name);
    if (!k || !/\p{L}{2,}/u.test(name) || seen.has(k)) {
      rejected++;
      continue;
    }
    const quote = clean(t.sourceQuote, 400);
    if (!index.contains(quote)) {
      rejected++; // ungrounded: the material doesn't contain the quote
      continue;
    }
    const known = existing.get(k);
    if (!known && added >= newBudget) {
      rejected++;
      continue;
    }
    if (topics.length >= MAX_TOPICS_PER_MATERIAL) break;
    seen.add(k);
    if (!known) added++;
    const where = perSegment.find((p) => p.index.contains(quote, 0.6))?.s;
    topics.push({
      name: known ?? name,
      isNew: !known,
      subtopics: list(t.subtopics, 80, 6),
      keyPoints: list(t.keyPoints, 300, 6),
      definitions: t.definitions
        .map((d) => ({ term: clean(d.term, 80), definition: clean(d.definition, 300) }))
        .filter((d) => d.term && d.definition)
        .slice(0, 6),
      examples: list(t.examples, 300, 4),
      examConcepts: list(t.examConcepts, 200, 5),
      relatedTopics: [],
      sourceQuote: quote,
      startSeconds: where?.startSeconds ?? null,
      page: where?.page ?? null,
    });
    relatedHints.push(t.relatedTopics);
  }

  // Related topics: only names that exist in the course or in this material, never itself.
  const names = new Map([...existing, ...topics.map((t) => [key(t.name), t.name] as const)]);
  topics.forEach((t, i) => {
    t.relatedTopics = [...new Set(relatedHints[i].map((r) => names.get(key(r))).filter((r): r is string => !!r && r !== t.name))].slice(0, 6);
  });
  return { summary: clean(raw.summary, 800), topics, rejected };
}

/** Course topic list: the original PDF's topics, then topics added by materials (deduplicated, capped). */
export function mergeCourseTopics(base: string[], added: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...base, ...added.flat()]) {
    const k = key(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_COURSE_TOPICS) break;
  }
  return out;
}
