import { describe, expect, it } from 'vitest';
import {
  classifyOnlineOrderOperationsStoreError,
  handleOnlineOrderOperationsRequest,
  type OnlineOrderOperationsStore,
} from './online-order-operations.ts';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHOP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORDER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function pending() {
  return {
    requestId: REQUEST,
    shopId: SHOP,
    status: 'PENDING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'PICKUP',
    paymentPreference: 'CASH',
    customerName: 'Customer',
    normalizedPhone: null,
    deliveryAddress: null,
    requestedShopId: SHOP,
    deliveryZoneId: null,
    deliveryZoneName: null,
    deliveryFeeMinor: null,
    deliveryMinimumOrderMinor: null,
    deliveryFallbackUsed: false,
    trustedItems: [],
    itemsSubtotalMinor: 1000,
    orderNote: null,
    promotionId: null,
    loyaltyPointsToRedeem: 0,
    createdAt: '2026-10-24T00:00:00.000Z',
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
    processingDeviceId: null,
    reservationOriginDeviceId: DEVICE,
  };
}

function http(action?: Readonly<Record<string, unknown>>): Request {
  return new Request('https://example.invalid/online-order-operations', {
    method: action ? 'POST' : 'GET',
    headers: {
      authorization: 'Bearer test-token',
      'x-tux-device-id': DEVICE,
      ...(action ? { 'content-type': 'application/json' } : {}),
    },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
}

function dependencies(store: OnlineOrderOperationsStore) {
  return { authenticate: async () => USER, store };
}

describe('online-order reservation conflict and recovery API', () => {
  it('classifies an active reservation owner as a distinct business fence', () => {
    expect(classifyOnlineOrderOperationsStoreError('TUX_ONLINE_ORDER_RESERVATION_OWNED').code).toBe('RESERVATION_OWNED');
  });

  it.each([
    'TUX_ONLINE_ORDER_RESERVATION_TRANSFER_CONFLICT',
    'TUX_ONLINE_ORDER_RESERVATION_RELEASE_CONFLICT',
  ])('classifies %s as a deterministic conflict rather than infrastructure failure', (message) => {
    expect(classifyOnlineOrderOperationsStoreError(message).code).toBe('CONFLICT');
  });

  it('returns HTTP 409 for an active reservation owner without stealing ownership', async () => {
    let mutated = false;
    const store: OnlineOrderOperationsStore = {
      list: async () => [pending()],
      claim: async () => {
        throw classifyOnlineOrderOperationsStoreError('TUX_ONLINE_ORDER_RESERVATION_OWNED');
      },
      release: async () => { mutated = true; throw new Error('unexpected release'); },
      reject: async () => { mutated = true; throw new Error('unexpected reject'); },
    };
    const list = await handleOnlineOrderOperationsRequest(http(), dependencies(store));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { requests: unknown[] }).requests).toHaveLength(1);

    const claimed = await handleOnlineOrderOperationsRequest(
      http({ action: 'CLAIM', requestId: REQUEST }), dependencies(store),
    );
    expect(claimed.status).toBe(409);
    expect(await claimed.json()).toEqual({ error: 'online_order_reservation_owned' });
    expect(mutated).toBe(false);
  });

  it('permits owner-controlled release then fresh claim and idempotent retry', async () => {
    let status: 'PENDING' | 'PROCESSING' = 'PENDING';
    let claimCalls = 0;
    const store: OnlineOrderOperationsStore = {
      list: async () => [status === 'PENDING' ? pending() : {
        ...pending(), status, processingOrderId: ORDER,
        processingStartedAt: '2026-10-24T00:01:00.000Z',
        processingExpiresAt: '2026-10-24T12:01:00.000Z', processingDeviceId: DEVICE,
      }],
      claim: async () => {
        claimCalls++;
        status = 'PROCESSING';
        return {
          ...pending(), status: 'PROCESSING', processingOrderId: ORDER,
          processingStartedAt: '2026-10-24T00:01:00.000Z',
          processingExpiresAt: '2026-10-24T12:01:00.000Z', processingDeviceId: DEVICE,
        };
      },
      release: async () => {
        status = 'PENDING';
        return { requestId: REQUEST, status: 'PENDING' };
      },
      reject: async () => ({ requestId: REQUEST, status: 'REJECTED' }),
    };
    const claims = [
      await handleOnlineOrderOperationsRequest(http({ action: 'CLAIM', requestId: REQUEST }), dependencies(store)),
      await handleOnlineOrderOperationsRequest(http({ action: 'CLAIM', requestId: REQUEST }), dependencies(store)),
    ];
    expect(claims.map((response) => response.status)).toEqual([200, 200]);
    expect(((await claims[0]!.json()) as { processingOrderId: string }).processingOrderId).toBe(ORDER);
    expect(((await claims[1]!.json()) as { processingOrderId: string }).processingOrderId).toBe(ORDER);
    expect(claimCalls).toBe(2);
    const release = await handleOnlineOrderOperationsRequest(
      http({ action: 'RELEASE', requestId: REQUEST, processingOrderId: ORDER }), dependencies(store),
    );
    expect(release.status).toBe(200);
    expect((await release.json() as { status: string }).status).toBe('PENDING');
    const retry = await handleOnlineOrderOperationsRequest(
      http({ action: 'CLAIM', requestId: REQUEST }), dependencies(store),
    );
    expect(retry.status).toBe(200);
    expect((await retry.json() as { status: string }).status).toBe('PROCESSING');
  });

  it('still treats genuinely unknown store failures as HTTP 503', async () => {
    const store: OnlineOrderOperationsStore = {
      list: async () => { throw classifyOnlineOrderOperationsStoreError('connection timed out'); },
      claim: async () => pending(),
      release: async () => ({ requestId: REQUEST, status: 'PENDING' }),
      reject: async () => ({ requestId: REQUEST, status: 'REJECTED' }),
    };
    const response = await handleOnlineOrderOperationsRequest(http(), dependencies(store));
    expect(response.status).toBe(503);
  });
});
