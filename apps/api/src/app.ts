import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { AIError } from './ai/errors.js';
import { aiInfo, config } from './config.js';
import { HttpError } from './lib/errors.js';
import { LimitError } from './billing/errors.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { documentRoutes } from './routes/documents.js';
import { eventRoutes } from './routes/events.js';
import { examRoutes } from './routes/exams.js';
import { materialRoutes } from './routes/materials.js';
import { studyPlanRoutes } from './routes/study-plans.js';

export const app = new Hono()
  .use(logger())
  // Native apps don't need CORS; this is for Expo web. Production allows only CORS_ORIGINS.
  .use(cors({ origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : config.NODE_ENV === 'production' ? [] : '*' }))
  .get('/health', (c) => c.json({ ok: true, ai: aiInfo }))
  .route('/auth', authRoutes)
  .route('/documents', documentRoutes)
  .route('/documents', studyPlanRoutes)
  .route('/documents', materialRoutes)
  .route('/exams', examRoutes)
  .route('/events', eventRoutes)
  .route('/billing', billingRoutes);

app.onError((err, c) => {
  if (err instanceof LimitError) return c.json(err.body, 402);
  if (err instanceof HttpError) return c.json({ error: err.message, code: err.code, details: err.details }, err.status);
  if (err instanceof AIError) {
    console.error(`[ai] ${err.code}: ${err.detail ?? err.message}`);
    return c.json({ error: err.message, code: `ai_${err.code}` }, err.httpStatus);
  }
  if (err instanceof HTTPException) return c.json({ error: err.message, code: 'http_error' }, err.status);
  // Malformed UUID in a URL → treat as not found (Postgres "invalid_text_representation").
  const pgCode = (err as { code?: string }).code ?? (err.cause as { code?: string } | undefined)?.code;
  if (pgCode === '22P02') return c.json({ error: 'Not found', code: 'not_found' }, 404);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body', code: 'invalid_request' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong', code: 'server_error' }, 500);
});

app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));
