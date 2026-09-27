import type { BillingProviderId, Entitlement, Plan, PlanId } from '@study/shared';

/** Client side of one store. The server decides access; a store client only obtains a purchase proof. */
export interface StoreClient {
  readonly provider: BillingProviderId;
  purchase(plan: Plan, opts: { withTrial: boolean; userId: string }): Promise<Entitlement>;
  restore(): Promise<Entitlement>;
  /** Localized prices from the store (App Review / Play policy: show the store's price). */
  prices?(plans: readonly Plan[]): Promise<Partial<Record<PlanId, string>>>;
}
