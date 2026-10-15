/**
 * Student onboarding state (five questions, asked once to new accounts).
 *
 * - A `pending` row is created with the account (routes/auth.ts), so only accounts created after
 *   onboarding shipped are ever asked; older accounts have no row and read as `none`.
 * - Saving is idempotent and per account: answering again replaces the answers (that is how a future
 *   "edit" works) but never creates a second row; double submits and retries are harmless.
 * - Skipping only closes a pending questionnaire. It never touches answers that were already saved.
 */
import { eq, sql } from 'drizzle-orm';
import type { OnboardingAnswers, OnboardingState } from '@study/shared';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { userOnboarding } from '../db/schema.js';

const NONE: OnboardingState = { status: 'none', answers: null, finishedAt: null };

function toState(row: typeof userOnboarding.$inferSelect | undefined): OnboardingState {
  if (!row) return NONE;
  return { status: row.status, answers: row.status === 'completed' ? (row.answers ?? null) : null, finishedAt: row.finishedAt?.toISOString() ?? null };
}

export async function getOnboarding(userId: string): Promise<OnboardingState> {
  const [row] = await db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId));
  return toState(row);
}

export async function saveOnboarding(userId: string, answers: OnboardingAnswers): Promise<OnboardingState> {
  const [before] = await db.select({ status: userOnboarding.status }).from(userOnboarding).where(eq(userOnboarding.userId, userId));
  const [row] = await db
    .insert(userOnboarding)
    .values({ userId, status: 'completed', answers, finishedAt: new Date() })
    .onConflictDoUpdate({
      target: userOnboarding.userId,
      set: {
        status: 'completed',
        answers,
        // Keep the original completion time when the same student edits their answers later.
        finishedAt: sql`case when ${userOnboarding.status} = 'completed' then ${userOnboarding.finishedAt} else now() end`,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (before?.status !== 'completed') void track('onboarding_completed', userId, answers);
  return toState(row);
}

export async function skipOnboarding(userId: string): Promise<OnboardingState> {
  const skipped = await db
    .update(userOnboarding)
    .set({ status: 'skipped', finishedAt: new Date(), updatedAt: new Date() })
    .where(sql`${userOnboarding.userId} = ${userId} and ${userOnboarding.status} = 'pending'`)
    .returning({ userId: userOnboarding.userId });
  if (skipped.length) void track('onboarding_skipped', userId, {});
  return getOnboarding(userId);
}
