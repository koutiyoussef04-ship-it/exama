// Used by config.test.ts: loads billing config in a child process and prints what it resolved.
import { billingProvider, billingProviders, providerForPlatform } from '../../src/billing/index.js';
import { TIER_FEATURES } from '../../src/billing/features.js';
import { LIMITS } from '../../src/billing/limits.js';
console.log(
  JSON.stringify({
    provider: billingProvider?.id ?? null,
    stores: Object.keys(billingProviders).sort(),
    platforms: {
      ios: providerForPlatform('ios')?.id ?? null,
      android: providerForPlatform('android')?.id ?? null,
      web: providerForPlatform('web')?.id ?? null,
    },
    limits: LIMITS,
    features: TIER_FEATURES,
  }),
);
