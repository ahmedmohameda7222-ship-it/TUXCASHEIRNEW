import { describe, expect, it } from 'vitest';
import { moneyMinor, type OrderSnapshot } from '@tux/domain';

import { renderOrderReceiptHtml } from './receipt';

// This regression intentionally proves receipt rows are conditional on configured percentage rates.
function orderWithCharges(serviceChargeBps: number, taxBps: number): OrderSnapshot {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    shopId: '20000000-0000-4000-8000-000000000001',
    businessDayId: '30000000-0000-4000-8000-000000000001',
    displayOrderNo: 51,
    idempotencyKey: 'receipt-charge-test',
    status: 'ACTIVE',
    source: 'POS',
    operatorWorkerId: '40000000-0000-4000-8000-000000000001',
    operatorName: 'Worker',
    createdAt: '2026-09-14T03:30:00.000Z',
    fulfillment: {
      orderTypeId: '50000000-0000-4000-8000-000000000001',
      orderTypeLabel: 'Take Away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(10_000),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    serviceChargeMinor: moneyMinor(serviceChargeBps === 0 ? 0 : 1_000),
    taxMinor: moneyMinor(taxBps === 0 ? 0 : 1_540),
    checkoutSnapshot: {
      configurationVersion: 1,
      settingsVersion: 1,
      channel: 'POS',
      minimumOrderMinor: moneyMinor(0),
      minimumOrderSatisfied: true,
      allowDiscountStacking: false,
      allowDeliveryFeeOverride: false,
      serviceChargeBps,
      serviceChargeMinor: moneyMinor(serviceChargeBps === 0 ? 0 : 1_000),
      taxBps,
      taxMinor: moneyMinor(taxBps === 0 ? 0 : 1_540),
      deliveryFeeMinor: moneyMinor(0),
      discountMinor: moneyMinor(0),
      paymentRules: [],
    },
    totalMinor: moneyMinor(
      10_000 + (serviceChargeBps === 0 ? 0 : 1_000) + (taxBps === 0 ? 0 : 1_540),
    ),
    payments: [],
  } as unknown as OrderSnapshot;
}

describe('receipt charge itemization', () => {
  it('renders configured percentage service charge and tax from the immutable order snapshot', () => {
    const html = renderOrderReceiptHtml(orderWithCharges(1_000, 1_400));

    expect(html).toContain('Service charge (10%)');
    expect(html).toContain('10.00');
    expect(html).toContain('Tax (14%)');
    expect(html).toContain('15.40');
  });

  it('does not render service charge or tax rows when the admin-configured rates are zero', () => {
    const html = renderOrderReceiptHtml(orderWithCharges(0, 0));

    expect(html).not.toContain('Service charge');
    expect(html).not.toContain('Tax (');
  });
});
