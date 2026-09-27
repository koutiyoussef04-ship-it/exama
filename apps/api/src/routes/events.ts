/**
 * POST /events — client-side analytics (only events the server can't observe itself).
 * Auth is optional: with a valid token the event is linked to the user, otherwise only to
 * the random per-install anonymousId (e.g. app_opened before sign-in).
 * Names and properties are validated against a strict allowlist (packages/shared/src/analytics.ts).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { trackEventsSchema } from '@study/shared';
import { recordEvents } from '../analytics/index.js';
import { verifyActiveUser } from '../auth/auth.js';
import { HttpError, parseBody } from '../lib/errors.js';

export const eventRoutes = new Hono().post(
  '/',
  bodyLimit({
    maxSize: 16 * 1024,
    onError: () => {
      throw new HttpError(413, 'Too many events', 'too_many_events');
    },
  }),
  async (c) => {
    const input = parseBody(trackEventsSchema, await c.req.json());
    const header = c.req.header('Authorization');
    const userId = await verifyActiveUser(header?.startsWith('Bearer ') ? header.slice(7) : null);
    await recordEvents(
      input.events.map((e) => ({
        name: e.name,
        source: 'client' as const,
        userId,
        anonymousId: input.anonymousId,
        properties: e.properties,
      })),
    );
    return c.json({ accepted: input.events.length }, 202);
  },
);
