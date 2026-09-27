/**
 * Development billing provider. NO payment happens — it only exists to exercise every
 * subscription state end-to-end before Apple IAP is connected. Enabled only when
 * BILLING_MOCK_ENABLED=true (refused when NODE_ENV=production). All its analytics events
 * carry provider "mock" so they can be excluded from real revenue reporting.
 */
import { mockPurchaseSchema, planById, TRIAL_DAYS, type MockState, type PlanId } from '@study/shared';
import { z } from 'zod';
import { HttpError, parseBody } from '../../lib/errors.js';
import type { SubscriptionRow, SubscriptionUpdate } from '../subscriptions.js';
import type { BillingProvider } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const addPeriod = (from: Date, planId: PlanId) => {
  const d = new Date(from);
  if (planById(planId).period === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};
const hasAccess = (row: SubscriptionRow | null, now: Date) =>
  !!row && row.status !== 'expired' && ((row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEndsAt) ?? new Date(0)) > now;

const purchaseInput = mockPurchaseSchema.extend({ startTrial: z.boolean().default(false) });

export const mockProvider: BillingProvider = {
  id: 'mock',
  testMode: true,

  async purchase(_userId, input, current) {
    const { planId, startTrial } = parseBody(purchaseInput, input);
    const now = new Date();
    if (startTrial) {
      if (current?.trialUsed) throw new HttpError(409, 'The free trial has already been used on this account.', 'trial_already_used');
      if (hasAccess(current, now)) throw new HttpError(409, 'You already have an active subscription.', 'already_subscribed');
      const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY);
      return {
        reason: 'trial',
        update: { provider: 'mock', environment: 'test', planId, status: 'trialing', trialEndsAt, currentPeriodEndsAt: trialEndsAt, willRenew: true, trialUsed: true },
      };
    }
    if (current && hasAccess(current, now) && current.status === 'active' && current.planId === planId) {
      throw new HttpError(409, 'You are already on this plan.', 'already_on_plan');
    }
    // Paid start (or plan change): new period starts now. (Apple applies downgrades at renewal; mock simplifies.)
    return {
      reason: 'purchase',
      update: {
        provider: 'mock',
        environment: 'test',
        planId,
        status: 'active',
        trialEndsAt: current?.status === 'trialing' ? current.trialEndsAt : null,
        currentPeriodEndsAt: addPeriod(now, planId),
        willRenew: true,
        trialUsed: true, // any purchase consumes intro-offer eligibility, as on the App Store
      },
    };
  },

  async restore(_userId, _input, current) {
    const now = new Date();
    if (!current || !hasAccess(current, now)) return null;
    return {
      provider: current.provider,
      environment: current.environment,
      planId: current.planId,
      status: current.trialEndsAt && current.currentPeriodEndsAt && +current.trialEndsAt === +current.currentPeriodEndsAt ? 'trialing' : 'active',
      trialEndsAt: current.trialEndsAt,
      currentPeriodEndsAt: current.currentPeriodEndsAt,
      willRenew: true,
      trialUsed: current.trialUsed,
    };
  },
};

/** Mock-only: user cancels auto-renew (on iOS this happens in Settings and arrives via Apple notifications). */
export function mockCancel(current: SubscriptionRow | null): SubscriptionUpdate {
  if (!current || !hasAccess(current, new Date())) throw new HttpError(404, 'No active subscription to cancel.', 'no_active_subscription');
  if (!current.willRenew) throw new HttpError(409, 'Subscription is already cancelled.', 'already_cancelled');
  return {
    provider: current.provider,
    environment: current.environment,
    planId: current.planId,
    status: 'cancelled',
    trialEndsAt: current.trialEndsAt,
    currentPeriodEndsAt: current.currentPeriodEndsAt,
    willRenew: false,
    trialUsed: current.trialUsed,
  };
}

/** Mock-only developer tool: jump straight to a state. `null` = delete the subscription (free, trial eligible). */
export function mockStateUpdate(state: MockState): SubscriptionUpdate | null {
  const now = new Date();
  const base = { provider: 'mock' as const, environment: 'test' as const, willRenew: true, trialUsed: true };
  switch (state) {
    case 'free':
      return null;
    case 'trial': {
      const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY);
      return { ...base, planId: 'student_monthly', status: 'trialing', trialEndsAt, currentPeriodEndsAt: trialEndsAt };
    }
    case 'expired':
      return { ...base, planId: 'student_monthly', status: 'expired', trialEndsAt: null, currentPeriodEndsAt: new Date(now.getTime() - DAY), willRenew: false };
    default:
      return { ...base, planId: state, status: 'active', trialEndsAt: null, currentPeriodEndsAt: addPeriod(now, state) };
  }
}
