import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import { syncOnlineOrderInboxSnapshot } from './onlineOrderInboxSync';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';
const DEVICE_ID = '88888888-8888-4888-8888-888888888888';

function processingRequest(): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PROCESSING',
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
    processingOrderId: PROCESSING_ORDER_ID,
    processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
    processingExpiresAt: instant('2026-09-08T22:05:00.000Z'),
    processingDeviceId: DEVICE_ID,
    reservationOriginDeviceId: DEVICE_ID,
  };
}

function releasedRequest(): CachedOnlineOrderRequest {
  return {
    ...processingRequest(),
    status: 'PENDING',
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
    processingDeviceId: null,
    reservationOriginDeviceId: null,
  };
}

class TombstoneFilteringStore implements OnlineOrderInboxStore {
  readonly #rows = new Map<string, CachedOnlineOrderRequest>();
  readonly #accepted = new Set<string>();

  #key(shopId: ShopId, requestId: string): string {
    return `${shopId}:${requestId}`;
  }

  async initialize(): Promise<void> {}

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    for (const request of requests) {
      const key = this.#key(request.shopId, request.requestId);
      if (!this.#accepted.has(key)) this.#rows.set(key, request);
    }
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    return [...this.#rows.values()].filter((request) => request.shopId === shopId);
  }

  async get(shopId: ShopId, requestId: string): Promise<CachedOnlineOrderRequest | null> {
    return this.#rows.get(this.#key(shopId, requestId)) ?? null;
  }

  async markAccepted(shopId: ShopId, requestId: string): Promise<void> {
    const key = this.#key(shopId, requestId);
    this.#accepted.add(key);
    this.#rows.delete(key);
  }

  async remove(shopId: ShopId, requestId: string): Promise<void> {
    this.#rows.delete(this.#key(shopId, requestId));
  }

  async close(): Promise<void> {}
}

describe('browser online-order inbox snapshot reconciliation', () => {
  it('publishes the tombstone-filtered local snapshot after remote synchronization', async () => {
    const store = new TombstoneFilteringStore();
    const request = processingRequest();
    await store.upsertMany([request]);
    await store.markAccepted(SHOP_ID, REQUEST_ID);

    const remote = {
      fetchActiveRequests: vi.fn().mockResolvedValue({ schemaVersion: 1, requests: [request] }),
    };

    const result = await syncOnlineOrderInboxSnapshot({ shopId: SHOP_ID, store, remote });

    expect(result).toEqual([]);
    expect(await store.list(SHOP_ID)).toEqual([]);
  });

  it('does not overwrite a local release with a PROCESSING snapshot fetched before the release', async () => {
    const store = new TombstoneFilteringStore();
    const processing = processingRequest();
    const released = releasedRequest();
    await store.upsertMany([processing]);

    let resolveFetch!: (value: unknown) => void;
    const remote = {
      fetchActiveRequests: vi.fn().mockImplementation(
        () =>
          new Promise<unknown>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    };

    const synchronization = syncOnlineOrderInboxSnapshot({ shopId: SHOP_ID, store, remote });
    await vi.waitFor(() => expect(remote.fetchActiveRequests).toHaveBeenCalledOnce());

    await store.upsertMany([released]);
    resolveFetch({ schemaVersion: 1, requests: [processing] });

    await expect(synchronization).resolves.toEqual([released]);
    expect(await store.list(SHOP_ID)).toEqual([released]);
  });
});
