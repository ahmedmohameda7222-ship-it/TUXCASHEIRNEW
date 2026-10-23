import type { Shop, Worker } from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';

/**
 * The domain session resolver deliberately requires exactly one active shop.
 * Keep old shop data cached, but activate only the branch authenticated by
 * Supabase. The worker PIN was verified against that same shop by Edge first.
 */
export async function selectBrowserShop(
  database: OperationsDatabase,
  readModel: OperatorSessionReadModel,
  shop: Shop,
  worker: Worker,
): Promise<void> {
  if (!shop.active || !worker.active || worker.shopId !== shop.id) {
    throw new Error('Authenticated worker and selected branch do not match.');
  }
  const activeShops = await readModel.listActiveShops();
  await database.transaction(async (transaction) => {
    for (const prior of activeShops) {
      if (prior.id !== shop.id) await transaction.shops.put({ ...prior, active: false });
    }
    await transaction.shops.put(shop);
    await transaction.workers.put(worker);
  });
}
