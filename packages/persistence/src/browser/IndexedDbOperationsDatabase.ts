import type {
  AuditEvent,
  BusinessDay,
  BusinessDayId,
  Expense,
  InventoryItem,
  InventoryMovement,
  OrderId,
  OrderSnapshot,
  OutboxEvent,
  OutboxEventId,
  Reconciliation,
  Shop,
  ShopId,
  Worker,
  WorkerId,
  WorkerSession,
} from '@tux/domain';
import type { Instant } from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '../contracts';

const DATABASE_VERSION = 1;
const STORES = [
  'shops',
  'workers',
  'workerSessions',
  'businessDays',
  'orders',
  'expenses',
  'inventoryItems',
  'inventoryMovements',
  'reconciliations',
  'auditEvents',
  'outboxEvents',
] as const;

type StoreName = (typeof STORES)[number];

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')), {
      once: true,
    });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), {
      once: true,
    });
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      const shops = database.createObjectStore('shops', { keyPath: 'id' });
      shops.createIndex('active', 'active');

      const workers = database.createObjectStore('workers', { keyPath: 'id' });
      workers.createIndex('shopId', 'shopId');

      database.createObjectStore('workerSessions', { keyPath: 'id' });

      const businessDays = database.createObjectStore('businessDays', { keyPath: 'id' });
      businessDays.createIndex('shopStatus', ['shopId', 'status'], { unique: true });

      const orders = database.createObjectStore('orders', { keyPath: 'id' });
      orders.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      orders.createIndex('businessDayStatus', ['businessDayId', 'status']);

      const expenses = database.createObjectStore('expenses', { keyPath: 'id' });
      expenses.createIndex('businessDayId', 'businessDayId');

      const inventoryItems = database.createObjectStore('inventoryItems', { keyPath: 'id' });
      inventoryItems.createIndex('shopTrackingMode', ['shopId', 'trackingMode']);

      const inventoryMovements = database.createObjectStore('inventoryMovements', { keyPath: 'id' });
      inventoryMovements.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });

      const reconciliations = database.createObjectStore('reconciliations', { keyPath: 'id' });
      reconciliations.createIndex('shopBusinessDay', ['shopId', 'businessDayId'], { unique: true });

      database.createObjectStore('auditEvents', { keyPath: 'id' });

      const outbox = database.createObjectStore('outboxEvents', { keyPath: 'id' });
      outbox.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      outbox.createIndex('deliveredAt', 'deliveredAt');
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('Could not open IndexedDB.')), {
      once: true,
    });
  });
}

function createRepositories(transaction: IDBTransaction): OperationsTransaction {
  const store = (name: StoreName) => transaction.objectStore(name);
  return {
    shops: {
      async getById(id: ShopId) {
        return (await requestResult(store('shops').get(id))) as Shop | undefined ?? null;
      },
      async put(shop: Shop) {
        await requestResult(store('shops').put(shop));
      },
    },
    workers: {
      async getById(id: WorkerId) {
        return (await requestResult(store('workers').get(id))) as Worker | undefined ?? null;
      },
      async put(worker: Worker) {
        await requestResult(store('workers').put(worker));
      },
    },
    workerSessions: {
      async put(session: WorkerSession) {
        await requestResult(store('workerSessions').put(session));
      },
    },
    businessDays: {
      async getById(id: BusinessDayId) {
        return (await requestResult(store('businessDays').get(id))) as BusinessDay | undefined ?? null;
      },
      async getOpenForShop(shopId: ShopId) {
        return (await requestResult(store('businessDays').index('shopStatus').get([shopId, 'OPEN']))) as
          | BusinessDay
          | undefined ?? null;
      },
      async put(day: BusinessDay) {
        await requestResult(store('businessDays').put(day));
      },
    },
    orders: {
      async getById(id: OrderId) {
        return (await requestResult(store('orders').get(id))) as OrderSnapshot | undefined ?? null;
      },
      async getByIdempotencyKey(shopId: ShopId, idempotencyKey: string) {
        return (await requestResult(store('orders').index('shopIdempotency').get([shopId, idempotencyKey]))) as
          | OrderSnapshot
          | undefined ?? null;
      },
      async insert(order: OrderSnapshot) {
        await requestResult(store('orders').add(order));
      },
    },
    expenses: {
      async put(expense: Expense) {
        await requestResult(store('expenses').put(expense));
      },
    },
    inventory: {
      async putItem(item: InventoryItem) {
        await requestResult(store('inventoryItems').put(item));
      },
      async appendMovement(movement: InventoryMovement) {
        await requestResult(store('inventoryMovements').add(movement));
      },
    },
    reconciliations: {
      async put(reconciliation: Reconciliation) {
        await requestResult(store('reconciliations').put(reconciliation));
      },
    },
    audit: {
      async append(event: AuditEvent) {
        await requestResult(store('auditEvents').add(event));
      },
    },
    outbox: {
      async append(event: OutboxEvent) {
        await requestResult(store('outboxEvents').add(event));
      },
      async listPending(now: Instant, limit: number) {
        const all = (await requestResult(store('outboxEvents').getAll())) as OutboxEvent[];
        return all
          .filter(
            (event) =>
              event.deliveredAt === null &&
              (event.nextAttemptAt === null || event.nextAttemptAt <= now),
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(0, limit);
      },
      async markDelivered(id: OutboxEventId, deliveredAt: Instant) {
        const objectStore = store('outboxEvents');
        const existing = (await requestResult(objectStore.get(id))) as OutboxEvent | undefined;
        if (existing === undefined) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        await requestResult(
          objectStore.put({ ...existing, deliveredAt, lastError: null, nextAttemptAt: null }),
        );
      },
      async recordFailure(id: OutboxEventId, attemptCount: number, nextAttemptAt: Instant, lastError: string) {
        const objectStore = store('outboxEvents');
        const existing = (await requestResult(objectStore.get(id))) as OutboxEvent | undefined;
        if (existing === undefined) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        await requestResult(objectStore.put({ ...existing, attemptCount, nextAttemptAt, lastError }));
      },
    },
  };
}

export class IndexedDbOperationsDatabase implements OperationsDatabase {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) {
      return;
    }
    this.#database = await openDatabase(this.#name);
    if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined) {
      await navigator.storage.persist();
    }
  }

  async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    if (this.#database === null) {
      throw new Error('IndexedDB Operations database must be initialized before use.');
    }
    const transaction = this.#database.transaction([...STORES], 'readwrite', { durability: 'strict' });
    const completion = transactionDone(transaction);
    try {
      const result = await work(createRepositories(transaction));
      await completion;
      return result;
    } catch (error) {
      if (transaction.readyState !== 'done') {
        transaction.abort();
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }
}
