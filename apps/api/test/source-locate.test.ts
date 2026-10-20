/**
 * Source locator (services/sources/locate.ts): a quote is placed in ONE chunk with offsets, page/time range
 * and a content hash; approximate matches keep the chunk but no offsets; a quote that only exists across two
 * chunks is not located (no page is ever guessed). Pure functions, no database.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkHash, findQuoteOffsets, locateQuote, type SourceChunk } from '../src/services/sources/locate.js';
import { giftEscape, sourceLabel, toCsv, toGift } from '../src/services/bank/export.js';
import { reviewFlags } from '../src/services/bank/checks.js';

const chunk = (id: string, content: string, extra: Partial<SourceChunk> = {}): SourceChunk => ({
  id,
  content,
  materialId: null,
  pageStart: 1,
  pageEnd: 1,
  startSeconds: null,
  endSeconds: null,
  ...extra,
});

const c1 = chunk('c1', 'Mitosis is the division of a cell nucleus.\nIt produces two identical daughter cells with the same chromo-\nsome number as the parent.', { pageStart: 3, pageEnd: 4 });
const c2 = chunk('c2', 'Meiosis halves the chromosome number. Gametes are formed by meiosis in the reproductive organs of animals and in the flowers of plants.', { pageStart: 5, pageEnd: 5 });
const lecture = chunk('c3', 'The lecturer says: photosynthesis takes place in the chloroplasts of plant cells.', { pageStart: 0, pageEnd: 0, startSeconds: 200, endSeconds: 260, materialId: '00000000-0000-0000-0000-000000000001' });

test('exact quote: offsets, page range and hash; punctuation, case and a line-break hyphen are tolerated', () => {
  const loc = locateQuote([c1, c2], 'two identical daughter cells with the same chromosome number');
  assert.ok(loc && loc.located);
  assert.equal(loc.chunkId, 'c1');
  assert.deepEqual([loc.pageStart, loc.pageEnd], [3, 4]);
  assert.equal(loc.matchScore, 1);
  assert.equal(loc.chunkHash, chunkHash(c1.content));
  assert.ok(loc.quoteStart !== null && loc.quoteEnd !== null);
  assert.equal(c1.content.slice(loc.quoteStart, loc.quoteEnd), 'two identical daughter cells with the same chromo-\nsome number');
  const off = findQuoteOffsets(c1.content, 'MITOSIS IS THE DIVISION, of a cell nucleus');
  assert.deepEqual(off, { start: 0, end: 'Mitosis is the division of a cell nucleus'.length });
});

test('lecture chunk: time range instead of pages', () => {
  const loc = locateQuote([c1, lecture], 'photosynthesis takes place in the chloroplasts of plant cells');
  assert.ok(loc?.located);
  assert.deepEqual([loc.pageStart, loc.pageEnd, loc.startSeconds, loc.endSeconds, loc.materialId], [null, null, 200, 260, lecture.materialId]);
});

test('approximate quote (one word off): the right chunk, a score below 1 and no offsets', () => {
  const loc = locateQuote([c1, c2], 'Meiosis halves the chromosome count. Gametes are formed by meiosis in the reproductive organs of animals and in the flowers of plants');
  assert.ok(loc?.located);
  assert.equal(loc.chunkId, 'c2');
  assert.ok(loc.matchScore < 1 && loc.matchScore >= 0.8, String(loc.matchScore));
  assert.equal(loc.quoteStart, null);
});

test('a quote that spans two chunks, or is not in the material, is not located', () => {
  assert.equal(locateQuote([c1, c2], 'same chromosome number as the parent. Meiosis halves the chromosome number'), null);
  assert.equal(locateQuote([c1, c2], 'the Krebs cycle happens in the mitochondrial matrix of every cell'), null);
  assert.equal(locateQuote([c1], 'cell'), null, 'too short to mean anything');
});

test('review flags: unlocated, fuzzy, numbers missing from the passage, weak distractors', () => {
  const q = { type: 'mcq' as const, topic: 'T', prompt: 'Q?', options: ['A', 'B', 'All of the above', 'C'], correctAnswer: 'A', explanation: '', sourceQuote: 'x' };
  assert.deepEqual(reviewFlags(q, null, null).sort(), ['unlocated', 'weak_distractors']);
  const located = locateQuote([c2], 'Meiosis halves the chromosome number')!;
  assert.deepEqual(reviewFlags({ ...q, options: ['A', 'B', 'C', 'D'] }, located, c2.content), []);
  assert.deepEqual(reviewFlags({ ...q, options: ['In 1953', 'In 1962', 'In 1970', 'Never'], correctAnswer: 'In 1953' }, located, c2.content), ['number_not_in_source']);
  const fuzzy = { ...located, matchScore: 0.85 };
  assert.deepEqual(reviewFlags({ ...q, type: 'short_answer' as const, options: null }, fuzzy, c2.content), ['fuzzy_quote']);
});

test('export: source labels never invent a page; CSV quoting and GIFT escaping', () => {
  assert.equal(sourceLabel('Course', { located: true, pageStart: 3, pageEnd: 4, startSeconds: null }), 'Course, p. 3-4');
  assert.equal(sourceLabel('Course', { located: true, pageStart: null, pageEnd: null, startSeconds: 125 }), 'Course, 02:05');
  assert.equal(sourceLabel('Course', { located: false, pageStart: 9, pageEnd: 9, startSeconds: null }), 'Course (location not confirmed)');
  assert.equal(giftEscape('a=b ~c #d {e} f:g \\h\nline'), 'a\\=b \\~c \\#d \\{e\\} f\\:g \\\\h<br>line');
  const base = {
    id: 'id-1',
    organizationId: 'o',
    documentId: 'd',
    documentTitle: 'Safety "basics"',
    sourceLabel: 'Safety "basics", p. 2',
    quote: 'q',
    type: 'mcq' as const,
    topic: 'Fire',
    section: 'Module 1',
    stem: 'Which extinguisher, for "electrical" fires?',
    options: ['CO2', 'Water', 'Foam', 'Sand'],
    correctAnswer: 'CO2',
    explanation: 'Water conducts: use CO2.',
    difficulty: null,
    status: 'approved' as const,
    version: 2,
    origin: 'ai' as const,
    reviewFlags: [],
    verification: null,
    legalRef: null,
    createdBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const csv = toCsv([base]);
  assert.ok(csv.startsWith('\uFEFF"id","version"'));
  assert.ok(csv.includes('"Safety ""basics"""'), 'quotes doubled');
  assert.ok(csv.includes('"Which extinguisher, for ""electrical"" fires?"'));
  assert.equal(csv.split('\r\n').length, 3, 'header + one row + trailing CRLF');
  const gift = toGift([base, { ...base, id: 'id-2', type: 'short_answer', options: null, correctAnswer: 'Carbon dioxide' }]);
  assert.ok(gift.includes('$CATEGORY: $course$/top/Safety "basics" / Module 1'));
  assert.ok(gift.includes('=CO2\n~Water\n~Foam\n~Sand\n#Water conducts\\: use CO2.'));
  assert.ok(gift.includes('{=Carbon dioxide#Water conducts\\: use CO2.}'));
  assert.ok(gift.includes('// Fire · source: Safety "basics", p. 2 · id id-1 v2'));
});
