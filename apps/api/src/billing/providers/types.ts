/**
 * A billing provider turns a provider-specific purchase proof into a normalized
 * SubscriptionUpdate. The rest of the system (entitlements, limits, analytics) only sees
 * SubscriptionUpdates. Stores: mock (development), apple (iOS), google (Android), stripe (web) — see billing/index.ts
 * for which store serves which platform.
 */
import type { SubscriptionRow, SubscriptionUpdate } from '../subscriptions.js';

export type PurchaseResult = {
  update: SubscriptionUpdate;
  reason: 'trial' | 'purchase';
  /** Runs after the update is stored (Google: acknowledge the purchase — else Google refunds it). */
  commit?: () => Promise<void>;
};

export interface BillingProvider {
  readonly id: 'mock' | 'apple' | 'google' | 'stripe';
  /** True when no real money moves (development mock). */
  readonly testMode: boolean;
  /**
   * Validate a purchase and return the resulting state.
   * mock: `{ planId, startTrial }`. apple: `{ signedTransaction }` (JWS from StoreKit 2).
   * google: `{ purchaseToken, productId }` (Play Billing). Always verified server-side.
   */
  purchase(userId: string, input: unknown, current: SubscriptionRow | null): Promise<PurchaseResult>;
  /** Re-sync the user's purchases (the "Restore purchases" button). Null if nothing to restore. */
  restore(userId: string, input: unknown, current: SubscriptionRow | null): Promise<SubscriptionUpdate | null>;
}
