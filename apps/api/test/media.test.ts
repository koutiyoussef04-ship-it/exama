/**
 * Unit tests for the lecture pipeline's building blocks: format/duration detection from bytes,
 * transcript chunking, validation + grounding of AI-extracted knowledge, the extraction prompt/
 * output contract with a fake LLM, title cleaning and the burst limiter.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

Object.assign(process.env, { AI_PROVIDER: 'mock', TRANSCRIPTION_PROVIDER: 'mock' });

const { bufferReader, probeMedia, ProbeError } = await import('../src/lib/media-probe.js');
const { sanitizeKnowledge, mergeCourseTopics, MAX_COURSE_TOPICS } = await import('../src/lib/knowledge.js');
const { LLMStudyAI, fitText, MAX_EXTRACTION_CHARS } = await import('../src/ai/llm-study-ai.js');
const { AIError } = await import('../src/ai/errors.js');
const { segmentsToChunks } = await import('../src/services/materials/pipeline.js');
const { cleanTitle } = await import('../src/services/materials/service.js');
const { RateLimiter } = await import('../src/lib/rate-limit.js');

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/media/${name}`, import.meta.url)));
const probe = async (bytes: Uint8Array) => probeMedia(bufferReader(bytes));

test('probe: real MP3 (Xing and header-less), M4A, WAV, MP4 (moov first and last) and MOV', async () => {
  const cases: [string, string, string, number][] = [
    ['lecture.mp3', 'mp3', 'audio', 4],
    ['lecture-noxing.mp3', 'mp3', 'audio', 4],
    ['speech-en.mp3', 'mp3', 'audio', 17],
    ['lecture.m4a', 'm4a', 'audio', 5],
    ['lecture.wav', 'wav', 'audio', 2],
    ['lecture.mp4', 'mp4', 'video', 6],
    ['lecture-moov-at-end.mp4', 'mp4', 'video', 4],
    ['lecture.mov', 'mov', 'video', 4],
  ];
  for (const [file, format, kind, seconds] of cases) {
    const r = await probe(await fixture(file));
    assert.deepEqual([r.format, r.kind, r.durationSeconds], [format, kind, seconds], file);
  }
  const pdf = await probe(new Uint8Array(await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url))));
  assert.deepEqual([pdf.kind, pdf.durationSeconds], ['pdf', null]);
});

test('probe: refuses unknown, truncated, silent-track-less and absurd files', async () => {
  const code = async (bytes: Uint8Array) => {
    try {
      await probe(bytes);
      return 'accepted';
    } catch (err) {
      assert.ok(err instanceof ProbeError);
      return err.code;
    }
  };
  assert.equal(await code(await fixture('random.bin')), 'unsupported_format');
  assert.equal(await code(new TextEncoder().encode('<html><script>alert(1)</script></html>')), 'unsupported_format');
  assert.equal(await code((await fixture('lecture.mp4')).subarray(0, 300)), 'media_unreadable');
  assert.equal(await code(await fixture('video-no-audio.mp4')), 'media_no_audio');
  // A WAV header claiming 0 bytes/second can't produce a duration.
  const bad = Buffer.from(await fixture('lecture.wav'));
  bad.writeUInt32LE(0, 28);
  assert.equal(await code(new Uint8Array(bad)), 'media_unreadable');
  // An MP4 whose header claims a 25-hour recording is rejected as implausible.
  const mp4 = Buffer.from(await fixture('lecture.mp4'));
  const mdhd = mp4.indexOf('mdhd', 0, 'latin1');
  let at = mdhd;
  while ((at = mp4.indexOf('mdhd', at + 1, 'latin1')) !== -1) {
    const scale = mp4.readUInt32BE(at + 4 + 4 + 8);
    mp4.writeUInt32BE(scale * 90_000, at + 4 + 4 + 12);
  }
  mp4.writeUInt32BE(mp4.readUInt32BE(mdhd + 4 + 4 + 8) * 90_000, mdhd + 4 + 4 + 12);
  assert.equal(await code(new Uint8Array(mp4)), 'media_unreadable');
});

test('probe reads only headers: a 1 GB file is inspected with a handful of small reads', async () => {
  // Standard 44-byte PCM header (16 kHz, 8-bit mono = 16000 bytes/s) for a 1 GiB file.
  const size = 1024 ** 3;
  const wav = Buffer.alloc(64);
  wav.write('RIFFxxxxWAVEfmt ', 0, 'latin1');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36, 'latin1');
  wav.writeUInt32LE(size - 44, 40);
  let bytesRead = 0;
  const reader = {
    size,
    read: async (start: number, length: number) => {
      bytesRead += length;
      return start < wav.length ? new Uint8Array(wav.subarray(start, Math.min(wav.length, start + length))) : new Uint8Array(0);
    },
  };
  const r = await probeMedia(reader);
  assert.equal(r.durationSeconds, Math.ceil((size - 44) / 16000));
  assert.ok(bytesRead < 1024, `read ${bytesRead} bytes`);
});

test('transcript chunking: ~3000-character chunks with time ranges, in order, nothing lost', () => {
  const segments = Array.from({ length: 40 }, (_, i) => ({ startMs: i * 30_000, endMs: (i + 1) * 30_000, text: `Sentence ${i} `.repeat(20).trim() }));
  const chunks = segmentsToChunks(segments);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.content.length <= 3000));
  assert.equal(chunks[0].startSeconds, 0);
  assert.equal(chunks.at(-1)!.endSeconds, 1200);
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].startSeconds >= chunks[i - 1].endSeconds - 1);
  assert.equal(chunks.map((c) => c.content).join(' '), segments.map((s) => s.text).join(' '));
  assert.deepEqual(segmentsToChunks([{ startMs: 0, endMs: 10, text: '   ' }]), []);
});

const SEGMENTS = [
  { text: 'When oxygen is not available, cells rely on fermentation to regenerate NAD plus so that glycolysis can continue.', startSeconds: 60, page: null },
  { text: 'Enzymes lower the activation energy of a reaction without being consumed by it.', startSeconds: 300, page: null },
];
const topic = (name: string, sourceQuote: string, extra: Partial<Record<string, unknown>> = {}) => ({
  name,
  subtopics: [],
  keyPoints: ['k'],
  definitions: [],
  examples: [],
  examConcepts: [],
  relatedTopics: [],
  sourceQuote,
  ...extra,
});

test('knowledge validation: ungrounded topics are dropped, names snap to course topics, locations come from the quote', () => {
  const r = sanitizeKnowledge(
    {
      sourceLanguage: 'en',
      summary: 'x'.repeat(2000),
      topics: [
        topic('fermentation', 'cells rely on fermentation to regenerate NAD plus', { relatedTopics: ['ENZYMES', 'Quantum physics', 'fermentation'] }),
        topic('Enzymes', 'Enzymes lower the activation energy of a reaction', { keyPoints: Array.from({ length: 20 }, (_, i) => `${i} ${'p'.repeat(500)}`), examples: ['Yeast', 'yeast ', 'Muscle'] }),
        topic('Black holes', 'black holes evaporate through Hawking radiation over time'), // not in the lecture
        topic('Glycolysis', ''), // no quote
        topic('Enzymes', 'Enzymes lower the activation energy of a reaction'), // duplicate
      ],
    },
    { existingTopics: ['Fermentation', 'Photosynthesis'], segments: SEGMENTS },
  );
  assert.deepEqual(r.topics.map((t) => [t.name, t.isNew, t.startSeconds]), [['Fermentation', false, 60], ['Enzymes', true, 300]]);
  assert.equal(r.rejected, 3);
  assert.deepEqual(r.topics[0].relatedTopics, ['Enzymes'], 'unknown and self references removed');
  assert.equal(r.topics[1].keyPoints.length, 6);
  assert.deepEqual(r.topics[1].examples, ['Yeast', 'Muscle'], 'repeated points are removed');
  assert.ok(r.topics[1].keyPoints.every((k) => k.length <= 300));
  assert.equal(r.summary.length, 800);
});

test('knowledge validation: a course never exceeds the topic cap', () => {
  const existing = Array.from({ length: MAX_COURSE_TOPICS - 1 }, (_, i) => `Topic ${i}`);
  const r = sanitizeKnowledge(
    { sourceLanguage: 'en', summary: '', topics: [topic('Fermentation', 'cells rely on fermentation to regenerate NAD plus'), topic('Enzymes', 'Enzymes lower the activation energy of a reaction')] },
    { existingTopics: existing, segments: SEGMENTS },
  );
  assert.deepEqual(r.topics.map((t) => t.name), ['Fermentation']);
  assert.equal(mergeCourseTopics(existing, [['a', 'b', 'c']]).length, MAX_COURSE_TOPICS);
  assert.deepEqual(mergeCourseTopics(['Cells', 'DNA'], [['cells', 'Enzymes'], ['Enzymes', 'RNA']]), ['Cells', 'DNA', 'Enzymes', 'RNA']);
});

test('extraction prompt/output contract (fake LLM): structured JSON, retries once, then a clean AI error', async () => {
  const prompts: string[] = [];
  let replies: string[] = [];
  const llm = {
    name: 'fake',
    complete: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return replies.shift() ?? '';
    },
  };
  const ai = new LLMStudyAI(llm);
  const good = JSON.stringify({
    sourceLanguage: 'fr',
    summary: 'Résumé.',
    topics: [{ name: 'Fermentation', subtopics: ['Lactique'], keyPoints: ['a'], definitions: [{ term: 'NAD', definition: 'd' }], examples: [], examConcepts: ['c'], relatedTopics: [], sourceQuote: 'q' }],
  });
  replies = ['not json', `Here you go: ${good}`];
  const out = await ai.extractKnowledge({ text: 'Transcript text', kind: 'audio', existingTopics: ['Photosynthesis'], topicLanguage: 'en', language: 'es' });
  assert.equal(prompts.length, 2, 'retried once after unusable output');
  assert.deepEqual([out.sourceLanguage, out.topics[0].name, out.topics[0].definitions[0].term], ['fr', 'Fermentation', 'NAD']);
  const p = prompts[0];
  assert.match(p, /"Photosynthesis"/, 'existing topics are passed so names are reused');
  assert.match(p, /only shown on slides/, 'transcript-only: the model must not guess slides');
  assert.match(p, /Spanish/);
  assert.match(p, /VERBATIM/);
  assert.match(p, /<material>\nTranscript text\n<\/material>/);

  replies = ['{"topics": "nope"}', '{}{'];
  await assert.rejects(
    ai.extractKnowledge({ text: 't', kind: 'pdf', existingTopics: [], topicLanguage: 'en', language: 'en' }),
    (err: unknown) => err instanceof AIError && err.code === 'bad_output',
  );

  // Oversized lists from the model are trimmed, not trusted.
  replies = [JSON.stringify({ summary: 's', topics: [{ name: 'T', keyPoints: Array(50).fill('x'), sourceQuote: 'q' }] })];
  const trimmed = await ai.extractKnowledge({ text: 't', kind: 'video', existingTopics: [], topicLanguage: 'en', language: 'en' });
  assert.equal(trimmed.topics[0].keyPoints.length, 6);
});

test('long material is sampled evenly within budget, never just the beginning', () => {
  const text = Array.from({ length: 40_000 }, (_, i) => `w${i}`).join(' ');
  const fitted = fitText(text + ' THE-END', 20_000);
  assert.ok(fitted.length <= 20_000);
  assert.ok(fitted.includes('w0 '));
  assert.ok(fitted.includes('w3') && /w3\d{4}/.test(fitted), 'content from late in the lecture is included');
  assert.equal(fitText('short'), 'short');
  assert.ok(MAX_EXTRACTION_CHARS >= 100_000);
});

test('titles: file names are cleaned (no paths, control characters or extensions)', () => {
  assert.equal(cleanTitle(encodeURIComponent('Lecture 3 – enzymes.m4a')), 'Lecture 3 – enzymes');
  assert.equal(cleanTitle('..%2F..%2Fetc%2Fpasswd'), 'passwd');
  assert.equal(cleanTitle('C:\\Users\\me\\Week 2.MP4'), 'Week 2');
  assert.equal(cleanTitle('bad%E0%A4%A'), 'bad%E0%A4%A');
  assert.equal(cleanTitle('a\u0000b\u001fc'), 'abc');
  assert.equal(cleanTitle('x'.repeat(500)).length, 200);
  assert.equal(cleanTitle(null), '');
});

test('burst limiter: N per window per key, then 429 with retry-after', () => {
  const rl = new RateLimiter(2, 1000);
  rl.take('a', 0);
  rl.take('a', 10);
  rl.take('b', 10);
  assert.throws(() => rl.take('a', 20), (e: { status: number; code: string }) => e.status === 429 && e.code === 'too_many_requests');
  rl.take('a', 1001); // window moved on
});
