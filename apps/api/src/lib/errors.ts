import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodType } from 'zod';

/**
 * An error safe to show to the user. `code` is stable and machine-readable — the apps translate
 * it into the user's language; `message` is the English fallback.
 */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, first?.message ?? 'Invalid request', 'invalid_request', result.error.issues);
  }
  return result.data;
}
