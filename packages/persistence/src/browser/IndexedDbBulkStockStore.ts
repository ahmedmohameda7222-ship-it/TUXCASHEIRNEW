import type {
  BusinessDay,
  InventoryItem,
  InventoryItemId,
  InventoryMovement,
  InventoryMovementId,
  ShopId,
  WorkerSession,
} from '@tux/domain';
import type { BulkStockMovementCommit, BulkStockStore } from '../bulkStockStore';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    );
  });
}

async function recordOrNull<Value>(request: IDBRequest<unknown>): Promise<Value | null> {
  const value = await requestResult(request);
  return value === undefined ? null : (value as Value);
}

function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let unexpectedUpgrade = false;
    request.addEventListener('upgradeneeded', () => {
      unexpectedUpgrade = true;
      request.transaction?.abort();
    });
    request.addEventListener(
      'success',
      () => {
        if (unexpectedUpgrade) {
          request.result.close();
          reject(
            new Error('Operations IndexedDB must be initialized before the Bulk Stock store.'),
          );
          return;
        }
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open Operations IndexedDB.')),
      { once: true },
    );
  });
}

export class IndexedDbBulkStockStore implements BulkStockStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openExistingDatabase(this.#name);
  }

  async listActiveItems(shopId: ShopId): Promise<readonly InventoryItem[]> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['inventoryItems'], 'readonly');
    const items = (await requestResult(
      transaction
        .objectStore('inventoryItems')
        .index('shopTrackingMode')
        .getAll([shopId, 'BULK_MANUAL']),
    )) as InventoryItem[];
    return items
      .filter((item) => item.active)
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
  }

  async listMovements(itemId: InventoryItemId): Promise<readonly InventoryMovement[]> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['inventoryMovements'], 'readonly');
    const all = (await requestResult(
      transaction.objectStore('inventoryMovements').getAll(),
    )) as InventoryMovement[];
    return all
      .filter((movement) => movement.itemId === itemId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
  }

  async getMovementById(id: InventoryMovementId): Promise<InventoryMovement | null> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['inventoryMovements'], 'readonly');
    return recordOrNull<InventoryMovement>(transaction.objectStore('inventoryMovements').get(id));
  }

  async hasCompensationFor(id: InventoryMovementId): Promise<boolean> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['inventoryMovements'], 'readonly');
    const all = (await requestResult(
      transaction.objectStore('inventoryMovements').getAll(),
    )) as InventoryMovement[];
    return all.some((movement) => movement.compensatesMovementId === id);
  }

  async commitMovement(commit: BulkStockMovementCommit): Promise<void> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(
      [
        'businessDays',
        'workerSessions',
        'inventoryItems',
        'inventoryMovements',
        'auditEvents',
        'outboxEvents',
      ],
      'readwrite',
      { durability: 'strict' },
    );
    const completion = transactionDone(transaction);
    try {
      const day = await recordOrNull<BusinessDay>(
        transaction.objectStore('businessDays').get(commit.expectedBusinessDayId),
      );
      if (
        day === null ||
        day.status !== 'OPEN' ||
        day.shopId !== commit.expectedShopId ||
        commit.movement.shopId !== commit.expectedShopId ||
        commit.movement.businessDayId !== commit.expectedBusinessDayId
      ) {
        throw new Error('The Business Day changed before the Bulk Stock movement committed.');
      }
      const sessions = (await requestResult(
        transaction.objectStore('workerSessions').getAll(),
      )) as WorkerSession[];
      if (
        !sessions.some(
          (session) =>
            session.businessDayId === commit.expectedBusinessDayId &&
            session.workerId === commit.expectedWorkerId &&
            session.endedAt === null,
        )
      ) {
        throw new Error('The Current Operator changed before the Bulk Stock movement committed.');
      }

      const item = await recordOrNull<InventoryItem>(
        transaction.objectStore('inventoryItems').get(commit.movement.itemId),
      );
      if (
        item === null ||
        item.shopId !== commit.expectedShopId ||
        item.trackingMode !== 'BULK_MANUAL' ||
        !item.active
      ) {
        throw new Error('The Bulk Stock item is unavailable or no longer worker-trackable.');
      }

      const movements = transaction.objectStore('inventoryMovements');
      if (commit.expectedCompensatedMovementId === null) {
        if (commit.movement.compensatesMovementId !== null) {
          throw new Error('Unexpected Bulk Stock compensation target.');
        }
      } else {
        if (commit.movement.compensatesMovementId !== commit.expectedCompensatedMovementId) {
          throw new Error('Bulk Stock compensation target changed before commit.');
        }
        const original = await recordOrNull<InventoryMovement>(
          movements.get(commit.expectedCompensatedMovementId),
        );
        const all = (await requestResult(movements.getAll())) as InventoryMovement[];
        if (
          original === null ||
          original.shopId !== commit.expectedShopId ||
          original.businessDayId !== commit.expectedBusinessDayId ||
          original.itemId !== commit.movement.itemId ||
          (original.movementType !== 'BULK_UNIT_FINISHED' &&
            original.movementType !== 'BULK_STOCK_RECEIVED') ||
          all.some(
            (movement) => movement.compensatesMovementId === commit.expectedCompensatedMovementId,
          )
        ) {
          throw new Error('The original Bulk Stock movement can no longer be undone.');
        }
      }

      await requestResult(movements.add(commit.movement));
      await requestResult(transaction.objectStore('auditEvents').add(commit.audit));
      await requestResult(transaction.objectStore('outboxEvents').add(commit.outbox));
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be finished; original error remains authoritative.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }

  #requiredDatabase(): IDBDatabase {
    if (this.#database === null) {
      throw new Error('IndexedDB Bulk Stock store must be initialized before use.');
    }
    return this.#database;
  }
}
