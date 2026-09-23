import { describe, expect, it } from 'vitest';
import { parseCachedOnlineOrderRequest } from './onlineOrderInboxStore';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ZONE_ID = '33333333-3333-4333-8333-333333333333';

describe('cached online-order delivery authority', () => {
  it('retains canonical route and fee fields for trusted acceptance', () => {
    const parsed = parseCachedOnlineOrderRequest({
      requestId: REQUEST_ID,
      shopId: SHOP_ID,
      status: 'PENDING',
      catalogRevision: 'a'.repeat(64),
      fulfillmentPreference: 'DELIVERY',
      paymentPreference: 'CASH',
      customerName: 'Delivery Customer',
      normalizedPhone: '01012345678',
      deliveryAddress: 'Nasr City, Cairo',
      deliveryZoneId: ZONE_ID,
      deliveryZoneName: 'Nasr City',
      deliveryFeeMinor: 3000,
      deliveryMinimumOrderMinor: 15000,
      deliveryFallbackUsed: false,
      trustedItems: [{ productId: 'product' }],
      itemsSubtotalMinor: 19000,
      orderNote: null,
      promotionId: null,
      loyaltyPointsToRedeem: 0,
      createdAt: '2026-09-23T12:00:00.000Z',
      processingOrderId: null,
      processingStartedAt: null,
      processingExpiresAt: null,
      processingDeviceId: null,
      reservationOriginDeviceId: null,
    });

    expect(parsed).toMatchObject({
      deliveryZoneId: ZONE_ID,
      deliveryZoneName: 'Nasr City',
      deliveryFeeMinor: 3000,
      deliveryMinimumOrderMinor: 15000,
      deliveryFallbackUsed: false,
    });
  });
});
