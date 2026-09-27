/**
 * Purchase / restore orchestration shared by every store. The route picks the store; this module
 * enforces the cross-store rules and the order of operations:
 *   verify with the store → check conflicts → store the subscription → commit (e.g. Google ack).
 */
import { STORE_IDS, type BillingProviderId, type BillingPlatform } from '@study/shared';
import { HttpError } from '../lib/errors.js';
import { isOwner } from './entitlements.js';
import { billingProviders } from './index.js';
import type { BillingProvider } from './providers/types.js';
import { accessEndsAt, applySubscriptionUpdate, getSubscription, type SubscriptionRow } from './subscriptions.js';

/** Which store a request body is for: explicit `store`, else its shape (older app builds). */
export function storeForBody(body: unknown): BillingProviderId | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.store === 'string' && (STORE_IDS as readonly string[]).includes(b.store)) return b.store as BillingProviderId;
  if (typeof b.signedTransaction === 'string' || Array.isArray(b.signedTransactions)) return 'apple';
  if (typeof b.purchaseToken === 'string' || Array.isArray(b.purchases)) return 'google';
  if (typeof b.planId === 'string') return 'mock';
  return null;
}

export function requireStore(body: unknown, providers: Partial<Record<BillingProviderId, BillingProvider>> = billingProviders): BillingProvider {
  const id = storeForBody(body) ?? (providers.mock ? 'mock' : null);
  const p = id ? providers[id] : undefined;
  if (!p) throw new HttpError(503, 'Subscriptions are not available yet.', 'purchases_unavailable');
  return p;
}

/**
 * A subscription can only be managed (and billed) by the store that sold it. Buying again in the
 * other store would charge twice, so it is refused while the first one still gives access —
 * for Google the purchase is then never acknowledged, and Google refunds it automatically.
 */
export function assertNotSubscribedElsewhere(current: SubscriptionRow | null, store: BillingProviderId, now = new Date()): void {
  if (!current || store === 'mock' || current.provider === 'mock' || current.provider === store) return;
  const end = accessEndsAt(current);
  if (current.status !== 'expired' && end && end > now) {
    throw new HttpError(409, 'You already have a subscription from another store.', 'subscribed_elsewhere', { provider: current.provider });
  }
}

export async function purchaseWith(provider: BillingProvider, userId: string, body: unknown): Promise<void> {
  if (await isOwner(userId)) throw new HttpError(409, 'This account already has full access.', 'full_access');
  const current = await getSubscription(userId);
  assertNotSubscribedElsewhere(current, provider.id);
  const { update, reason, commit } = await provider.purchase(userId, body, current);
  await applySubscriptionUpdate(userId, update, reason);
  // The subscription is stored: access is granted whatever happens next. A failed commit (Google
  // acknowledgement) is retried by the app's finishTransaction and by the next store notification.
  await commit?.().catch((err) => console.error(`[billing] ${provider.id} post-purchase commit failed`, err instanceof Error ? err.message : err));
}

export async function restoreWith(provider: BillingProvider, userId: string, body: unknown): Promise<void> {
  const current = await getSubscription(userId);
  assertNotSubscribedElsewhere(current, provider.id);
  const update = await provider.restore(userId, body, current);
  if (!update) throw new HttpError(404, 'No active purchases found to restore.', 'nothing_to_restore');
  await applySubscriptionUpdate(userId, update, 'restore');
}

export const isBillingPlatform = (v: unknown): v is BillingPlatform => v === 'ios' || v === 'android' || v === 'web';
