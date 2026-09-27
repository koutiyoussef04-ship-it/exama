/**
 * Provider-neutral AI failure. Messages are safe to show to students;
 * raw provider errors are logged server-side only (never sent to the app).
 */
export type AIErrorCode =
  | 'not_configured' // missing/invalid config (e.g. no API key)
  | 'auth' // provider rejected the API key
  | 'rate_limited' // too many requests / quota / overloaded
  | 'unavailable' // network error, timeout, provider 5xx
  | 'bad_request' // e.g. unknown model name, input too large
  | 'bad_output'; // model replied but output was unusable

const USER_MESSAGES: Record<AIErrorCode, string> = {
  not_configured: 'The AI service is not configured on the server.',
  auth: 'The AI service rejected the server’s credentials.',
  rate_limited: 'The AI service is busy right now. Please try again in a minute.',
  unavailable: 'The AI service is temporarily unavailable. Please try again.',
  bad_request: 'The AI service could not process this request.',
  bad_output: 'The AI returned an unusable response. Please try again.',
};

export class AIError extends Error {
  constructor(
    public code: AIErrorCode,
    /** Internal detail for server logs. Never returned to clients. */
    public detail?: string,
  ) {
    super(USER_MESSAGES[code]);
    this.name = 'AIError';
  }

  /** HTTP status to use when this error reaches the API boundary. */
  get httpStatus(): 502 | 503 {
    return this.code === 'rate_limited' || this.code === 'unavailable' ? 503 : 502;
  }
}
