import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserOnlineOrderOperationsRemote,
  claimOnlineOrderForReview,
  rejectOnlineOrderRequest,
  releaseOnlineOrderReview,
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

function processingResponse(
  requestId = REQUEST_A,
  shopId = SHOP_A,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    ...cachedRequest(requestId, shopId, {
      status: 'PROCESSING',
      processingOrderId: PROCESSING_ORDER,
      processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
      processingExpiresAt: instant('2026-09-08T10:10:00.000Z'),
    }),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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
      fetchActiveRequests: vi
        .fn()
        .mockResolvedValue(remoteSnapshot([cachedRequest(REQUEST_B, SHOP_B)])),
    };

    await expect(syncOnlineOrderInboxSnapshot({ shopId: SHOP_A, store, remote })).rejects.toThrow(
      /shop/i,
    );

    expect((await store.list(SHOP_A)).map((request) => request.requestId)).toEqual([REQUEST_A]);
    expect(store.upsertCalls).toBe(0);
    expect(store.removeCalls).toBe(0);
  });
});

describe('online order review lifecycle', () => {
  it('stores a strictly validated PROCESSING claim for the expected shop and request', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    store.upsertCalls = 0;
    const remote = { claim: vi.fn().mockResolvedValue(processingResponse()) };

    const claimed = await claimOnlineOrderForReview({
      shopId: SHOP_A,
      requestId: REQUEST_A,
      store,
      remote,
    });

    expect(claimed.status).toBe('PROCESSING');
    expect(claimed.processingOrderId).toBe(PROCESSING_ORDER);
    expect((await store.list(SHOP_A))[0]).toEqual(claimed);
    expect(store.upsertCalls).toBe(1);
    expect(store.removeCalls).toBe(0);
  });

  it('rejects a cross-shop claim response before mutating the cache', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    store.upsertCalls = 0;
    const remote = { claim: vi.fn().mockResolvedValue(processingResponse(REQUEST_A, SHOP_B)) };

    await expect(
      claimOnlineOrderForReview({ shopId: SHOP_A, requestId: REQUEST_A, store, remote }),
    ).rejects.toThrow(/shop/i);

    expect((await store.list(SHOP_A))[0]?.status).toBe('PENDING');
    expect(store.upsertCalls).toBe(0);
    expect(store.removeCalls).toBe(0);
  });

  it('returns a matching local PROCESSING claim to PENDING only after remote release succeeds', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    const processing = cachedRequest(REQUEST_A, SHOP_A, {
      status: 'PROCESSING',
      processingOrderId: PROCESSING_ORDER,
      processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
      processingExpiresAt: instant('2026-09-08T10:10:00.000Z'),
    });
    await store.upsertMany([processing]);
    store.upsertCalls = 0;
    const remote = {
      release: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_A,
        status: 'PENDING',
      }),
    };

    const released = await releaseOnlineOrderReview({
      shopId: SHOP_A,
      requestId: REQUEST_A,
      processingOrderId: PROCESSING_ORDER,
      store,
      remote,
    });

    expect(released).toEqual({
      ...processing,
      status: 'PENDING',
      processingOrderId: null,
      processingStartedAt: null,
      processingExpiresAt: null,
    });
    expect((await store.list(SHOP_A))[0]).toEqual(released);
    expect(store.upsertCalls).toBe(1);
    expect(store.removeCalls).toBe(0);
  });

  it('removes a request only after a matching REJECTED acknowledgement', async () => {
    const store = new MemoryOnlineOrderInboxStore();
    await store.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    store.removeCalls = 0;
    const remote = {
      reject: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_A,
        status: 'REJECTED',
      }),
    };

    await rejectOnlineOrderRequest({
      shopId: SHOP_A,
      requestId: REQUEST_A,
      reason: 'Customer requested cancellation',
      store,
      remote,
    });

    expect(await store.list(SHOP_A)).toEqual([]);
    expect(store.removeCalls).toBe(1);
  });

  it('does not mutate local state when release/reject acknowledgements target another request', async () => {
    const processing = cachedRequest(REQUEST_A, SHOP_A, {
      status: 'PROCESSING',
      processingOrderId: PROCESSING_ORDER,
      processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
      processingExpiresAt: instant('2026-09-08T10:10:00.000Z'),
    });

    const releaseStore = new MemoryOnlineOrderInboxStore();
    await releaseStore.upsertMany([processing]);
    releaseStore.upsertCalls = 0;
    const releaseRemote = {
      release: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_B,
        status: 'PENDING',
      }),
    };
    await expect(
      releaseOnlineOrderReview({
        shopId: SHOP_A,
        requestId: REQUEST_A,
        processingOrderId: PROCESSING_ORDER,
        store: releaseStore,
        remote: releaseRemote,
      }),
    ).rejects.toThrow(/request/i);
    expect((await releaseStore.list(SHOP_A))[0]).toEqual(processing);
    expect(releaseStore.upsertCalls).toBe(0);

    const rejectStore = new MemoryOnlineOrderInboxStore();
    await rejectStore.upsertMany([cachedRequest(REQUEST_A, SHOP_A)]);
    rejectStore.removeCalls = 0;
    const rejectRemote = {
      reject: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_B,
        status: 'REJECTED',
      }),
    };
    await expect(
      rejectOnlineOrderRequest({
        shopId: SHOP_A,
        requestId: REQUEST_A,
        reason: 'Customer requested cancellation',
        store: rejectStore,
        remote: rejectRemote,
      }),
    ).rejects.toThrow(/request/i);
    expect((await rejectStore.list(SHOP_A)).map((request) => request.requestId)).toEqual([
      REQUEST_A,
    ]);
    expect(rejectStore.removeCalls).toBe(0);
  });
});

describe('BrowserOnlineOrderOperationsRemote', () => {
  it('reads through the same-origin device-session gateway without browser bearer authority', async () => {
    const responseBody = remoteSnapshot([cachedRequest(REQUEST_A, SHOP_A)]);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responseBody));
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

  it('claims, releases, and rejects through the same-origin device-session gateway', async () => {
    const processing = processingResponse();
    const released = { schemaVersion: 1, requestId: REQUEST_A, status: 'PENDING' };
    const rejected = { schemaVersion: 1, requestId: REQUEST_A, status: 'REJECTED' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(processing))
      .mockResolvedValueOnce(jsonResponse(released))
      .mockResolvedValueOnce(jsonResponse(rejected));
    vi.stubGlobal('window', { location: { origin: 'https://operations.example.test' } });
    vi.stubGlobal('fetch', fetchMock);

    const remote = new BrowserOnlineOrderOperationsRemote();
    await expect(remote.claim(REQUEST_A)).resolves.toEqual(processing);
    await expect(remote.release(REQUEST_A, PROCESSING_ORDER)).resolves.toEqual(released);
    await expect(remote.reject(REQUEST_A, 'Customer requested cancellation')).resolves.toEqual(
      rejected,
    );

    const requestOptions = (body: Readonly<Record<string, unknown>>) => ({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        'https://operations.example.test/api/online-order-operations',
        requestOptions({ action: 'CLAIM', requestId: REQUEST_A }),
      ],
      [
        'https://operations.example.test/api/online-order-operations',
        requestOptions({
          action: 'RELEASE',
          requestId: REQUEST_A,
          processingOrderId: PROCESSING_ORDER,
        }),
      ],
      [
        'https://operations.example.test/api/online-order-operations',
        requestOptions({
          action: 'REJECT',
          requestId: REQUEST_A,
          reason: 'Customer requested cancellation',
        }),
      ],
    ]);
  });
});
