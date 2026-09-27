/** Store helpers: Google Play offer selection, localized prices, store names, store error codes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLANS } from '@study/shared';
import { googleRecurringPrice, googleReplacement, isStoreProvider, pickGoogleOfferToken, storeErrorCode, storeName, type OfferLike } from '../src/lib/store/offers.js';

const phase = (micros: string, formattedPrice: string) => ({ priceAmountMicros: micros, formattedPrice });
// What Play returns for "exama_student": two base plans, a free-trial offer on each.
const offers: OfferLike[] = [
  { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-m', displayPrice: '14,99 €', pricingPhasesAndroid: { pricingPhaseList: [phase('14990000', '14,99 €')] } },
  { id: 'free-trial', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-m-trial', displayPrice: 'Free', pricingPhasesAndroid: { pricingPhaseList: [phase('0', 'Free'), phase('14990000', '14,99 €')] } },
  { id: null, basePlanIdAndroid: 'annual', offerTokenAndroid: 'tok-a', displayPrice: '79,99 €', pricingPhasesAndroid: { pricingPhaseList: [phase('79990000', '79,99 €')] } },
  { id: 'free-trial', basePlanIdAndroid: 'annual', offerTokenAndroid: 'tok-a-trial', paymentMode: 'free-trial', displayPrice: 'Free' },
];

test('Google Play: trial offer only when the server says the account is eligible; else the base plan', () => {
  assert.equal(pickGoogleOfferToken(offers, 'monthly', true), 'tok-m-trial');
  assert.equal(pickGoogleOfferToken(offers, 'monthly', false), 'tok-m');
  assert.equal(pickGoogleOfferToken(offers, 'annual', true), 'tok-a-trial');
  assert.equal(pickGoogleOfferToken(offers, 'annual', false), 'tok-a');
  // Play hides offers the user isn't eligible for: no trial offer → base plan even if eligible here.
  assert.equal(pickGoogleOfferToken(offers.filter((o) => o.id !== 'free-trial'), 'monthly', true), 'tok-m');
  // Never falls back to a trial when the account already used its trial.
  assert.equal(pickGoogleOfferToken(offers.filter((o) => o.id === 'free-trial'), 'monthly', false), null);
  assert.equal(pickGoogleOfferToken(offers, 'weekly', false), null, 'unknown base plan');
  assert.equal(pickGoogleOfferToken([{ ...offers[0], offerTokenAndroid: null }], 'monthly', false), null, 'no token → not purchasable');
});

test('Google Play: the displayed price is the recurring (paid) price, never "Free"', () => {
  assert.equal(googleRecurringPrice(offers, 'monthly'), '14,99 €');
  assert.equal(googleRecurringPrice(offers, 'annual'), '79,99 €');
  assert.equal(googleRecurringPrice(offers.filter((o) => o.id === 'free-trial'), 'monthly'), '14,99 €', 'from the trial offer’s paid phase');
  assert.equal(googleRecurringPrice(offers.filter((o) => o.id === 'free-trial'), 'annual'), null);
  assert.equal(googleRecurringPrice([], 'monthly'), null);
});

test('every plan (Basic, Student, Pro × monthly/yearly) maps to an App Store product and a Google Play product + base plan', () => {
  assert.equal(PLANS.length, 6);
  for (const p of PLANS) {
    assert.match(p.appleProductId, /^com\.exama\.app\./);
    assert.match(p.googleProductId, /^exama_(basic|student|pro)$/);
    assert.ok(p.googleBasePlanId === (p.period === 'yearly' ? 'annual' : 'monthly'));
    assert.equal(p.appleProductId, `com.exama.app.${p.tier}.${p.period === 'yearly' ? 'annual' : 'monthly'}`);
  }
  assert.equal(new Set(PLANS.map((p) => `${p.googleProductId}/${p.googleBasePlanId}`)).size, PLANS.length);
});

test('store names and error codes', () => {
  assert.equal(storeName('apple'), 'App Store');
  assert.equal(storeName('google'), 'Google Play');
  assert.equal(storeName('mock', 'android'), 'Google Play');
  assert.equal(storeName(null, 'ios'), 'App Store');
  assert.deepEqual([isStoreProvider('apple'), isStoreProvider('google'), isStoreProvider('mock'), isStoreProvider(null)], [true, true, false, false]);
  assert.equal(storeErrorCode('user-cancelled'), 'purchase_cancelled');
  assert.equal(storeErrorCode('deferred-payment'), 'purchase_pending');
  assert.equal(storeErrorCode('billing-unavailable'), 'store_unavailable');
  assert.equal(storeErrorCode('sku-not-found'), 'store_product_missing');
  assert.equal(storeErrorCode('already-owned'), 'already_subscribed');
  assert.equal(storeErrorCode(undefined), 'purchase_failed');
});

test('Google Play plan change replaces the current subscription (never a second, double-billed one)', () => {
  const me = 'a3b1c2d4-0000-4000-8000-000000000001';
  const ids = ['exama_basic', 'exama_student', 'exama_pro'];
  const owned = [{ productId: 'exama_student', purchaseToken: 'old-tok', purchaseState: 'purchased', currentPlanId: 'monthly', obfuscatedAccountIdAndroid: me }];
  assert.deepEqual(googleReplacement(owned, { productId: 'exama_pro', basePlanId: 'annual' }, ids, me), {
    purchaseToken: 'old-tok',
    subscriptionProductReplacementParams: { oldProductId: 'exama_student', replacementMode: 'with-time-proration' },
  });
  assert.equal(googleReplacement(owned, { productId: 'exama_student', basePlanId: 'annual' }, ids, me)?.purchaseToken, 'old-tok', 'monthly → yearly');
  // Basic → Student upgrade and Student → Basic downgrade replace too.
  const basic = [{ ...owned[0], productId: 'exama_basic' }];
  assert.equal(googleReplacement(basic, { productId: 'exama_student', basePlanId: 'monthly' }, ids, me)?.subscriptionProductReplacementParams.oldProductId, 'exama_basic');
  assert.equal(googleReplacement(owned, { productId: 'exama_basic', basePlanId: 'monthly' }, ids, me)?.subscriptionProductReplacementParams.oldProductId, 'exama_student');
  assert.equal(googleReplacement(owned, { productId: 'exama_student', basePlanId: 'monthly' }, ids, me), null, 'same plan');
  assert.equal(googleReplacement([], { productId: 'exama_pro', basePlanId: 'annual' }, ids, me), null, 'first purchase');
  assert.equal(googleReplacement([{ ...owned[0], obfuscatedAccountIdAndroid: 'someone-else' }], { productId: 'exama_pro', basePlanId: 'annual' }, ids, me), null, 'another Exama account on this Google account');
  assert.equal(googleReplacement([{ ...owned[0], productId: 'other_app_sub' }], { productId: 'exama_pro', basePlanId: 'annual' }, ids, me), null);
  assert.equal(googleReplacement([{ ...owned[0], purchaseState: 'pending' }], { productId: 'exama_pro', basePlanId: 'annual' }, ids, me), null);
});
