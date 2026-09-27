import { Hono } from 'hono';
import { createStudyPlanSchema, updateStudyPlanSchema, aiLanguageSchema } from '@study/shared';
import { z } from 'zod';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { parseBody } from '../lib/errors.js';
import {
  completeTask,
  createStudyPlan,
  deleteStudyPlan,
  getStudyPlan,
  recalculateStudyPlan,
  regenerateStudyPlan,
  skipTask,
  updateStudyPlan,
} from '../services/study-plans.js';

const json = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({}));
const regenerateSchema = z.object({ language: aiLanguageSchema.optional() });

/**
 * Study planner, one plan per course: /documents/:id/study-plan…
 * Ownership is always checked server-side (the course must belong to the signed-in user).
 * Only POST (create) and POST …/regenerate use AI and count against the plan allowance.
 */
export const studyPlanRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .get('/:id/study-plan', async (c) => c.json(await getStudyPlan(c.var.userId, c.req.param('id'))))
  .post('/:id/study-plan', async (c) => {
    const input = parseBody(createStudyPlanSchema, await json(c));
    return c.json(await createStudyPlan(c.var.userId, c.req.param('id'), input), 201);
  })
  .patch('/:id/study-plan', async (c) => {
    const input = parseBody(updateStudyPlanSchema, await json(c));
    return c.json(await updateStudyPlan(c.var.userId, c.req.param('id'), input));
  })
  .delete('/:id/study-plan', async (c) => {
    await deleteStudyPlan(c.var.userId, c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/study-plan/recalculate', async (c) => c.json(await recalculateStudyPlan(c.var.userId, c.req.param('id'))))
  .post('/:id/study-plan/regenerate', async (c) => {
    const input = parseBody(regenerateSchema, await json(c));
    return c.json(await regenerateStudyPlan(c.var.userId, c.req.param('id'), input));
  })
  .post('/:id/study-plan/tasks/:taskId/complete', async (c) =>
    c.json(await completeTask(c.var.userId, c.req.param('id'), c.req.param('taskId'))),
  )
  .post('/:id/study-plan/tasks/:taskId/skip', async (c) => c.json(await skipTask(c.var.userId, c.req.param('id'), c.req.param('taskId'))));
