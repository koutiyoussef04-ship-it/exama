/**
 * Speech-to-text, kept separate from the LLM layer: Claude reads text, it does not transcribe audio.
 *
 * A TranscriptionProvider turns a stored audio/video file into timestamped text. The course pipeline
 * only sees `Transcript`, so providers can be swapped (AssemblyAI today; e.g. Deepgram or a Whisper
 * host later) without touching it. A provider with a per-request size/length limit implements
 * `transcribe` by splitting the audio itself and concatenating the segments (offsetting their
 * timestamps) — the pipeline already stores transcripts as independent timestamped chunks.
 */
import type { Readable } from 'node:stream';

export type TranscriptSegment = { startMs: number; endMs: number; text: string };

export type Transcript = {
  /** Detected spoken language (ISO 639-1), when the provider knows it. */
  language: string | null;
  /** Seconds of audio actually transcribed (what the provider bills for). */
  durationSeconds: number;
  segments: TranscriptSegment[];
};

export type TranscribeInput = {
  media: {
    size: number;
    mimeType: string;
    /** Opens a fresh read stream of the stored file (never loaded fully into memory). */
    open(): Readable;
    /** Leading bytes (≤ 64 KB) — only the mock provider uses them. */
    peek(): Promise<Uint8Array>;
  };
  /** Length of the recording according to its headers (seconds). */
  expectedSeconds: number;
  /** Hard stop: never transcribe (or bill) beyond this many seconds. */
  maxSeconds: number;
  /** Aborted on timeout or when the material/course is deleted. */
  signal: AbortSignal;
};

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<Transcript>;
}
