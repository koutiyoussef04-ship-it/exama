/**
 * Real transcription smoke test: sends a 16-second English speech clip to the configured provider
 * (AssemblyAI) and prints the transcript. Costs a fraction of a cent. Does not touch the database.
 *
 *   npm run transcription:check                          # bundled clip
 *   npm run transcription:check -- "C:\\path\\to\\lecture.m4a"   # your own file (≤ 5 minutes are sent)
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { bufferReader, probeMedia } from '../src/lib/media-probe.js';
import { AssemblyAIProvider } from '../src/transcription/assemblyai.js';
import { TranscriptionError } from '../src/transcription/errors.js';

if (!config.ASSEMBLYAI_API_KEY) {
  console.error('✖ ASSEMBLYAI_API_KEY is empty. Add it to apps/api/.env (see README → "Lecture audio & video").');
  process.exit(1);
}
const path = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../test/fixtures/media/speech-en.mp3', import.meta.url));
const bytes = new Uint8Array(await readFile(path));
const probe = await probeMedia(bufferReader(bytes));
console.log(`File: ${path}\nDetected: ${probe.format} (${probe.kind}), ${probe.durationSeconds}s · server TRANSCRIPTION_PROVIDER=${config.TRANSCRIPTION_PROVIDER}`);

const provider = new AssemblyAIProvider({ apiKey: config.ASSEMBLYAI_API_KEY, baseUrl: config.ASSEMBLYAI_BASE_URL, speechModels: config.ASSEMBLYAI_SPEECH_MODELS });
const t0 = Date.now();
try {
  const t = await provider.transcribe({
    media: { size: (await stat(path)).size, mimeType: 'application/octet-stream', open: () => createReadStream(path), peek: async () => bytes.subarray(0, 65536) },
    expectedSeconds: probe.durationSeconds ?? 60,
    maxSeconds: Math.min(300, probe.durationSeconds ?? 300),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  console.log(`✓ Transcribed ${t.durationSeconds}s in ${((Date.now() - t0) / 1000).toFixed(1)}s · language: ${t.language}`);
  for (const s of t.segments.slice(0, 20)) console.log(`  [${Math.floor(s.startMs / 1000)}s] ${s.text}`);
} catch (err) {
  console.error(`✖ ${err instanceof TranscriptionError ? `${err.code}: ${err.detail}` : err}`);
  process.exit(1);
}
