import { describe, expect, it } from 'vitest';
import type { PublicOrderingV2 } from '@tux/catalog-contracts';
import {
  calculatePublishedCheckoutEstimate,
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
    serviceChargeBps: 0,
    taxBps: 0,
    fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
    paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
    ...overrides,
  };
}

describe('published Menu checkout policy', () => {
  it('maps only the published fulfillment, payment, and financial rules to customer-safe policy', () => {
    expect(
      projectPublishedCheckoutPolicy(
        ordering({
          serviceChargeBps: 500,
          taxBps: 1400,
          fulfillmentPreferences: ['DELIVERY', 'PICKUP'],
          paymentPreferences: ['MIXED', 'INSTAPAY'],
        }),
      ),
    ).toEqual({
      available: true,
      minimumOrderMinor: 0,
      serviceChargeBps: 500,
      taxBps: 1400,
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

  it('calculates the same pre-delivery service charge and tax components from published basis points', () => {
    const policy = projectPublishedCheckoutPolicy(
      ordering({ serviceChargeBps: 500, taxBps: 1400 }),
    );

    expect(calculatePublishedCheckoutEstimate(policy, 100)).toEqual({
      itemsSubtotalMinor: 10_000,
      serviceChargeMinor: 500,
      taxMinor: 1_470,
      totalMinor: 11_970,
    });
  });
});
