import type { ShopId } from '@tux/domain';
import {
  parseCachedOnlineOrderRequest,
  type CachedOnlineOrderRequest,
  type OnlineOrderInboxStore,
} from '../onlineOrderInboxStore';

const DATABASE_VERSION = 2;
const STORE_NAME = 'requests';
const ACCEPTED_STORE_NAME = 'accepted';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB online-order inbox request failed.')),
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
        reject(transaction.error ?? new Error('IndexedDB online-order inbox transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () =>
        reject(transaction.error ?? new Error('IndexedDB online-order inbox transaction failed.')),
      { once: true },
    );
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      if (event.oldVersion < 1) {
        const store = request.result.createObjectStore(STORE_NAME, {
          keyPath: ['shopId', 'requestId'],
        });
        store.createIndex('shopCreated', ['shopId', 'createdAt', 'requestId']);
      }
      if (event.oldVersion < 2) {
        request.result.createObjectStore(ACCEPTED_STORE_NAME, {
          keyPath: ['shopId', 'requestId'],
        });
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB online-order inbox.')),
      { once: true },
    );
  });
}

export class IndexedDbOnlineOrderInboxStore implements OnlineOrderInboxStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2-online-order-inbox') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openDatabase(this.#name);
    if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined) {
      await navigator.storage.persist();
    }
  }

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    const validated = requests.map((request) => parseCachedOnlineOrderRequest(request));
    if (validated.length === 0) return;
    const database = this.#requireDatabase();
    const acceptedTransaction = database.transaction(ACCEPTED_STORE_NAME, 'readonly');
    const acceptedRows = (await requestResult(
      acceptedTransaction.objectStore(ACCEPTED_STORE_NAME).getAll(),
    )) as Array<{ shopId: string; requestId: string }>;
    await transactionDone(acceptedTransaction);
    const accepted = new Set(acceptedRows.map((row) => `${row.shopId}:${row.requestId}`));
    const pendingWrites = validated.filter(
      (request) => !accepted.has(`${request.shopId}:${request.requestId}`),
    );
    if (pendingWrites.length === 0) return;
    const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    try {
      const writes = pendingWrites.map((request) => requestResult(store.put(request)));
      await Promise.all(writes);
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    const database = this.#requireDatabase();
    const transaction = database.transaction([STORE_NAME, ACCEPTED_STORE_NAME], 'readonly');
    const rowsRequest = transaction.objectStore(STORE_NAME).getAll();
    const acceptedRequest = transaction.objectStore(ACCEPTED_STORE_NAME).getAll();
    const [rows, acceptedRows] = await Promise.all([
      requestResult(rowsRequest),
      requestResult(acceptedRequest),
    ]);
    await transactionDone(transaction);
    const accepted = new Set(
      (acceptedRows as Array<{ shopId: string; requestId: string }>).map(
        (row) => `${row.shopId}:${row.requestId}`,
      ),
    );
    return rows
      .map((row) => parseCachedOnlineOrderRequest(row))
      .filter(
        (request) =>
          request.shopId === shopId && !accepted.has(`${request.shopId}:${request.requestId}`),
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.requestId.localeCompare(right.requestId),
      );
  }

  async get(shopId: ShopId, requestId: string): Promise<CachedOnlineOrderRequest | null> {
    const database = this.#requireDatabase();
    const transaction = database.transaction([STORE_NAME, ACCEPTED_STORE_NAME], 'readonly');
    const rowRequest = transaction.objectStore(STORE_NAME).get([shopId, requestId]);
    const acceptedRequest = transaction.objectStore(ACCEPTED_STORE_NAME).get([shopId, requestId]);
    const [row, accepted] = await Promise.all([
      requestResult(rowRequest),
      requestResult(acceptedRequest),
    ]);
    await transactionDone(transaction);
    if (accepted !== undefined || row === undefined) return null;
    const parsed = parseCachedOnlineOrderRequest(row);
    return parsed.shopId === shopId ? parsed : null;
  }

  async markAccepted(shopId: ShopId, requestId: string, processingOrderId: string): Promise<void> {
    const database = this.#requireDatabase();
    const transaction = database.transaction([STORE_NAME, ACCEPTED_STORE_NAME], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(transaction);
    try {
      const acceptedStore = transaction.objectStore(ACCEPTED_STORE_NAME);
      const requestStore = transaction.objectStore(STORE_NAME);
      await Promise.all([
        requestResult(acceptedStore.put({ shopId, requestId, processingOrderId })),
        requestResult(requestStore.delete([shopId, requestId])),
      ]);
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* preserve original error */
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async remove(shopId: ShopId, requestId: string): Promise<void> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(transaction);
    try {
      await requestResult(transaction.objectStore(STORE_NAME).delete([shopId, requestId]));
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }

  #requireDatabase(): IDBDatabase {
    if (this.#database === null) {
      throw new Error('IndexedDB online-order inbox store must be initialized before use.');
    }
    return this.#database;
  }
}
