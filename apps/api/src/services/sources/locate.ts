/**
 * Locates a supporting quote in ONE passage (text chunk) of the material it was generated from, so a
 * question can carry a real source reference: the chunk (id + content hash), its page or time range and the
 * character offsets of the quote. Pure functions — no database, no AI.
 *
 * The exam checks (`lib/grounding.ts`) only prove that a quote occurs somewhere in the text sent to the model,
 * possibly straddling two chunks. Here a quote must sit inside a single chunk to be "located"; otherwise the
 * item is kept but marked `located: false`, with no page or offsets claimed.
 */
import { createHash } from 'node:crypto';
import { MaterialIndex, normalizeText } from '../../lib/grounding.js';

export type SourceChunk = {
  id: string;
  content: string;
  materialId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
};

export type Location = {
  chunkId: string;
  chunkHash: string;
  materialId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  /** Offsets of the quote inside the chunk content; null when only an approximate match was found. */
  quoteStart: number | null;
  quoteEnd: number | null;
  /** 1 = exact (modulo whitespace/case/punctuation); otherwise the trigram overlap of the best chunk. */
  matchScore: number;
  located: boolean;
};

export const chunkHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

/** Lecture transcripts store 0 as the page range; treat it as "no page". */
const page = (n: number | null) => (n && n > 0 ? n : null);

const stamp = (c: SourceChunk, rest: Pick<Location, 'quoteStart' | 'quoteEnd' | 'matchScore' | 'located'>): Location => ({
  chunkId: c.id,
  chunkHash: chunkHash(c.content),
  materialId: c.materialId,
  pageStart: page(c.pageStart),
  pageEnd: page(c.pageEnd),
  startSeconds: c.startSeconds,
  endSeconds: c.endSeconds,
  ...rest,
});

/**
 * Finds the character range of `quote` in `content`, tolerant of whitespace, case, punctuation and
 * hyphenation differences (the same normalization as the grounding check), or null.
 */
export function findQuoteOffsets(content: string, quote: string): { start: number; end: number } | null {
  const q = normalizeText(quote);
  if (!q) return null;
  // Map each character of the normalized content back to its index in the original.
  const lower = content.toLowerCase();
  const map: number[] = [];
  let norm = '';
  let pendingSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (/[\p{L}\p{N}]/u.test(ch)) {
      if (pendingSpace && norm.length) {
        norm += ' ';
        map.push(i);
      }
      pendingSpace = false;
      norm += ch;
      map.push(i);
    } else if (ch === '-' && /\s/.test(lower[i + 1] ?? '')) {
      // Word hyphenated across a line break: joined, like normalizeText does.
      i++;
      while (i + 1 < lower.length && /\s/.test(lower[i + 1])) i++;
    } else {
      pendingSpace = true;
    }
  }
  // Whole words only: "cell" must not match inside "cells".
  const at = ` ${norm} `.indexOf(` ${q} `);
  if (at === -1) return null;
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return start === undefined || Number.isNaN(end) ? null : { start, end };
}

/**
 * The single chunk that contains the quote, with offsets (exact) or the best approximate chunk (score < 1,
 * no offsets); null when no chunk on its own reaches the grounding threshold.
 */
export function locateQuote(chunks: SourceChunk[], quote: string, minOverlap = 0.8): Location | null {
  // Same minimum as the grounding check: fewer than four words can't identify a passage.
  if (normalizeText(quote).split(' ').filter(Boolean).length < 4) return null;
  for (const c of chunks) {
    const off = findQuoteOffsets(c.content, quote);
    if (off) return stamp(c, { quoteStart: off.start, quoteEnd: off.end, matchScore: 1, located: true });
  }
  // Approximate: the chunk with the highest trigram overlap, if it passes the threshold on its own.
  let best: { chunk: SourceChunk; score: number } | null = null;
  const q = normalizeText(quote).split(' ').filter(Boolean);
  if (q.length < 4) return null;
  const grams = new Set<string>();
  for (let i = 0; i + 2 < q.length; i++) grams.add(`${q[i]} ${q[i + 1]} ${q[i + 2]}`);
  for (const c of chunks) {
    if (!new MaterialIndex([c.content]).contains(quote, minOverlap)) continue;
    const words = normalizeText(c.content).split(' ');
    const have = new Set<string>();
    for (let i = 0; i + 2 < words.length; i++) have.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    const score = [...grams].filter((g) => have.has(g)).length / grams.size;
    if (!best || score > best.score) best = { chunk: c, score };
  }
  return best ? stamp(best.chunk, { quoteStart: null, quoteEnd: null, matchScore: Math.round(best.score * 100) / 100, located: true }) : null;
}
