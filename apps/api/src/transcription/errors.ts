/** Provider-neutral transcription failure. Details are for server logs only. */
export type TranscriptionErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'no_speech' // the recording has no usable speech
  | 'unsupported_media' // the provider could not decode the file
  | 'bad_output';

export class TranscriptionError extends Error {
  constructor(
    public code: TranscriptionErrorCode,
    public detail?: string,
  ) {
    super(`transcription failed: ${code}`);
    this.name = 'TranscriptionError';
  }

  /** Worth retrying later (provider-side or transient problems, not the file itself). */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'unavailable' || this.code === 'timeout' || this.code === 'bad_output';
  }
}
