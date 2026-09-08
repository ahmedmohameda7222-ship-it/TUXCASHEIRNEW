import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import type { OnlineOrderInboxSnapshot } from './onlineOrderInboxClient';
import type { OnlineOrderOperationsRemote } from './onlineOrderInboxSync';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_ORDER_ID = '77777777-7777-4777-8777-777777777777';

function request(createdAt = '2026-09-08T10:00:00.000Z'): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PENDING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'PICKUP',
    paymentPreference: 'CASH',
    customerName: 'Online Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: null,
    trustedItems: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 1 }],
    itemsSubtotalMinor: 12500,
    orderNote: null,
    createdAt: instant(createdAt),
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
  };
}

function processingRequest(): CachedOnlineOrderRequest {
  return {
    ...request(),
    status: 'PROCESSING',
    processingOrderId: PROCESSING_ORDER_ID,
    processingStartedAt: instant('2026-09-08T10:10:00.000Z'),
    processingExpiresAt: instant('2026-09-08T10:20:00.000Z'),
  };
}

function releasedRequest(): CachedOnlineOrderRequest {
  return {
    ...processingRequest(),
    status: 'PENDING',
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
  };
}

class MemoryInboxStore implements OnlineOrderInboxStore {
  readonly rows = new Map<string, CachedOnlineOrderRequest>();

  async initialize(): Promise<void> {}

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    for (const item of requests) this.rows.set(`${item.shopId}:${item.requestId}`, item);
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    return [...this.rows.values()].filter((item) => item.shopId === shopId);
  }

  async get(shopId: ShopId, requestId: string): Promise<CachedOnlineOrderRequest | null> {
    return this.rows.get(`${shopId}:${requestId}`) ?? null;
  }

  async markAccepted(shopId: ShopId, requestId: string): Promise<void> {
    this.rows.delete(`${shopId}:${requestId}`);
  }

  async remove(shopId: ShopId, requestId: string): Promise<void> {
    this.rows.delete(`${shopId}:${requestId}`);
  }

  async close(): Promise<void> {}
}

type RuntimeClient = {
  load(): Promise<OnlineOrderInboxSnapshot>;
  subscribe(listener: (snapshot: OnlineOrderInboxSnapshot) => void): () => void;
};

type RuntimeFactory = (input: {
  getActiveShopId: () => Promise<ShopId>;
  store: OnlineOrderInboxStore;
  remote: OnlineOrderOperationsRemote;
}) => RuntimeClient;

type ReviewRemote = OnlineOrderOperationsRemote & {
  claim(requestId: string): Promise<unknown>;
};

type ReviewRuntimeClient = RuntimeClient & {
  claim(requestId: string): Promise<CachedOnlineOrderRequest>;
};

type ReviewRuntimeFactory = (input: {
  getActiveShopId: () => Promise<ShopId>;
  store: OnlineOrderInboxStore;
  remote: ReviewRemote;
}) => ReviewRuntimeClient;

type ReleaseRemote = OnlineOrderOperationsRemote & {
  release(requestId: string, processingOrderId: string): Promise<unknown>;
};

type ReleaseRuntimeClient = RuntimeClient & {
  release(requestId: string, processingOrderId: string): Promise<CachedOnlineOrderRequest>;
};

type ReleaseRuntimeFactory = (input: {
  getActiveShopId: () => Promise<ShopId>;
  store: OnlineOrderInboxStore;
  remote: ReleaseRemote;
}) => ReleaseRuntimeClient;

type RejectRemote = OnlineOrderOperationsRemote & {
  reject(requestId: string, processingOrderId: string, reason: string): Promise<unknown>;
};

type RejectRuntimeClient = RuntimeClient & {
  reject(requestId: string, processingOrderId: string, reason: string): Promise<void>;
};

type RejectRuntimeFactory = (input: {
  getActiveShopId: () => Promise<ShopId>;
  store: OnlineOrderInboxStore;
  remote: RejectRemote;
}) => RejectRuntimeClient;

