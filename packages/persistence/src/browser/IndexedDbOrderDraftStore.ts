import { parseOrderDraft, type OrderDraft } from '@tux/domain';
import type { OrderDraftKey, OrderDraftStore } from '../orderDraftStore';

const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB draft request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB draft transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB draft transaction failed.')),
      { once: true },
    );
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const store = request.result.createObjectStore(STORE_NAME, {
        keyPath: ['shopId', 'businessDayId', 'draftScopeId'],
      });
      store.createIndex('checkoutIntent', ['shopId', 'checkoutIntentKey']);
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB draft database.')),
      { once: true },
    );
  });
}

function keyTuple(key: OrderDraftKey): [string, string, string] {
  return [key.shopId, key.businessDayId, key.draftScopeId];
}

export class IndexedDbOrderDraftStore implements OrderDraftStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2-drafts') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openDatabase(this.#name);
    if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined) {
      await navigator.storage.persist();
    }
  }

  async get(key: OrderDraftKey): Promise<OrderDraft | null> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const result = await requestResult(transaction.objectStore(STORE_NAME).get(keyTuple(key)));
    await transactionDone(transaction);
    return result === undefined ? null : parseOrderDraft(result);
  }

  async put(draft: OrderDraft): Promise<void> {
    const validated = parseOrderDraft(draft);
    const database = this.#requireDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    try {
      const key: OrderDraftKey = {
        shopId: validated.shopId,
        businessDayId: validated.businessDayId,
        draftScopeId: validated.draftScopeId,
      };
      const existing = await requestResult(store.get(keyTuple(key)));
      if (
        existing !== undefined &&
        typeof existing === 'object' &&
        existing !== null &&
        'revision' in existing &&
        Number((existing as { revision: unknown }).revision) > validated.revision
      ) {
        throw new Error('Refusing to overwrite a newer durable order draft revision.');
      }
      await requestResult(store.put(validated));
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

  async delete(key: OrderDraftKey): Promise<void> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(transaction);
    try {
      await requestResult(transaction.objectStore(STORE_NAME).delete(keyTuple(key)));
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
      throw new Error('IndexedDB order draft store must be initialized before use.');
    }
    return this.#database;
  }
}
