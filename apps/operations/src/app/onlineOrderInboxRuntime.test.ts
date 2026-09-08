import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import type { OnlineOrderInboxSnapshot } from './onlineOrderInboxClient';
import type { OnlineOrderOperationsRemote } from './onlineOrderInboxSync';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

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

class MemoryInboxStore implements OnlineOrderInboxStore {
  readonly rows = new Map<string, CachedOnlineOrderRequest>();

  async initialize(): Promise<void> {}

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    for (const item of requests) this.rows.set(`${item.shopId}:${item.requestId}`, item);
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    return [...this.rows.values()].filter((item) => item.shopId === shopId);
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
});
