/**
 * Small in-memory sliding-window rate limiter (per process). Enough for one API instance; with
 * several instances, move the counters to Postgres/Redis. Plan limits are enforced separately
 * (usage ledger) — this only stops bursts.
 */
import { HttpError } from './errors.js';

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private message = 'Too many uploads. Please wait a little and try again.',
  ) {}

  /** Throws 429 if `key` already made `max` requests in the window; otherwise records this one. */
  take(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      const retryAfterS = Math.ceil((this.windowMs - (now - recent[0])) / 1000);
      throw new HttpError(429, this.message, 'too_many_requests', { retryAfterS });
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
  }

  /** Like take(), but returns false instead of throwing. */
  tryTake(key: string, now = Date.now()): boolean {
    try {
      this.take(key, now);
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.hits.clear();
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
