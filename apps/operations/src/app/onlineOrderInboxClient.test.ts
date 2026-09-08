import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import { loadOnlineOrderInbox } from './onlineOrderInboxClient';

const SHOP_A = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const SHOP_B = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const REQUEST_A = '33333333-3333-4333-8333-333333333333';
const REQUEST_B = '44444444-4444-4444-8444-444444444444';

function request(
  requestId: string,
  shopId: ShopId,
  createdAt = '2026-09-08T10:00:00.000Z',
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

function snapshot(requests: readonly CachedOnlineOrderRequest[]): unknown {
  return { schemaVersion: 1, requests };
}

describe('loadOnlineOrderInbox', () => {
  it('publishes the local cache before the remote snapshot resolves, then publishes SYNCED data', async () => {
    const store = new MemoryInboxStore();
    await store.upsertMany([request(REQUEST_A, SHOP_A)]);
    let resolveRemote: ((value: unknown) => void) | null = null;
    const remote = {
      fetchActiveRequests: vi.fn().mockImplementation(
        () =>
          new Promise<unknown>((resolve) => {
            resolveRemote = resolve;
          }),
      ),
    };
    const publish = vi.fn();

    const loading = loadOnlineOrderInbox({ shopId: SHOP_A, store, remote, publish });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));

    expect(publish.mock.calls[0]?.[0]).toEqual({
      requests: [request(REQUEST_A, SHOP_A)],
      syncState: 'CACHED',
      errorMessage: null,
    });

    const remoteRequest = request(REQUEST_B, SHOP_A, '2026-09-08T10:05:00.000Z');
    resolveRemote?.(snapshot([remoteRequest]));
    await expect(loading).resolves.toEqual({
      requests: [remoteRequest],
      syncState: 'SYNCED',
      errorMessage: null,
    });
    expect(publish.mock.calls[1]?.[0]).toEqual({
      requests: [remoteRequest],
      syncState: 'SYNCED',
      errorMessage: null,
    });
  });

  it('keeps and republishes the cached inbox when the remote transport is unavailable', async () => {
    const store = new MemoryInboxStore();
    const cached = request(REQUEST_A, SHOP_A);
    await store.upsertMany([cached]);
    const remote = { fetchActiveRequests: vi.fn().mockRejectedValue(new Error('offline')) };
    const publish = vi.fn();

    await expect(loadOnlineOrderInbox({ shopId: SHOP_A, store, remote, publish })).resolves.toEqual({
      requests: [cached],
      syncState: 'REMOTE_UNAVAILABLE',
      errorMessage: 'Online orders could not refresh. Showing the saved inbox.',
    });

    expect(publish.mock.calls.map((call) => call[0])).toEqual([
      { requests: [cached], syncState: 'CACHED', errorMessage: null },
      {
        requests: [cached],
        syncState: 'REMOTE_UNAVAILABLE',
        errorMessage: 'Online orders could not refresh. Showing the saved inbox.',
      },
    ]);
    expect(await store.list(SHOP_A)).toEqual([cached]);
  });

  it('does not poison the local cache when a remote snapshot contains another shop', async () => {
    const store = new MemoryInboxStore();
    const cached = request(REQUEST_A, SHOP_A);
    await store.upsertMany([cached]);
    const remote = {
      fetchActiveRequests: vi.fn().mockResolvedValue(snapshot([request(REQUEST_B, SHOP_B)])),
    };
    const publish = vi.fn();

    const result = await loadOnlineOrderInbox({ shopId: SHOP_A, store, remote, publish });

    expect(result).toEqual({
      requests: [cached],
      syncState: 'REMOTE_UNAVAILABLE',
      errorMessage: 'Online orders could not refresh. Showing the saved inbox.',
    });
    expect(await store.list(SHOP_A)).toEqual([cached]);
    expect(await store.list(SHOP_B)).toEqual([]);
  });
});
