/**
 * Why a course upload failed, as one coarse category (sent with `upload_failed`) — kept free of React Native imports so it can be
 * tested. Categories only: never a file name, path, error text or any other detail of the file or the person.
 *
 * Where it went wrong, in the order a student meets it:
 *   picker        the file picker failed, or copying the picked file failed (before anything was sent)
 *   request       the app could not build or send the request (also before any response)
 *   network       no response: offline, dropped connection, timeout
 *   auth          401/403: not signed in, session expired
 *   not_verified  403 email_not_verified
 *   limit         402: the plan's limit
 *   rate_limited  429
 *   too_large     413     not_pdf  415 (every unsupported file type)     server  5xx     unknown  anything else
 * `network`, `too_large`, `not_pdf`, `server` and `unknown` are the original values and keep their meaning.
 */
export type UploadFailureReason = 'network' | 'too_large' | 'not_pdf' | 'server' | 'unknown' | 'picker' | 'request' | 'auth' | 'not_verified' | 'limit' | 'rate_limited';

/** The file picker failed (or could not copy the file). The message is fixed on purpose: no path or file name is carried. */
export class PickerError extends Error {
  constructor() {
    super('file picker failed');
    this.name = 'PickerError';
  }
}

type ApiLike = { status: number; code?: string };
const isApiLike = (e: unknown): e is ApiLike => typeof e === 'object' && e !== null && typeof (e as ApiLike).status === 'number';

export function uploadFailureReason(err: unknown): UploadFailureReason {
  if (err instanceof PickerError) return 'picker';
  if (!isApiLike(err)) return 'unknown';
  const { status, code } = err;
  if (status === 0) return code === 'request_failed' || code === 'app_misconfigured' ? 'request' : 'network';
  if (status === 400 && code === 'file_missing') return 'request'; // the request reached the server without the file
  if (status === 401) return 'auth';
  if (status === 403) return code === 'email_not_verified' ? 'not_verified' : 'auth';
  if (status === 402) return 'limit';
  if (status === 413) return 'too_large';
  if (status === 415) return 'not_pdf';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Messages for failures that have no server response; everything with a response keeps going through errors.ts by its code. */
export function clientFailureMessageKey(err: unknown): 'errors.picker' | 'errors.request' | null {
  if (err instanceof PickerError) return 'errors.picker';
  if (isApiLike(err) && err.status === 0 && err.code === 'request_failed') return 'errors.request';
  return null;
}
