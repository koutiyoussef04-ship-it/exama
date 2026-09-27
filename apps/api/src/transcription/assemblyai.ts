/**
 * AssemblyAI pre-recorded transcription over its REST API (no SDK).
 *
 *   1. POST /v2/upload            — the stored file is streamed (never read into memory)
 *   2. POST /v2/transcript        — language detection, stop at `maxSeconds` (audio_end_at),
 *                                   reject recordings that are mostly non-speech (speech_threshold)
 *   3. GET  /v2/transcript/:id    — poll until completed/error (aborts on timeout/deletion)
 *   4. GET  /v2/transcript/:id/paragraphs — timestamped paragraphs
 *   5. DELETE /v2/transcript/:id  — ask AssemblyAI to delete the transcript once we have it
 *
 * Video files are accepted directly (AssemblyAI extracts the audio track), so the server needs no
 * ffmpeg. The API key never leaves the server.
 */
import { Readable } from 'node:stream';
import { normalizeLanguageCode } from '../ai/language.js';
import { TranscriptionError } from './errors.js';
import type { Transcript, TranscribeInput, TranscriptionProvider } from './types.js';

type Options = {
  apiKey: string;
  baseUrl: string;
  speechModels: string[];
  /** Milliseconds between status checks (grows gently up to 4× for long jobs). */
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
};

type TranscriptJob = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string | null;
  language_code?: string | null;
  audio_duration?: number | null;
  text?: string | null;
};
type Paragraphs = { paragraphs: { text: string; start: number; end: number }[] };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new TranscriptionError('timeout', 'aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new TranscriptionError('timeout', 'aborted'));
      },
      { once: true },
    );
  });

export class AssemblyAIProvider implements TranscriptionProvider {
  readonly name = 'assemblyai';
  private fetch: typeof fetch;

  constructor(private opts: Options) {
    this.fetch = opts.fetchImpl ?? fetch;
  }

  private async call<T>(path: string, init: RequestInit & { signal: AbortSignal }): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.opts.baseUrl.replace(/\/+$/, '')}${path}`, {
        ...init,
        headers: { Authorization: this.opts.apiKey, ...(init.headers as Record<string, string>) },
      });
    } catch (err) {
      if (init.signal.aborted) throw new TranscriptionError('timeout', 'aborted');
      throw new TranscriptionError('unavailable', `network: ${err instanceof Error ? err.message : err}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const detail = `${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`;
      if (res.status === 401 || res.status === 403) throw new TranscriptionError('auth', detail);
      if (res.status === 429) throw new TranscriptionError('rate_limited', detail);
      if (res.status === 400 || res.status === 422) throw new TranscriptionError('unsupported_media', detail);
      throw new TranscriptionError('unavailable', detail);
    }
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new TranscriptionError('bad_output', `invalid JSON from ${path}`);
    }
  }

  async transcribe({ media, maxSeconds, signal }: TranscribeInput): Promise<Transcript> {
    // 1. Upload (streamed).
    const upload = await this.call<{ upload_url?: string }>('/v2/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(media.size) },
      body: Readable.toWeb(media.open()) as unknown as BodyInit,
      // Required by Node's fetch for streamed request bodies.
      ...({ duplex: 'half' } as object),
      signal,
    });
    if (!upload.upload_url) throw new TranscriptionError('bad_output', 'upload without upload_url');

    // 2. Submit.
    const job = await this.call<TranscriptJob>('/v2/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload.upload_url,
        speech_models: this.opts.speechModels,
        language_detection: true,
        punctuate: true,
        format_text: true,
        // Cost cap: never transcribe past what the student's plan reserved.
        audio_end_at: Math.max(1, Math.floor(maxSeconds)) * 1000,
        // Mostly music/silence → fail as "no usable speech" instead of producing junk.
        speech_threshold: 0.1,
      }),
      signal,
    });

    try {
      // 3. Poll.
      let done = job;
      const base = this.opts.pollIntervalMs ?? 3000;
      for (let i = 0; done.status !== 'completed' && done.status !== 'error'; i++) {
        await sleep(Math.min(base * 4, base * (1 + i / 10)), signal);
        done = await this.call<TranscriptJob>(`/v2/transcript/${job.id}`, { method: 'GET', signal });
      }
      if (done.status === 'error') {
        const detail = done.error ?? 'unknown error';
        if (/no spoken audio|no speech|speech threshold|speech_threshold|contain less than/i.test(detail)) throw new TranscriptionError('no_speech', detail);
        if (/transcod|decode|unsupported|invalid (audio|file)|file does not appear/i.test(detail)) throw new TranscriptionError('unsupported_media', detail);
        throw new TranscriptionError('unavailable', detail);
      }
      if (!done.text?.trim()) throw new TranscriptionError('no_speech', 'empty transcript');

      // 4. Paragraphs with timestamps.
      const { paragraphs } = await this.call<Paragraphs>(`/v2/transcript/${job.id}/paragraphs`, { method: 'GET', signal });
      const segments = (paragraphs ?? [])
        .filter((p) => p.text?.trim())
        .map((p) => ({ startMs: Math.max(0, p.start ?? 0), endMs: Math.max(0, p.end ?? 0), text: p.text.trim() }));
      if (!segments.length) segments.push({ startMs: 0, endMs: Math.round((done.audio_duration ?? 0) * 1000), text: done.text.trim() });

      const lastEnd = segments[segments.length - 1].endMs / 1000;
      const durationSeconds = Math.min(maxSeconds, Math.max(1, Math.ceil(done.audio_duration ?? lastEnd)));
      return { language: normalizeLanguageCode(done.language_code), durationSeconds, segments };
    } finally {
      // 5. Don't leave the transcript at the provider (best effort; errors only logged).
      await this.call(`/v2/transcript/${job.id}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) }).catch((err) =>
        console.warn(`[transcription] could not delete AssemblyAI transcript ${job.id}:`, err instanceof TranscriptionError ? err.detail : err),
      );
    }
  }
}
