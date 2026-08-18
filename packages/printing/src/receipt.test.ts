import { describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { renderOrderReceiptHtml } from './receipt';

const order: OrderSnapshot = {
  id: parseEntityId<OrderId>('10000000-0000-4000-8000-000000000001'),
  shopId: parseEntityId<ShopId>('20000000-0000-4000-8000-000000000001'),
  businessDayId: parseEntityId<BusinessDayId>('30000000-0000-4000-8000-000000000001'),
  displayOrderNo: 42,
  idempotencyKey: 'test-intent',
  status: 'ACTIVE',
  source: 'POS',
  operatorWorkerId: parseEntityId<WorkerId>('40000000-0000-4000-8000-000000000001'),
  operatorName: 'A&B <Operator>',
  createdAt: instant('2026-08-18T09:30:00.000Z'),
  fulfillment: {
    orderTypeId: parseEntityId<OrderTypeId>('50000000-0000-4000-8000-000000000001'),
    orderTypeLabel: 'Take Away',
    behavior: 'TAKE_AWAY',
    delivery: null,
  },
  items: [
    {
      id: parseEntityId<OrderItemId>('60000000-0000-4000-8000-000000000001'),
      productId: parseEntityId<ProductId>('70000000-0000-4000-8000-000000000001'),
      productName: 'Burger <Special>',
      unitPriceMinor: moneyMinor(12_550),
      quantity: 1,
      modifiers: [],
      comboBeverages: [],
      itemNote: 'No & onions',
    },
  ],
  orderNote: 'Counter > pickup',
  itemsSubtotalMinor: moneyMinor(12_550),
  discountMinor: moneyMinor(550),
  deliveryFeeMinor: moneyMinor(0),
  totalMinor: moneyMinor(12_000),
  payments: [
    {
      id: parseEntityId<PaymentId>('80000000-0000-4000-8000-000000000001'),
      method: {
        id: parseEntityId<PaymentMethodId>('90000000-0000-4000-8000-000000000001'),
        label: 'Cash',
        logicType: 'CASH',
      },
      allocatedMinor: moneyMinor(12_000),
      receivedMinor: moneyMinor(20_000),
      changeMinor: moneyMinor(8_000),
    },
  ],
};

describe('renderOrderReceiptHtml', () => {
  it('renders immutable order, payment and operator snapshots with exact money', () => {
    const html = renderOrderReceiptHtml(order);
    expect(html).toContain('Order #42');
    expect(html).toContain('125.50');
    expect(html).toContain('Total EGP');
    expect(html).toContain('120.00');
    expect(html).toContain('received 200.00');
    expect(html).toContain('change 80.00');
  });

  it('escapes order-controlled text before placing it into receipt HTML', () => {
    const html = renderOrderReceiptHtml(order);
    expect(html).toContain('A&amp;B &lt;Operator&gt;');
    expect(html).toContain('Burger &lt;Special&gt;');
    expect(html).toContain('No &amp; onions');
    expect(html).toContain('Counter &gt; pickup');
    expect(html).not.toContain('<Operator>');
  });
});
