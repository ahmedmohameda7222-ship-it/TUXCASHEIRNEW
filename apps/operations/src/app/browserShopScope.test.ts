import { describe, expect, it, vi } from 'vitest';
import type { Shop, Worker } from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';
import { selectBrowserShop } from './browserShopScope';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';

describe('selectBrowserShop — cached multi-branch isolation', () => {
  it('deactivates previous local branch without deleting its data', async () => {
    const prior = { id: A, name: 'Downtown', active: true } as Shop;
    const selected = { id: B, name: 'Mall', active: true } as Shop;
    const worker = {
      id: '30000000-0000-4000-8000-000000000001',
      shopId: B,
      displayName: 'Worker B',
      pinHash: 'hash',
      active: true,
    } as Worker;
    const putShop = vi.fn().mockResolvedValue(undefined);
    const putWorker = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({ shops: { put: putShop }, workers: { put: putWorker } }),
    );
    await selectBrowserShop(
      { transaction } as unknown as OperationsDatabase,
      { listActiveShops: vi.fn().mockResolvedValue([prior]) } as unknown as OperatorSessionReadModel,
      selected,
      worker,
    );
    expect(putShop).toHaveBeenNthCalledWith(1, { ...prior, active: false });
    expect(putShop).toHaveBeenNthCalledWith(2, selected);
    expect(putWorker).toHaveBeenCalledWith(worker);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-shop or revoked workers without making local writes', async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as OperationsDatabase;
    const reader = { listActiveShops: vi.fn() } as unknown as OperatorSessionReadModel;
    const shop = { id: A, name: 'Downtown', active: true } as Shop;
    const worker = { shopId: B, active: true } as Worker;
    await expect(selectBrowserShop(database, reader, shop, worker)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
