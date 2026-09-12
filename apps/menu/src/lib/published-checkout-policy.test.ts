import { describe, expect, it } from 'vitest';
import type { PublicOrderingV2 } from '@tux/catalog-contracts';
import {
  cartTotalMinor,
  checkoutBlockReason,
  projectPublishedCheckoutPolicy,
} from './published-checkout-policy';

function ordering(overrides: Partial<PublicOrderingV2> = {}): PublicOrderingV2 {
  return {
    available: true,
    temporaryClosed: false,
    onlineOrdersPaused: false,
    minimumOrderMinor: 0,
    fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
    paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
    ...overrides,
  };
}

describe('published Menu checkout policy', () => {
  it('maps only the published fulfillment and payment preferences to existing customer labels', () => {
    expect(
      projectPublishedCheckoutPolicy(
        ordering({
          fulfillmentPreferences: ['DELIVERY', 'PICKUP'],
          paymentPreferences: ['MIXED', 'INSTAPAY'],
        }),
      ),
    ).toEqual({
      available: true,
      minimumOrderMinor: 0,
      orderTypes: ['Delivery', 'Pick up'],
      paymentMethods: ['Mixed Payment', 'InstaPay'],
    });
  });

  it('fails closed when the published shop ordering policy is unavailable', () => {
    const policy = projectPublishedCheckoutPolicy(ordering({ available: false }));

    expect(checkoutBlockReason(policy, 100)).toBe('unavailable');
  });

  it('compares cart totals to the published minimum in integer minor units', () => {
    const policy = projectPublishedCheckoutPolicy(ordering({ minimumOrderMinor: 4500 }));

    expect(cartTotalMinor(44.99)).toBe(4499);
    expect(checkoutBlockReason(policy, 44.99)).toBe('minimum_order');
    expect(cartTotalMinor(45)).toBe(4500);
    expect(checkoutBlockReason(policy, 45)).toBeNull();
  });

  it('rounds floating major-unit totals before enforcing the minor-unit boundary', () => {
    const policy = projectPublishedCheckoutPolicy(ordering({ minimumOrderMinor: 3000 }));

    expect(cartTotalMinor(10.1 + 19.9)).toBe(3000);
    expect(checkoutBlockReason(policy, 10.1 + 19.9)).toBeNull();
  });
});
