import {
  parseWorkerUiPreferences,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '../workerUiPreferencesStore';

interface StoredWorkerUiPreferences {
  readonly id: string;
  readonly shopId: string;
  readonly workerId: string;
  readonly categoryOrder: readonly string[];
  readonly categoryAlignment: WorkerUiPreferences['categoryAlignment'];
  readonly productOrder: readonly string[];
  readonly accentColor: WorkerUiPreferences['accentColor'];
  readonly updatedAt: string;
  readonly serverVersion: number;
  readonly syncState: WorkerUiPreferences['syncState'];
}

function key(shopId: ShopId, workerId: WorkerId): string {
  return `${shopId}:${workerId}`;
}

function stored(preferences: WorkerUiPreferences): StoredWorkerUiPreferences {
  return {
    id: key(preferences.shopId, preferences.workerId),
    shopId: preferences.shopId,
    workerId: preferences.workerId,
    categoryOrder: preferences.categoryOrder,
    categoryAlignment: preferences.categoryAlignment,
    productOrder: preferences.productOrder,
    accentColor: preferences.accentColor,
    updatedAt: preferences.updatedAt,
    serverVersion: preferences.serverVersion,
    syncState: preferences.syncState,
  };
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB worker preference request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () =>
        reject(transaction.error ?? new Error('IndexedDB worker preference transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () =>
        reject(transaction.error ?? new Error('IndexedDB worker preference transaction failed.')),
      { once: true },
    );
  });
}

export function createIndexedDbWorkerUiPreferencesRepository(
  transaction: IDBTransaction,
): WorkerUiPreferencesRepository {
  const store = transaction.objectStore('workerUiPreferences');
  return {
    async get(shopId, workerId) {
      const result = await requestResult(store.get(key(shopId, workerId)));
      return result === undefined ? null : parseWorkerUiPreferences(result);
    },
    async put(preferences) {
      await requestResult(store.put(stored(parseWorkerUiPreferences(preferences))));
    },
    async delete(shopId, workerId) {
      await requestResult(store.delete(key(shopId, workerId)));
    },
  };
}

export class IndexedDbWorkerUiPreferencesStore implements WorkerUiPreferencesRepository {
  readonly #database: IDBDatabase;

  constructor(database: IDBDatabase) {
    this.#database = database;
  }

  async get(shopId: ShopId, workerId: WorkerId): Promise<WorkerUiPreferences | null> {
    const transaction = this.#database.transaction('workerUiPreferences', 'readonly');
    const completion = transactionDone(transaction);
    const result = await createIndexedDbWorkerUiPreferencesRepository(transaction).get(
      shopId,
      workerId,
    );
    await completion;
    return result;
  }

  async put(preferences: WorkerUiPreferences): Promise<void> {
    const transaction = this.#database.transaction('workerUiPreferences', 'readwrite');
    const completion = transactionDone(transaction);
    await createIndexedDbWorkerUiPreferencesRepository(transaction).put(preferences);
    await completion;
  }

  async delete(shopId: ShopId, workerId: WorkerId): Promise<void> {
    const transaction = this.#database.transaction('workerUiPreferences', 'readwrite');
    const completion = transactionDone(transaction);
    await createIndexedDbWorkerUiPreferencesRepository(transaction).delete(shopId, workerId);
    await completion;
  }
}
