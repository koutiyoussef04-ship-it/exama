import Anthropic from '@anthropic-ai/sdk';
import { AIError } from '../errors.js';
import type { LLMProvider } from '../types.js';
import { currentAIUsage, type AIUsageSink } from '../usage.js';

type Options = {
  apiKey: string;
  model: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** The SDK retries connection errors, 408/409/429 and 5xx with backoff. */
  maxRetries?: number;
  /**
   * Optional workspace to bill/route requests to. Required by API keys that are not scoped
   * to a single workspace (Anthropic then rejects requests without the header).
   */
  workspaceId?: string;
  /** Override for tests (points the SDK at a fake server). */
  baseURL?: string;
  /** Called after every request with the token counts Anthropic reported (admin cost reporting). Must not throw. */
  onUsage?: AIUsageSink;
};

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;
  private onUsage?: AIUsageSink;

  constructor(opts: Options) {
    this.model = opts.model;
    this.onUsage = opts.onUsage;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      timeout: opts.timeoutMs ?? 120_000,
      maxRetries: opts.maxRetries ?? 2,
      defaultHeaders: opts.workspaceId ? { 'anthropic-workspace-id': opts.workspaceId } : undefined,
    });
  }

  async complete({ system, prompt, maxTokens = 4000 }: { system: string; prompt: string; maxTokens?: number }) {
    let res: Anthropic.Message;
    const started = Date.now();
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      const aiErr = toAIError(err, this.model);
      this.report(started, null, aiErr.code);
      throw aiErr;
    }
    // Tokens are billed even when the answer is unusable (truncated, refused, empty): always reported.
    const failure = res.stop_reason === 'max_tokens' || res.stop_reason === 'refusal' ? 'bad_output' : null;
    this.report(started, res.usage, failure);

    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (res.stop_reason === 'max_tokens') {
      throw new AIError('bad_output', `Response truncated at max_tokens=${maxTokens}`, { truncated: true });
    }
    if (res.stop_reason === 'refusal') {
      throw new AIError('bad_output', 'Model refused the request');
    }
    if (!text.trim()) throw new AIError('bad_output', 'Empty response');
    return text;
  }

  /** Reports usage to the sink without ever failing the request. */
  private report(started: number, usage: Anthropic.Usage | null, errorCode: string | null) {
    if (!this.onUsage) return;
    try {
      this.onUsage(
        {
          provider: this.name,
          model: this.model,
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          cacheReadTokens: usage?.cache_read_input_tokens ?? null,
          cacheWriteTokens: usage?.cache_creation_input_tokens ?? null,
          latencyMs: Date.now() - started,
          success: errorCode === null,
          errorCode,
        },
        currentAIUsage(),
      );
    } catch {
      // never let reporting break a student's request
    }
  }
}

/** Maps SDK errors to provider-neutral AIErrors (keeps raw detail for logs only). */
function toAIError(err: unknown, model: string): AIError {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const workspaceHint = /workspace/i.test(detail)
    ? ' — check ANTHROPIC_WORKSPACE_ID in apps/api/.env (Console → Settings → Workspaces, starts with "wrkspc_")'
    : '';
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AIError('auth', `${detail}${workspaceHint || ' — check ANTHROPIC_API_KEY in apps/api/.env'}`);
  }
  if (err instanceof Anthropic.RateLimitError) return new AIError('rate_limited', detail);
  if (err instanceof Anthropic.NotFoundError) {
    return new AIError('bad_request', `${detail}${workspaceHint || ` — is AI_MODEL="${model}" a valid model id?`}`);
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) {
    return new AIError('bad_request', detail + workspaceHint);
  }
  if (err instanceof Anthropic.APIError && err.status === 529) return new AIError('rate_limited', detail); // overloaded
  // Connection errors, timeouts, 5xx, anything else.
  return new AIError('unavailable', detail);
}
