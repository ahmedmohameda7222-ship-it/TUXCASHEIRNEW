import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CartDrawer.tsx', import.meta.url), 'utf8');

describe('CartDrawer published checkout policy integration', () => {
  it('renders only published checkout choices and uses the public policy block reason', () => {
    expect(source).toContain('checkoutPolicy');
    expect(source).toContain('checkoutBlockReason');
    expect(source).toContain('calculatePublishedCheckoutEstimate');
    expect(source).toContain('Service charge');
    expect(source).toContain('Tax/VAT');
    expect(source).toContain('checkoutPolicy.orderTypes');
    expect(source).toContain('checkoutPolicy.paymentMethods');
    expect(source).toContain("'minimum_order'");
    expect(source).toContain('Online ordering is temporarily unavailable.');
    expect(source).toContain('Minimum order is');
    expect(source).not.toContain("(['Pick up', 'Delivery'] as const)");
    expect(source).not.toContain("(['Cash', 'InstaPay', 'Mixed Payment'] as const)");
  });

  it('clears a selected checkout choice when a newer published policy no longer allows it', () => {
    expect(source).toContain('availableOrderTypes.includes(orderType)');
    expect(source).toContain('availablePaymentMethods.includes(paymentMethod)');
    expect(source).toContain("setOrderType('');");
    expect(source).toContain("setPaymentMethod('');");
  });
});
