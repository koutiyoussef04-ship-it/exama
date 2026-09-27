import { config } from '../config.js';
import { AssemblyAIProvider } from './assemblyai.js';
import { MockTranscriptionProvider } from './mock.js';
import type { TranscriptionProvider } from './types.js';

/**
 * Chosen once at startup from TRANSCRIPTION_PROVIDER. `null` = audio/video disabled (PDFs still work).
 * Like the AI layer, there is no silent fallback to the mock.
 */
function createProvider(): TranscriptionProvider | null {
  switch (config.TRANSCRIPTION_PROVIDER) {
    case 'assemblyai':
      return new AssemblyAIProvider({
        apiKey: config.ASSEMBLYAI_API_KEY!,
        baseUrl: config.ASSEMBLYAI_BASE_URL,
        speechModels: config.ASSEMBLYAI_SPEECH_MODELS,
      });
    case 'mock':
      return new MockTranscriptionProvider();
    case 'disabled':
      return null;
  }
}

export const transcriber = createProvider();
export { TranscriptionError } from './errors.js';
export type * from './types.js';