describe('online-order inbox runtime', () => {
  it('derives the active shop and publishes cached state before the synced snapshot', async () => {
    const module = (await import('./onlineOrderInboxClient')) as Record<string, unknown>;
    const factory = module['createOnlineOrderInboxRuntime'];
    expect(typeof factory).toBe('function');

    const store = new MemoryInboxStore();
    const cached = request();
    const synced = request('2026-09-08T10:05:00.000Z');
    await store.upsertMany([cached]);
    const remote = {
      fetchActiveRequests: vi.fn().mockResolvedValue({ schemaVersion: 1, requests: [synced] }),
    };
    const getActiveShopId = vi.fn().mockResolvedValue(SHOP_ID);
    const runtime = (factory as RuntimeFactory)({ getActiveShopId, store, remote });
    const published: OnlineOrderInboxSnapshot[] = [];
    const unsubscribe = runtime.subscribe((snapshot) => published.push(snapshot));

    await expect(runtime.load()).resolves.toEqual({
      requests: [synced],
      syncState: 'SYNCED',
      errorMessage: null,
    });

    expect(getActiveShopId).toHaveBeenCalledTimes(1);
    expect(published).toEqual([
      { requests: [cached], syncState: 'CACHED', errorMessage: null },
      { requests: [synced], syncState: 'SYNCED', errorMessage: null },
    ]);
    unsubscribe();
  });

  it('claims a request for the active shop, persists PROCESSING authority, and publishes it', async () => {
    const module = (await import('./onlineOrderInboxClient')) as Record<string, unknown>;
    const factory = module['createOnlineOrderInboxRuntime'];
    expect(typeof factory).toBe('function');

    const store = new MemoryInboxStore();
    await store.upsertMany([request()]);
    const claimed = processingRequest();
    const remote: ReviewRemote = {
      fetchActiveRequests: vi.fn(),
      claim: vi.fn().mockResolvedValue({ schemaVersion: 1, ...claimed }),
    };
    const getActiveShopId = vi.fn().mockResolvedValue(SHOP_ID);
    const runtime = (factory as ReviewRuntimeFactory)({ getActiveShopId, store, remote });
    expect(typeof runtime.claim).toBe('function');
    const published: OnlineOrderInboxSnapshot[] = [];
    runtime.subscribe((snapshot) => published.push(snapshot));

    await expect(runtime.claim(REQUEST_ID)).resolves.toEqual(claimed);

    expect(getActiveShopId).toHaveBeenCalledTimes(1);
    expect(remote.claim).toHaveBeenCalledWith(REQUEST_ID);
    expect(await store.list(SHOP_ID)).toEqual([claimed]);
    expect(published).toEqual([{ requests: [claimed], syncState: 'SYNCED', errorMessage: null }]);
  });

  it('releases a matching PROCESSING claim back to PENDING and publishes it', async () => {
    const module = (await import('./onlineOrderInboxClient')) as Record<string, unknown>;
    const factory = module['createOnlineOrderInboxRuntime'];
    expect(typeof factory).toBe('function');

    const store = new MemoryInboxStore();
    await store.upsertMany([processingRequest()]);
    const released = releasedRequest();
    const remote: ReleaseRemote = {
      fetchActiveRequests: vi.fn(),
      release: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'PENDING',
      }),
    };
    const getActiveShopId = vi.fn().mockResolvedValue(SHOP_ID);
    const runtime = (factory as ReleaseRuntimeFactory)({ getActiveShopId, store, remote });
    expect(typeof runtime.release).toBe('function');
    const published: OnlineOrderInboxSnapshot[] = [];
    runtime.subscribe((snapshot) => published.push(snapshot));

    await expect(runtime.release(REQUEST_ID, PROCESSING_ORDER_ID)).resolves.toEqual(released);

    expect(getActiveShopId).toHaveBeenCalledTimes(1);
    expect(remote.release).toHaveBeenCalledWith(REQUEST_ID, PROCESSING_ORDER_ID);
    expect(await store.list(SHOP_ID)).toEqual([released]);
    expect(published).toEqual([{ requests: [released], syncState: 'SYNCED', errorMessage: null }]);
  });

  it('rejects a matching PROCESSING request, removes it locally, and publishes the empty inbox', async () => {
    const module = (await import('./onlineOrderInboxClient')) as Record<string, unknown>;
    const factory = module['createOnlineOrderInboxRuntime'];
    expect(typeof factory).toBe('function');

    const store = new MemoryInboxStore();
    await store.upsertMany([processingRequest()]);
    const remote: RejectRemote = {
      fetchActiveRequests: vi.fn(),
      reject: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'REJECTED',
      }),
    };
    const getActiveShopId = vi.fn().mockResolvedValue(SHOP_ID);
    const runtime = (factory as RejectRuntimeFactory)({ getActiveShopId, store, remote });
    expect(typeof runtime.reject).toBe('function');
    const published: OnlineOrderInboxSnapshot[] = [];
    runtime.subscribe((snapshot) => published.push(snapshot));

    await expect(
      runtime.reject(REQUEST_ID, PROCESSING_ORDER_ID, 'Out of service area'),
    ).resolves.toBeUndefined();

    expect(getActiveShopId).toHaveBeenCalledTimes(1);
    expect(remote.reject).toHaveBeenCalledWith(
      REQUEST_ID,
      PROCESSING_ORDER_ID,
      'Out of service area',
    );
    expect(await store.list(SHOP_ID)).toEqual([]);
    expect(published).toEqual([{ requests: [], syncState: 'SYNCED', errorMessage: null }]);
  });
});
