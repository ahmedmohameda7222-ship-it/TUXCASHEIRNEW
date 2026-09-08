import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserOnlineOrderOperationsRemote,
  syncOnlineOrderInboxSnapshot,
} from './onlineOrderInboxSync';

const SHOP_A = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const SHOP_B = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const REQUEST_A = '33333333-3333-4333-8333-333333333333';
const REQUEST_B = '44444444-4444-4444-8444-444444444444';
const REQUEST_C = '55555555-5555-4555-8555-555555555555';
const PROCESSING_ORDER = '66666666-6666-4666-8666-666666666666';

function cachedRequest(
  requestId: string,
  shopId: ShopId,
  overrides: Partial<CachedOnlineOrderRequest> = {},
): CachedOnlineOrderRequest {
  return {
    requestId,
    shopId,
    status: 'PENDING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'PICKUP',
    paymentPreference: 'CASH',
    customerName: 'Online Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: null,
    trustedItems: [{ productId: '77777777-7777-4777-8777-777777777777', quantity: 1 }],
    itemsSubtotalMinor: 12500,
    orderNote: null,
    createdAt: instant('2026-09-08T10:00:00.000Z'),
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
    ...overrides,
  };
}

class MemoryOnlineOrderInboxStore implements OnlineOrderInboxStore {
  readonly rows = new Map<string, CachedOnlineOrderRequest>();
  upsertCalls = 0;
  removeCalls = 0;

  async initialize(): Promise<void> {}

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    this.upsertCalls += 1;
    for (const request of requests) {
      this.rows.set(`${request.shopId}:${request.requestId}`, request);
    }
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    return [...this.rows.values()].filter((request) => request.shopId === shopId);
  }

  async remove(shopId: ShopId, requestId: string): Promise<void> {
    this.removeCalls += 1;
    this.rows.delete(`${shopId}:${requestId}`);
  }

  async close(): Promise<void> {}
}

function remoteSnapshot(requests: readonly CachedOnlineOrderRequest[]): unknown {
  return {
    schemaVersion: 1,
    requests: requests.map((request) => ({ ...request })),
  };
}

describe('syncOnlineOrderInboxSnapshot', () => {
  it('reconciles a successful active snapshot for only the requested shop', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([
      cachedRequest(REQUEST_A, SHOP_A),
      cachedRequest(REQUEST_B, SHOP_A),
      cachedRequest(REQUEST_A, SHOP_B),
    ]);
    store.upsertCalls = 0;

    const processing = cachedRequest(REQUEST_B, SHOP_A, {
      status: 'PROCESSING',
      processingOrderId: PROCESSING_ORDER,
      processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
      processingExpiresAt: instant('2026-09-08T10:10:00.000Z'),
    });
    const remote = {
      fetchActiveRequests: vi
        .fn()
        .mockResolvedValue(remoteSnapshot([processing, cachedRequest(REQUEST_C, SHOP_A)])),
    };

    const result = await syncOnlineOrderInboxSnapshot({ shopId: SHOP_A, store, remote });

    expect(result.map((request) => request.requestId)).toEqual([REQUEST_B, REQUEST_C]);
    expect((await store.list(SHOP_A)).map((request) => request.requestId).sort()).toEqual([
      REQUEST_B,
      REQUEST_C,
    ]);
    expect(await store.list(SHOP_B)).toHaveLength(1);
    expect((await store.list(SHOP_A))[0]?.processingOrderId).toBe(PROCESSING_ORDER);
    expect(store.upsertCalls).toBe(1);
    expect(store.removeCalls).toBe(1);
  });

  it('keeps the cached inbox intact when the remote snapshot fails', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    store.upsertCalls = 0;
    const remote = {
      fetchActiveRequests: vi.fn().mockRejectedValue(new Error('offline')),
    };

    await expect(syncOnlineOrderInboxSnapshot({ shopId: SHOP_A, store, remote })).rejects.toThrow(
      'offline',
    );

    expect((await store.list(SHOP_A)).map((request) => request.requestId)).toEqual([REQUEST_A]);
    expect(store.upsertCalls).toBe(0);
    expect(store.removeCalls).toBe(0);
  });

  it('rejects an invalid or cross-shop snapshot before mutating the cache', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    store.upsertCalls = 0;
    const remote = {
      fetchActiveRequests: vi.fn().mockResolvedValue(remoteSnapshot([cachedRequest(REQUEST_B, SHOP_B)])),
    };

    await expect(syncOnlineOrderInboxSnapshot({ shopId: SHOP_A, store, remote })).rejects.toThrow(
      /shop/i,
    );

    expect((await store.list(SHOP_A)).map((request) => request.requestId)).toEqual([REQUEST_A]);
    expect(store.upsertCalls).toBe(0);
    expect(store.removeCalls).toBe(0);
  });
});

describe('BrowserOnlineOrderOperationsRemote', () => {
  it('reads through the same-origin device-session gateway without browser bearer authority', async () => {
    const responseBody = remoteSnapshot([cachedRequest(REQUEST_A, SHOP_A)]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('window', { location: { origin: 'https://operations.example.test' } });
    vi.stubGlobal('fetch', fetchMock);

    const remote = new BrowserOnlineOrderOperationsRemote();
    await expect(remote.fetchActiveRequests(200)).resolves.toEqual(responseBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://operations.example.test/api/online-order-operations?limit=200',
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    );
  });
});
