import { describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type OrderId,
  type OrderSnapshot,
  type OrderTypeId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { renderOrderReceiptHtml } from './receipt';

const baseOrder: OrderSnapshot = {
  id: parseEntityId<OrderId>('10000000-0000-4000-8000-000000000001'),
  shopId: parseEntityId<ShopId>('20000000-0000-4000-8000-000000000001'),
  businessDayId: parseEntityId<BusinessDayId>('30000000-0000-4000-8000-000000000001'),
  displayOrderNo: 42,
  idempotencyKey: 'receipt-settings',
  status: 'ACTIVE',
  source: 'POS',
  operatorWorkerId: parseEntityId<WorkerId>('40000000-0000-4000-8000-000000000001'),
  operatorName: 'Worker',
  createdAt: instant('2026-09-11T20:00:00.000Z'),
  fulfillment: {
    orderTypeId: parseEntityId<OrderTypeId>('50000000-0000-4000-8000-000000000001'),
    orderTypeLabel: 'Take Away',
    behavior: 'TAKE_AWAY',
    delivery: null,
  },
  items: [],
  orderNote: null,
  itemsSubtotalMinor: moneyMinor(0),
  discountMinor: moneyMinor(0),
  deliveryFeeMinor: moneyMinor(0),
  totalMinor: moneyMinor(0),
  payments: [],
};

describe('configured receipt rendering', () => {
  it('renders immutable future-order receipt identity and label instead of current defaults', () => {
    const configured = {
      ...baseOrder,
      displayOrderLabel: 'MD-42',
      receiptSnapshot: {
        configurationVersion: 7,
        shopDisplayName: 'TUX Maadi',
        address: 'Road 9',
        contactPhone: '+201000000000',
        footer: 'Thank you',
        orderNumberPrefix: 'MD-',
      },
    } as OrderSnapshot & {
      displayOrderLabel: string;
      receiptSnapshot: {
        configurationVersion: number;
        shopDisplayName: string;
        address: string | null;
        contactPhone: string | null;
        footer: string | null;
        orderNumberPrefix: string;
      };
    };

    const html = renderOrderReceiptHtml(configured);
    expect(html).toContain('TUX Maadi');
    expect(html).toContain('Order MD-42');
    expect(html).toContain('Road 9');
    expect(html).toContain('+201000000000');
    expect(html).toContain('Thank you');
    expect(html).not.toContain('Order #42');
  });

  it('keeps explicit legacy fallback for orders created before receipt snapshots existed', () => {
    const html = renderOrderReceiptHtml(baseOrder);
    expect(html).toContain('<h1>TUX</h1>');
    expect(html).toContain('Order #42');
    expect(html).toContain('Saved locally before printing');
  });
});
