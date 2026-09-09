import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import { OperationsOnlineOrderInboxService } from './onlineOrderInbox';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';
const DEVICE_ID = '88888888-8888-4888-8888-888888888888';

function request(status: 'PENDING' | 'PROCESSING' = 'PENDING'): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status,
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
    processingOrderId: status === 'PROCESSING' ? PROCESSING_ORDER_ID : null,
    processingStartedAt: status === 'PROCESSING' ? instant('2026-09-08T10:05:00.000Z') : null,
    processingExpiresAt: status === 'PROCESSING' ? instant('2026-09-08T10:15:00.000Z') : null,
    processingDeviceId: status === 'PROCESSING' ? DEVICE_ID : null,
    reservationOriginDeviceId: status === 'PROCESSING' ? DEVICE_ID : null,
  };
}

class MemoryStore implements OnlineOrderInboxStore {
  readonly rows = new Map<string, CachedOnlineOrderRequest>();
  async initialize(): Promise<void> {}
  async upsertMany(values: readonly CachedOnlineOrderRequest[]): Promise<void> {
    for (const value of values) this.rows.set(`${value.shopId}:${value.requestId}`, value);
  }
  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    return [...this.rows.values()].filter((value) => value.shopId === shopId);
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

describe('OperationsOnlineOrderInboxService', () => {
  it('publishes cached state first and preserves it when remote refresh is unavailable', async () => {
    const store = new MemoryStore();
    await store.upsertMany([request()]);
    const remote = {
      fetchActiveRequests: vi.fn().mockRejectedValue(new Error('offline')),
      claim: vi.fn(),
      release: vi.fn(),
      reject: vi.fn(),
    };
    const service = new OperationsOnlineOrderInboxService({
      getActiveShopId: vi.fn().mockResolvedValue(SHOP_ID),
      store,
      remote,
    });
    const published: unknown[] = [];
    service.subscribe((snapshot) => published.push(snapshot));

    await expect(service.load()).resolves.toMatchObject({
      requests: [request()],
      syncState: 'REMOTE_UNAVAILABLE',
    });
    expect(published).toHaveLength(2);
    expect(published[0]).toEqual({
      requests: [request()],
      syncState: 'CACHED',
      errorMessage: null,
    });
  });

  it('uses one validated lifecycle for claim, release, and reject', async () => {
    const store = new MemoryStore();
    await store.upsertMany([request()]);
    const processing = request('PROCESSING');
    const remote = {
      fetchActiveRequests: vi.fn(),
      claim: vi.fn().mockResolvedValue({ schemaVersion: 1, ...processing }),
      release: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'PENDING',
      }),
      reject: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'REJECTED',
      }),
    };
    const service = new OperationsOnlineOrderInboxService({
      getActiveShopId: vi.fn().mockResolvedValue(SHOP_ID),
      store,
      remote,
    });

    await expect(service.claim(REQUEST_ID)).resolves.toEqual(processing);
    await expect(service.release(REQUEST_ID, PROCESSING_ORDER_ID)).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: 'PENDING',
      processingOrderId: null,
    });
    await service.claim(REQUEST_ID);
    await expect(
      service.reject(REQUEST_ID, PROCESSING_ORDER_ID, 'Out of service area'),
    ).resolves.toBeUndefined();
    expect(remote.reject).toHaveBeenCalledWith(
      REQUEST_ID,
      PROCESSING_ORDER_ID,
      'Out of service area',
    );
    expect(await store.list(SHOP_ID)).toEqual([]);
  });

  it('does not overwrite a local release with a PROCESSING snapshot fetched before the release', async () => {
    const store = new MemoryStore();
    const processing = request('PROCESSING');
    const released = request('PENDING');
    await store.upsertMany([processing]);

    let resolveFetch!: (value: unknown) => void;
    const remote = {
      fetchActiveRequests: vi.fn().mockImplementation(
        () =>
          new Promise<unknown>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
      claim: vi.fn(),
      release: vi.fn(),
      reject: vi.fn(),
    };
    const service = new OperationsOnlineOrderInboxService({
      getActiveShopId: vi.fn().mockResolvedValue(SHOP_ID),
      store,
      remote,
    });

    const load = service.load();
    await vi.waitFor(() => expect(remote.fetchActiveRequests).toHaveBeenCalledOnce());
    await store.upsertMany([released]);
    resolveFetch({ schemaVersion: 1, requests: [processing] });

    await expect(load).resolves.toMatchObject({ requests: [released], syncState: 'SYNCED' });
    expect(await store.list(SHOP_ID)).toEqual([released]);
  });
});
