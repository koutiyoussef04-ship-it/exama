/**
 * Product analytics: one `track()` entry point, pluggable sinks.
 * Today events go to Postgres (first-party). To add a hosted tool later (PostHog, Mixpanel…),
 * implement AnalyticsSink and push it onto `sinks` — no call sites change.
 *
 * Analytics must never break the product: every write is best-effort and never throws.
 */
import type { ServerEventName, ServerEvents } from '@study/shared';
import { db } from '../db/client.js';
import { analyticsEvents } from '../db/schema.js';

export type AnalyticsEvent = {
  name: string;
  source: 'server' | 'client';
  userId?: string | null;
  anonymousId?: string | null;
  properties: Record<string, unknown>;
};

export interface AnalyticsSink {
  readonly name: string;
  record(events: AnalyticsEvent[]): Promise<void>;
}

export const postgresSink: AnalyticsSink = {
  name: 'postgres',
  async record(events) {
    await db.insert(analyticsEvents).values(
      events.map((e) => ({
        name: e.name,
        source: e.source,
        userId: e.userId ?? null,
        anonymousId: e.anonymousId ?? null,
        properties: e.properties,
      })),
    );
  },
};

export const sinks: AnalyticsSink[] = [postgresSink];

const pending = new Set<Promise<void>>();

/** Records events in every sink. Never rejects; failures are logged. */
export function recordEvents(events: AnalyticsEvent[]): Promise<void> {
  const p = Promise.all(
    sinks.map((s) =>
      s.record(events).catch((err) => console.error(`[analytics] sink "${s.name}" failed:`, err instanceof Error ? err.message : err)),
    ),
  ).then(() => undefined);
  pending.add(p);
  void p.finally(() => pending.delete(p));
  return p;
}

/** Server-side event. Fire-and-forget: `void track(...)`. */
export function track<N extends ServerEventName>(name: N, userId: string | null, properties: ServerEvents[N]): Promise<void> {
  return recordEvents([{ name, source: 'server', userId, properties: properties as Record<string, unknown> }]);
}

/** Waits for in-flight writes (tests, graceful shutdown). */
export async function flushAnalytics() {
  await Promise.all([...pending]);
}
