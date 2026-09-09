import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnlineOrderInboxPanel } from './OnlineOrderInboxPanel';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');

const request: CachedOnlineOrderRequest = {
  requestId: '33333333-3333-4333-8333-333333333333',
  shopId: SHOP_ID,
  status: 'PROCESSING',
  catalogRevision: 'a'.repeat(64),
  fulfillmentPreference: 'DELIVERY',
  paymentPreference: 'CASH',
  customerName: 'Online Customer',
  normalizedPhone: '01012345678',
  deliveryAddress: 'Nasr City, Cairo',
  trustedItems: [
    {
      productId: '77777777-7777-4777-8777-777777777777',
      productName: 'Online Burger',
      unitPriceMinor: 19_000,
      quantity: 1,
      modifiers: [],
      comboBeverage: null,
      note: null,
    },
  ],
  itemsSubtotalMinor: 19_000,
  orderNote: null,
  createdAt: instant('2026-09-08T10:00:00.000Z'),
  processingOrderId: '66666666-6666-4666-8666-666666666666',
  processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
  processingExpiresAt: instant('2026-09-08T22:05:00.000Z'),
};

const workspace = {
  businessDayId: '22222222-2222-4222-8222-222222222222',
  operator: { id: '99999999-9999-4999-8999-999999999999', displayName: 'Current Worker' },
  configuration: {
    orderTypes: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        shopId: SHOP_ID,
        name: 'Delivery',
        behavior: 'DELIVERY',
        active: true,
      },
    ],
    deliveryZones: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        shopId: SHOP_ID,
        name: 'Nasr City',
        feeMinor: 3_000,
        active: true,
      },
    ],
    paymentMethods: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        shopId: SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        active: true,
      },
    ],
  },
} as never;

describe('OnlineOrderInboxPanel Task 4 acceptance affordance', () => {
  it('renders explicit trusted POS authority controls before Accept in POS can submit', () => {
    const html = renderToStaticMarkup(
      <OnlineOrderInboxPanel
        snapshot={{ requests: [request], syncState: 'SYNCED', errorMessage: null }}
        busyRequestId={null}
        acceptanceWorkspaces={{ [request.requestId]: workspace }}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
        onReject={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(html).toContain('Requested items');
    expect(html).toContain('1 × Online Burger');
    expect(html).toContain('Current operator');
    expect(html).toContain('Open Business Day');
    expect(html).toContain('Fulfillment type');
    expect(html).toContain('Delivery zone');
    expect(html).toContain('Final delivery fee');
    expect(html).toContain('Payment method');
    expect(html).toContain('Customer payment preference is advisory only');
    expect(html).toContain('Accept in POS');
    expect(html).toContain('type="submit" disabled=""');
    expect(html).not.toContain('title="Required POS delivery');
  });
});
