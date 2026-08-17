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
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

async function recordOrNull<Value>(request: IDBRequest<unknown>): Promise<Value | null> {
  const result = await requestResult(request);
  return result === undefined ? null : (result as Value);
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
      businessDays.createIndex('shopStatus', ['shopId', 'status']);

      const orders = database.createObjectStore('orders', { keyPath: 'id' });
      orders.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      orders.createIndex('businessDayStatus', ['businessDayId', 'status']);

      const expenses = database.createObjectStore('expenses', { keyPath: 'id' });
      expenses.createIndex('businessDayId', 'businessDayId');

      const inventoryItems = database.createObjectStore('inventoryItems', { keyPath: 'id' });
      inventoryItems.createIndex('shopTrackingMode', ['shopId', 'trackingMode']);

      const inventoryMovements = database.createObjectStore('inventoryMovements', {
        keyPath: 'id',
      });
      inventoryMovements.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], {
        unique: true,
      });

      const reconciliations = database.createObjectStore('reconciliations', { keyPath: 'id' });
      reconciliations.createIndex('shopBusinessDay', ['shopId', 'businessDayId'], { unique: true });

      database.createObjectStore('auditEvents', { keyPath: 'id' });

      const outbox = database.createObjectStore('outboxEvents', { keyPath: 'id' });
      outbox.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      outbox.createIndex('deliveredAt', 'deliveredAt');
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB.')),
      { once: true },
    );
  });
}

function createRepositories(transaction: IDBTransaction): OperationsTransaction {
  const store = (name: StoreName) => transaction.objectStore(name);
  return {
    shops: {
      async getById(id: ShopId) {
        return recordOrNull<Shop>(store('shops').get(id));
      },
      async put(shop: Shop) {
        await requestResult(store('shops').put(shop));
      },
    },
    workers: {
      async getById(id: WorkerId) {
        return recordOrNull<Worker>(store('workers').get(id));
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
        return recordOrNull<BusinessDay>(store('businessDays').get(id));
      },
      async getOpenForShop(shopId: ShopId) {
        return recordOrNull<BusinessDay>(
          store('businessDays').index('shopStatus').get([shopId, 'OPEN']),
        );
      },
      async put(day: BusinessDay) {
        const businessDays = store('businessDays');
        if (day.status === 'OPEN') {
          const existingOpen = await recordOrNull<BusinessDay>(
            businessDays.index('shopStatus').get([day.shopId, 'OPEN']),
          );
          if (existingOpen !== null && existingOpen.id !== day.id) {
            throw new Error(`Shop ${day.shopId} already has an open Business Day.`);
          }
        }
        await requestResult(businessDays.put(day));
      },
    },
    orders: {
      async getById(id: OrderId) {
        return recordOrNull<OrderSnapshot>(store('orders').get(id));
      },
      async getByIdempotencyKey(shopId: ShopId, idempotencyKey: string) {
        return recordOrNull<OrderSnapshot>(
          store('orders').index('shopIdempotency').get([shopId, idempotencyKey]),
        );
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
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          throw new RangeError('Outbox pending limit must be a positive safe integer.');
        }
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
        const existing = await recordOrNull<OutboxEvent>(objectStore.get(id));
        if (existing === null) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        await requestResult(
          objectStore.put({ ...existing, deliveredAt, lastError: null, nextAttemptAt: null }),
        );
      },
      async recordFailure(
        id: OutboxEventId,
        attemptCount: number,
        nextAttemptAt: Instant,
        lastError: string,
      ) {
        const objectStore = store('outboxEvents');
        const existing = await recordOrNull<OutboxEvent>(objectStore.get(id));
        if (existing === null) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        await requestResult(
          objectStore.put({ ...existing, attemptCount, nextAttemptAt, lastError }),
        );
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
    const transaction = this.#database.transaction([...STORES], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(transaction);
    try {
      const result = await work(createRepositories(transaction));
      await completion;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be finished; the original error remains authoritative.
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
