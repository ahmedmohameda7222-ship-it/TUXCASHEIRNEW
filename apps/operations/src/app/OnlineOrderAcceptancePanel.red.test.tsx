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
  trustedItems: [{ productId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
  itemsSubtotalMinor: 19_000,
  orderNote: null,
  createdAt: instant('2026-09-08T10:00:00.000Z'),
  processingOrderId: '66666666-6666-4666-8666-666666666666',
  processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
  processingExpiresAt: instant('2026-09-08T22:05:00.000Z'),
};

describe('OnlineOrderInboxPanel Task 4 acceptance affordance', () => {
  it('collects explicit delivery/payment authority before enabling Accept in POS', () => {
    const html = renderToStaticMarkup(
      <OnlineOrderInboxPanel
        snapshot={{ requests: [request], syncState: 'SYNCED', errorMessage: null }}
        busyRequestId={null}
        onClaim={vi.fn()}
        onRelease={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('Delivery zone');
    expect(html).toContain('Final delivery fee');
    expect(html).toContain('Payment method');
    expect(html).toContain('Cash received');
    expect(html).not.toMatch(/Accept in POS<\/button>/);
    expect(html).not.toContain('disabled="" title="Required POS delivery');
  });
});
