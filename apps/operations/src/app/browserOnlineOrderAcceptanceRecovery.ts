import { parseEntityId, type OrderId, type ShopId } from '@tux/domain';
import { IndexedDbOperationsDatabase } from '@tux/persistence/browser';

let databasePromise: Promise<IndexedDbOperationsDatabase> | null = null;

async function browserRecoveryDatabase(): Promise<IndexedDbOperationsDatabase> {
  if (databasePromise === null) {
    databasePromise = (async () => {
      const database = new IndexedDbOperationsDatabase();
      await database.initialize();
      return database;
    })();
  }
  return databasePromise;
}

export async function findBrowserCommittedOnlineOrder(
  shopId: ShopId,
  processingOrderId: string,
): Promise<boolean> {
  const database = await browserRecoveryDatabase();
  const order = await database.transaction((transaction) =>
    transaction.orders.getById(parseEntityId<OrderId>(processingOrderId)),
  );
  return order !== null && order.source === 'ONLINE' && order.shopId === shopId;
}
