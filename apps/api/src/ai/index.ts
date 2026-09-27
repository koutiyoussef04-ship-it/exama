import { config } from '../config.js';
import { LLMStudyAI } from './llm-study-ai.js';
import { MockStudyAI } from './mock-study-ai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import type { StudyAI } from './types.js';

/**
 * Chosen once at startup from AI_PROVIDER. There is deliberately no silent runtime
 * fallback to the mock: if the real provider fails, the user gets a clear error
 * instead of fake questions that look real.
 */
function createStudyAI(): StudyAI {
  switch (config.AI_PROVIDER) {
    case 'anthropic':
      return new LLMStudyAI(
        new AnthropicProvider({
          apiKey: config.ANTHROPIC_API_KEY!,
          model: config.AI_MODEL,
          workspaceId: config.ANTHROPIC_WORKSPACE_ID, // optional; only sent when set
        }),
      );
    case 'mock':
      return new MockStudyAI();
  }
}

export const studyAI = createStudyAI();
export { AIError } from './errors.js';
export type * from './types.js';
