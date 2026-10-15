import { Hono } from 'hono';
import { saveOnboardingSchema, type OnboardingState } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { parseBody } from '../lib/errors.js';
import { getOnboarding, saveOnboarding, skipOnboarding } from '../services/onboarding.js';

export const onboardingRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  // { status: 'pending' | 'completed' | 'skipped' | 'none', answers, finishedAt }
  .get('/', async (c) => c.json<OnboardingState>(await getOnboarding(c.var.userId)))
  // Body: { answers: { studyField, examTiming, mainGoal, materials, confidence } } — all five, fixed option ids.
  .put('/', async (c) => {
    const { answers } = parseBody(saveOnboardingSchema, await c.req.json().catch(() => ({})));
    return c.json<OnboardingState>(await saveOnboarding(c.var.userId, answers));
  })
  // Dismiss a pending questionnaire. Saved answers are never removed.
  .post('/skip', async (c) => c.json<OnboardingState>(await skipOnboarding(c.var.userId)));
