import { describe, expect, it } from 'vitest';
import { handleOnlineOrderOperationsRequest } from './online-order-operations.ts';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHOP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ZONE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function pendingDelivery() {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PENDING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    customerName: 'Delivery Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: 'Nasr City, Cairo',
    requestedShopId: SHOP_ID,
    deliveryZoneId: ZONE_ID,
    deliveryZoneName: 'Nasr City',
    deliveryFeeMinor: 3000,
    deliveryMinimumOrderMinor: 15000,
    deliveryFallbackUsed: false,
    trustedItems: [],
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
  };
}

describe('online-order Operations delivery authority', () => {
  it('preserves the canonical delivery route returned by the trusted store', async () => {
    const response = await handleOnlineOrderOperationsRequest(
      new Request('https://example.invalid/online-order-operations', {
        headers: {
          authorization: 'Bearer test-token',
          'x-tux-device-id': DEVICE_ID,
        },
      }),
      {
        authenticate: async () => AUTH_USER_ID,
        store: {
          list: async () => [pendingDelivery()],
          claim: async () => pendingDelivery(),
          release: async () => ({ requestId: REQUEST_ID, status: 'PENDING' }),
          reject: async () => ({ requestId: REQUEST_ID, status: 'REJECTED' }),
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      requests: Array<Record<string, unknown>>;
    };
    expect(body.requests[0]).toMatchObject({
      deliveryZoneId: ZONE_ID,
      deliveryZoneName: 'Nasr City',
      deliveryFeeMinor: 3000,
      deliveryMinimumOrderMinor: 15000,
      deliveryFallbackUsed: false,
    });
  });
});
