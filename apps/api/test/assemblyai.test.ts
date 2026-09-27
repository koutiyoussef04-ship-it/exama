/**
 * AssemblyAI provider: HTTP contract against a fake API (always runs, no network), plus a REAL
 * transcription test that only runs when you opt in:
 *   ASSEMBLYAI_API_KEY=... ASSEMBLYAI_LIVE_TEST=1 npm test -w @study/api
 * (costs a fraction of a cent: a 16-second speech clip).
 */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

Object.assign(process.env, { AI_PROVIDER: 'mock', TRANSCRIPTION_PROVIDER: 'mock' });
const { AssemblyAIProvider } = await import('../src/transcription/assemblyai.js');
const { TranscriptionError } = await import('../src/transcription/errors.js');

const speechPath = fileURLToPath(new URL('./fixtures/media/speech-en.mp3', import.meta.url));
const speech = new Uint8Array(await readFile(speechPath));
const media = { size: speech.byteLength, mimeType: 'audio/mpeg', open: () => createReadStream(speechPath), peek: async () => speech.subarray(0, 65536) };

type Call = { method: string; path: string; headers: Record<string, string>; body: Uint8Array | null };

/** Minimal fake of the AssemblyAI REST API. `script` decides the job outcome. */
function fakeApi(script: { failUpload?: number; job?: Record<string, unknown>; pollsBeforeDone?: number }) {
  const calls: Call[] = [];
  let polls = 0;
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    let body: Uint8Array | null = null;
    if (init.body instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      for await (const c of init.body as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
      body = new Uint8Array(Buffer.concat(chunks));
    } else if (typeof init.body === 'string') body = new TextEncoder().encode(init.body);
    const call = { method: init.method ?? 'GET', path: u.pathname, headers: init.headers as Record<string, string>, body };
    calls.push(call);
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (call.path === '/v2/upload') return script.failUpload ? json(script.failUpload, { error: 'nope' }) : json(200, { upload_url: 'https://cdn.example/upload/abc' });
    if (call.path === '/v2/transcript' && call.method === 'POST') return json(200, { id: 't1', status: 'queued' });
    if (call.path === '/v2/transcript/t1' && call.method === 'GET') {
      polls++;
      if (polls <= (script.pollsBeforeDone ?? 1)) return json(200, { id: 't1', status: 'processing' });
      return json(200, { id: 't1', status: 'completed', text: 'Hello students. Fermentation regenerates NAD plus.', language_code: 'en_us', audio_duration: 16.2, ...script.job });
    }
    if (call.path === '/v2/transcript/t1/paragraphs') {
      return json(200, { paragraphs: [{ text: 'Hello students.', start: 0, end: 1500 }, { text: 'Fermentation regenerates NAD plus.', start: 1500, end: 16_200 }] });
    }
    if (call.path === '/v2/transcript/t1' && call.method === 'DELETE') return json(200, { id: 't1' });
    return json(404, {});
  }) as typeof fetch;
  return { impl, calls };
}

const provider = (impl: typeof fetch) =>
  new AssemblyAIProvider({ apiKey: 'test-key', baseUrl: 'https://api.eu.assemblyai.com/', speechModels: ['universal-3-5-pro', 'universal-2'], pollIntervalMs: 1, fetchImpl: impl });

test('contract: streams the upload, caps the length, polls, maps paragraphs, deletes the transcript', async () => {
  const api = fakeApi({ pollsBeforeDone: 2 });
  const t = await provider(api.impl).transcribe({ media, expectedSeconds: 17, maxSeconds: 60, signal: new AbortController().signal });
  assert.deepEqual(t, {
    language: 'en',
    durationSeconds: 17,
    segments: [
      { startMs: 0, endMs: 1500, text: 'Hello students.' },
      { startMs: 1500, endMs: 16_200, text: 'Fermentation regenerates NAD plus.' },
    ],
  });
  const [up, submit] = api.calls;
  assert.equal(up.path, '/v2/upload');
  assert.equal(up.headers.Authorization, 'test-key', 'server-side key, sent to AssemblyAI only');
  assert.deepEqual(up.body, speech, 'the stored file is sent unchanged');
  const job = JSON.parse(new TextDecoder().decode(submit.body!));
  assert.deepEqual(
    [job.audio_url, job.audio_end_at, job.language_detection, job.speech_threshold, job.speech_models],
    ['https://cdn.example/upload/abc', 60_000, true, 0.1, ['universal-3-5-pro', 'universal-2']],
  );
  assert.equal(api.calls.filter((c) => c.path === '/v2/transcript/t1' && c.method === 'GET').length, 3);
  assert.deepEqual(api.calls.at(-1)!.method, 'DELETE');
});

test('contract: provider errors map to stable codes (and the transcript is still deleted)', async () => {
  const code = async (script: Parameters<typeof fakeApi>[0]) => {
    const api = fakeApi(script);
    try {
      await provider(api.impl).transcribe({ media, expectedSeconds: 17, maxSeconds: 60, signal: new AbortController().signal });
      return 'ok';
    } catch (err) {
      assert.ok(err instanceof TranscriptionError);
      if (!script.failUpload) assert.equal(api.calls.at(-1)!.method, 'DELETE');
      return err.code;
    }
  };
  assert.equal(await code({ failUpload: 401 }), 'auth');
  assert.equal(await code({ failUpload: 429 }), 'rate_limited');
  assert.equal(await code({ failUpload: 503 }), 'unavailable');
  assert.equal(await code({ job: { status: 'error', error: 'language_detection cannot be performed on files with no spoken audio.' } }), 'no_speech');
  assert.equal(await code({ job: { status: 'error', error: 'Transcoding failed. File does not appear to contain audio.' } }), 'unsupported_media');
  assert.equal(await code({ job: { status: 'error', error: 'Internal server error' } }), 'unavailable');
  assert.equal(await code({ job: { text: '' } }), 'no_speech');
});

test('contract: aborting (timeout / course deleted) stops polling', async () => {
  const api = fakeApi({ pollsBeforeDone: 1_000_000 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(provider(api.impl).transcribe({ media, expectedSeconds: 17, maxSeconds: 60, signal: ac.signal }), (e: unknown) => e instanceof TranscriptionError && e.code === 'timeout');
});

const live = process.env.ASSEMBLYAI_API_KEY && process.env.ASSEMBLYAI_LIVE_TEST === '1';
test('LIVE: real AssemblyAI transcription of a 16 s English clip', { skip: !live && 'set ASSEMBLYAI_API_KEY and ASSEMBLYAI_LIVE_TEST=1 to run' }, async () => {
  const p = new AssemblyAIProvider({
    apiKey: process.env.ASSEMBLYAI_API_KEY!,
    baseUrl: process.env.ASSEMBLYAI_BASE_URL || 'https://api.assemblyai.com',
    speechModels: ['universal-3-5-pro', 'universal-2'],
  });
  const t = await p.transcribe({ media: { ...media, size: (await stat(speechPath)).size }, expectedSeconds: 17, maxSeconds: 60, signal: AbortSignal.timeout(180_000) });
  assert.equal(t.language, 'en');
  assert.ok(/fermentation/i.test(t.segments.map((s) => s.text).join(' ')), JSON.stringify(t));
  assert.ok(t.durationSeconds >= 15 && t.durationSeconds <= 60);
});
