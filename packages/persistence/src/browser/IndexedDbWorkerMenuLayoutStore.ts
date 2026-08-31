import {
  parseWorkerMenuLayout,
  type OperationsConfigurationSnapshot,
  type ShopId,
  type WorkerId,
  type WorkerMenuLayout,
  type WorkerMenuLayoutCatalog,
} from '@tux/domain';
import type { WorkerMenuLayoutRepository } from '../workerMenuLayoutStore';
import { applyIndexedDbMigrations, INDEXED_DB_VERSION } from './indexedDbMigrations';

function key(shopId: ShopId, workerId: WorkerId): string {
  return `${shopId}:${workerId}`;
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB Worker Menu Layout request failed.')),
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
        reject(
          transaction.error ?? new Error('IndexedDB Worker Menu Layout transaction aborted.'),
        ),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () =>
        reject(
          transaction.error ?? new Error('IndexedDB Worker Menu Layout transaction failed.'),
        ),
      { once: true },
    );
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, INDEXED_DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction;
      if (transaction === null) throw new Error('IndexedDB upgrade transaction is unavailable.');
      applyIndexedDbMigrations(
        request.result,
        transaction,
        event.oldVersion,
        event.newVersion ?? INDEXED_DB_VERSION,
      );
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open Worker Menu Layout IndexedDB.')),
      { once: true },
    );
  });
}

function stored(layout: WorkerMenuLayout): Record<string, unknown> {
  return {
    id: key(layout.shopId, layout.workerId),
    shopId: layout.shopId,
    workerId: layout.workerId,
    categoryOrder: layout.categoryOrder,
    categoryAlignment: layout.categoryAlignment,
    productOrderByCategory: layout.productOrderByCategory,
    layoutVersion: layout.layoutVersion,
    updatedAt: layout.updatedAt,
    syncState: layout.syncState,
  };
}

export class IndexedDbWorkerMenuLayoutStore implements WorkerMenuLayoutRepository {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openDatabase(this.#name);
  }

  #requiredDatabase(): IDBDatabase {
    if (this.#database === null) throw new Error('Worker Menu Layout store is not initialized.');
    return this.#database;
  }

  async get(shopId: ShopId, workerId: WorkerId): Promise<WorkerMenuLayout | null> {
    const transaction = this.#requiredDatabase().transaction('workerMenuLayouts', 'readonly');
    const completion = transactionDone(transaction);
    const result = await requestResult(
      transaction.objectStore('workerMenuLayouts').get(key(shopId, workerId)),
    );
    await completion;
    return result === undefined ? null : parseWorkerMenuLayout(result);
  }

  async put(layout: WorkerMenuLayout): Promise<void> {
    const parsed = parseWorkerMenuLayout(layout);
    const transaction = this.#requiredDatabase().transaction('workerMenuLayouts', 'readwrite');
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore('workerMenuLayouts').put(stored(parsed)));
    await completion;
  }

  async delete(shopId: ShopId, workerId: WorkerId): Promise<void> {
    const transaction = this.#requiredDatabase().transaction('workerMenuLayouts', 'readwrite');
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore('workerMenuLayouts').delete(key(shopId, workerId)));
    await completion;
  }

  async getCatalog(shopId: ShopId): Promise<WorkerMenuLayoutCatalog> {
    const transaction = this.#requiredDatabase().transaction(
      'configurationSnapshots',
      'readonly',
    );
    const completion = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore('configurationSnapshots').get(shopId));
    await completion;
    if (value === undefined) return { categories: [], products: [] };
    const snapshot = value as OperationsConfigurationSnapshot;
    return { categories: snapshot.categories, products: snapshot.products };
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }
}
