import { Hono } from 'hono';
import { submitExamSchema } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { parseBody } from '../lib/errors.js';
import { getExam, submitExam } from '../services/exams.js';

export const examRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .get('/:id', async (c) => c.json(await getExam(c.var.userId, c.req.param('id'))))
  .post('/:id/submit', async (c) => {
    const input = parseBody(submitExamSchema, await c.req.json());
    return c.json(await submitExam(c.var.userId, c.req.param('id'), input));
  });
