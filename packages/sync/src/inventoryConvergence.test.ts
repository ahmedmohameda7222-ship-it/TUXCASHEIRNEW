import { describe, expect, it } from 'vitest';
import { parseEntityId, type ShopId } from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';

import {
  InventoryConvergenceService,
  type InventoryConvergencePage,
  type InventoryFeedTransport,
} from './inventoryConvergence';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000099');

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

function emptyPage(input: {
  cursor: string;
  hasMore: boolean;
}): InventoryConvergencePage {
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
