import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEntityId, type ShopId } from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';

import {
  HttpInventoryFeedTransport,
  InventoryConvergenceService,
  type InventoryConvergencePage,
  type InventoryFeedTransport,
} from './inventoryConvergence';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000099');

afterEach(() => {
  vi.unstubAllGlobals();
});

class MemoryDatabase implements OperationsDatabase {
  cursor: string | null = null;

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    const transaction = {
      inventory: {
        getInventorySyncCursor: async () => this.cursor,
        setInventorySyncCursor: async (_shopId: ShopId, cursor: string) => {
          this.cursor = cursor;
        },
        putItem: async () => {},
        upsertCanonicalMovement: async () => {},
        putWeightedUnitCost: async () => {},
      },
    } as unknown as OperationsTransaction;
    return work(transaction);
  }
}

function emptyPage(input: { cursor: string; hasMore: boolean }): InventoryConvergencePage {
  return {
    shopId: SHOP_ID,
    items: [],
    movements: [],
    costs: [],
    nextCursor: input.cursor,
    hasMore: input.hasMore,
  };
}

describe('InventoryConvergenceService', () => {
  it('invokes the default browser fetch with the global receiver', async () => {
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            shopId: SHOP_ID,
            items: [],
            movements: [],
            costs: [],
            nextCursor: null,
            hasMore: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', nativeFetch);
    const transport = new HttpInventoryFeedTransport({
      endpoint: 'https://operations.example.test/api/operations-inventory',
    });

    await expect(transport.pull(SHOP_ID, null)).resolves.toMatchObject({ shopId: SHOP_ID });
  });

  it('continues catch-up past the former default page cap until the feed tail', async () => {
    const database = new MemoryDatabase();
    let pulls = 0;
    const transport: InventoryFeedTransport = {
      pull: async () => {
        pulls += 1;
        return emptyPage({
          cursor: `cursor-${pulls}`,
          hasMore: pulls < 21,
        });
      },
    };
    const service = new InventoryConvergenceService(database, transport);

    expect(await service.syncShop(SHOP_ID)).toBe(0);
    expect(pulls).toBe(21);
    expect(database.cursor).toBe('cursor-21');
  });

  it('fails rather than treating a non-advancing hasMore page as caught up', async () => {
    const database = new MemoryDatabase();
    database.cursor = 'cursor-1';
    const transport: InventoryFeedTransport = {
      pull: async () => emptyPage({ cursor: 'cursor-1', hasMore: true }),
    };
    const service = new InventoryConvergenceService(database, transport);

    await expect(service.syncShop(SHOP_ID)).rejects.toThrow(/cursor did not advance/i);
  });
});
