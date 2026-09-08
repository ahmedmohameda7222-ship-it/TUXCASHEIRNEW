import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OnlineOrderInboxPanel } from './OnlineOrderInboxPanel';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';

const acceptanceWorkspace = {
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

function request(status: 'PENDING' | 'PROCESSING'): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status,
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    customerName: 'Online Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: 'Nasr City, Cairo',
    trustedItems: [{ productId: '77777777-7777-4777-8777-777777777777', quantity: 2 }],
    itemsSubtotalMinor: 25000,
    orderNote: 'No onions',
    createdAt: instant('2026-09-08T10:00:00.000Z'),
    processingOrderId: status === 'PROCESSING' ? PROCESSING_ORDER_ID : null,
    processingStartedAt: status === 'PROCESSING' ? instant('2026-09-08T10:05:00.000Z') : null,
    processingExpiresAt: status === 'PROCESSING' ? instant('2026-09-08T22:05:00.000Z') : null,
  };
}

describe('OnlineOrderInboxPanel', () => {
  it('shows a PENDING web request as reviewable without pretending it is already a POS order', () => {
    const html = renderToStaticMarkup(
      <OnlineOrderInboxPanel
        snapshot={{ requests: [request('PENDING')], syncState: 'SYNCED', errorMessage: null }}
        busyRequestId={null}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('Incoming web orders');
    expect(html).toContain('Online Customer');
    expect(html).toContain('Delivery');
    expect(html).toContain('Cash requested');
    expect(html).toContain('Review');
    expect(html).not.toContain('In review');
    expect(html).not.toContain('Order #');
  });

  it('shows PROCESSING authority, release/reject controls, an accept affordance, and missing authoritative facts', () => {
    const html = renderToStaticMarkup(
      <OnlineOrderInboxPanel
        snapshot={{ requests: [request('PROCESSING')], syncState: 'SYNCED', errorMessage: null }}
        busyRequestId={null}
        acceptanceWorkspaces={{ [REQUEST_ID]: acceptanceWorkspace }}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
        onReject={vi.fn()}
        onAccept={vi.fn()}
      />,
    );

    expect(html).toContain('In review');
    expect(html).toContain('Release');
    expect(html).toContain('Reject');
    expect(html).toContain('Accept in POS');
    expect(html).toContain('Confirm before accepting');
    expect(html).toContain('delivery zone and fee');
    expect(html).toContain('payment method and amount');
    expect(html).toContain('current operator and business day');
  });

  it('keeps cached requests visible with an explicit remote-unavailable warning', () => {
    const html = renderToStaticMarkup(
      <OnlineOrderInboxPanel
        snapshot={{
          requests: [request('PENDING')],
          syncState: 'REMOTE_UNAVAILABLE',
          errorMessage: 'Online orders could not refresh. Showing the saved inbox.',
        }}
        busyRequestId={null}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('Online orders could not refresh. Showing the saved inbox.');
    expect(html).toContain('Online Customer');
  });
});
