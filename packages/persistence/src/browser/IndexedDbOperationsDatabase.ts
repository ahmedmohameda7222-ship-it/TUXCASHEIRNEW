import type {
  AuditEvent,
  BusinessDay,
  BusinessDayId,
  CustomerContact,
  Device,
  DeviceId,
  Expense,
  InventoryItem,
  InventoryMovement,
  OperationsConfigurationSnapshot,
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
import { createIndexedDbWorkerUiPreferencesRepository } from './IndexedDbWorkerUiPreferencesStore';
import { INDEXED_DB_STORES, type IndexedDbStoreName } from './indexedDbMigrations';
import { openOperationsIndexedDb } from './openOperationsIndexedDb';
type StoredOutboxEvent = OutboxEvent & {
  readonly quarantinedAt: Instant | null;
  readonly permanentFailureReason: string | null;
  readonly blockedByEventId: OutboxEventId | null;
};

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

function createRepositories(transaction: IDBTransaction): OperationsTransaction {
  const store = (name: IndexedDbStoreName) => transaction.objectStore(name);
  return {
    shops: {
      async getById(id: ShopId) {
        return recordOrNull<Shop>(store('shops').get(id));
      },
      async put(shop: Shop) {
        await requestResult(store('shops').put(shop));
      },
    },
    devices: {
      async getById(id: DeviceId) {
        return recordOrNull<Device>(store('devices').get(id));
      },
      async put(device: Device) {
        await requestResult(store('devices').put(device));
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
    workerUiPreferences: createIndexedDbWorkerUiPreferencesRepository(transaction),
    configuration: {
      async getForShop(shopId: ShopId) {
        return recordOrNull<OperationsConfigurationSnapshot>(
          store('configurationSnapshots').get(shopId),
        );
      },
      async put(snapshot: OperationsConfigurationSnapshot) {
        if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0) {
          throw new RangeError('Configuration snapshot version must be a positive safe integer.');
        }
        await requestResult(store('configurationSnapshots').put(snapshot));
      },
    },
    customerContacts: {
      async getByNormalizedPhone(shopId: ShopId, normalizedPhone: string) {
        return recordOrNull<CustomerContact>(
          store('customerContacts').index('shopPhone').get([shopId, normalizedPhone]),
        );
      },
      async put(contact: CustomerContact) {
        const contacts = store('customerContacts');
        const existing = await recordOrNull<CustomerContact>(
          contacts.index('shopPhone').get([contact.shopId, contact.normalizedPhone]),
        );
        if (existing !== null && existing.id !== contact.id) {
          throw new Error(
            `Customer contact identity mismatch for normalized phone ${contact.normalizedPhone}.`,
          );
        }
        await requestResult(contacts.put(contact));
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
      async listByBusinessDay(businessDayId: BusinessDayId) {
        const all = (await requestResult(
          store('orders')
            .index('businessDayCreatedAt')
            .getAll(IDBKeyRange.bound([businessDayId, ''], [businessDayId, '\uffff'])),
        )) as OrderSnapshot[];
        return all.sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.displayOrderNo - right.displayOrderNo,
        );
      },
      async insert(order: OrderSnapshot) {
        await requestResult(store('orders').add(order));
      },
      async updateOperationalState(order: OrderSnapshot) {
        const orders = store('orders');
        const existing = await recordOrNull<OrderSnapshot>(orders.get(order.id));
        if (existing === null) throw new Error(`Order ${order.id} was not found.`);
        const updated =
          order.lifecycle === undefined
            ? { ...existing, status: order.status }
            : { ...existing, status: order.status, lifecycle: order.lifecycle };
        await requestResult(orders.put(updated));
      },
    },
    expenses: {
      async put(expense: Expense) {
        await requestResult(store('expenses').put(expense));
      },
    },
    inventory: {
      async listItemsForShop(shopId: ShopId) {
        return (await requestResult(
          store('inventoryItems').index('shopId').getAll(shopId),
        )) as InventoryItem[];
      },
      async replaceConfigurationItems(shopId: ShopId, items: readonly InventoryItem[]) {
        if (items.some((item) => item.shopId !== shopId)) {
          throw new Error('Configuration inventory items must belong to the target shop.');
        }
        const inventoryItems = store('inventoryItems');
        const existing = (await requestResult(
          inventoryItems.index('shopId').getAll(shopId),
        )) as InventoryItem[];
        const incomingIds = new Set(items.map((item) => item.id));
        for (const item of items) await requestResult(inventoryItems.put(item));
        for (const item of existing) {
          if (!incomingIds.has(item.id)) {
            await requestResult(inventoryItems.put({ ...item, active: false }));
          }
        }
      },
      async putItem(item: InventoryItem) {
        await requestResult(store('inventoryItems').put(item));
      },
      async appendMovement(movement: InventoryMovement) {
        await requestResult(store('inventoryMovements').add(movement));
      },
      async listMovementsForOrder(orderId: OrderId) {
        return (await requestResult(
          store('inventoryMovements')
            .index('orderCreatedAt')
            .getAll(IDBKeyRange.bound([orderId, ''], [orderId, '\uffff'])),
        )) as InventoryMovement[];
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
        let blockedByEventId: OutboxEventId | null = null;
        let blockedReason: string | null = null;
        if (event.aggregateRevision !== null && event.aggregateRevision > 0) {
          const predecessors = (await requestResult(
            store('outboxEvents')
              .index('aggregateStream')
              .getAll(
                IDBKeyRange.bound(
                  [event.shopId, event.aggregateType, event.aggregateId, 0],
                  [event.shopId, event.aggregateType, event.aggregateId, event.aggregateRevision],
                  false,
                  true,
                ),
              ),
          )) as StoredOutboxEvent[];
          const predecessor = predecessors
            .filter((candidate) => candidate.quarantinedAt !== null)
            .sort(
              (left, right) => (right.aggregateRevision ?? -1) - (left.aggregateRevision ?? -1),
            )[0];
          if (predecessor !== undefined) {
            blockedByEventId = predecessor.id;
            blockedReason = `DEPENDENCY_BLOCKED_BY:${predecessor.id}`;
          }
        }
        const stored: StoredOutboxEvent = {
          ...event,
          nextAttemptAt: blockedReason === null ? event.nextAttemptAt : null,
          lastError: blockedReason ?? event.lastError,
          quarantinedAt: blockedReason === null ? null : event.createdAt,
          permanentFailureReason: blockedReason,
          blockedByEventId,
        };
        await requestResult(store('outboxEvents').add(stored));
      },
      async listPending(now: Instant, limit: number) {
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          throw new RangeError('Outbox pending limit must be a positive safe integer.');
        }
        const all = (await requestResult(
          store('outboxEvents').index('createdAt').getAll(),
        )) as StoredOutboxEvent[];
        return all
          .filter(
            (event) =>
              event.deliveredAt === null &&
              (event.quarantinedAt ?? null) === null &&
              (event.nextAttemptAt === null || event.nextAttemptAt <= now),
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(0, limit);
      },
      async markDelivered(id: OutboxEventId, deliveredAt: Instant) {
        const objectStore = store('outboxEvents');
        const existing = await recordOrNull<StoredOutboxEvent>(objectStore.get(id));
        if (existing === null) throw new Error(`Outbox event ${id} was not found.`);
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
        const existing = await recordOrNull<StoredOutboxEvent>(objectStore.get(id));
        if (existing === null) throw new Error(`Outbox event ${id} was not found.`);
        await requestResult(
          objectStore.put({ ...existing, attemptCount, nextAttemptAt, lastError }),
        );
      },
      async quarantine(id: OutboxEventId, quarantinedAt: Instant, reason: string) {
        const objectStore = store('outboxEvents');
        const existing = await recordOrNull<StoredOutboxEvent>(objectStore.get(id));
        if (existing === null) throw new Error(`Outbox event ${id} was not found.`);
        await requestResult(
          objectStore.put({
            ...existing,
            quarantinedAt,
            permanentFailureReason: reason,
            lastError: reason,
            nextAttemptAt: null,
          }),
        );
      },
      async quarantineDependents(origin: OutboxEvent, quarantinedAt: Instant, reason: string) {
        if (origin.aggregateRevision === null) return 0;
        const objectStore = store('outboxEvents');
        const candidates = (await requestResult(
          objectStore
            .index('aggregateStream')
            .getAll(
              IDBKeyRange.bound(
                [origin.shopId, origin.aggregateType, origin.aggregateId, origin.aggregateRevision],
                [origin.shopId, origin.aggregateType, origin.aggregateId, Number.MAX_SAFE_INTEGER],
                true,
                false,
              ),
            ),
        )) as StoredOutboxEvent[];
        let blocked = 0;
        for (const candidate of candidates) {
          if (candidate.deliveredAt !== null || candidate.quarantinedAt !== null) continue;
          const blockedReason = `DEPENDENCY_BLOCKED_BY:${origin.id}:${reason}`;
          await requestResult(
            objectStore.put({
              ...candidate,
              quarantinedAt,
              permanentFailureReason: blockedReason,
              blockedByEventId: origin.id,
              lastError: blockedReason,
              nextAttemptAt: null,
            } satisfies StoredOutboxEvent),
          );
          blocked += 1;
        }
        return blocked;
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
    if (this.#database !== null) return;
    this.#database = await openOperationsIndexedDb(this.#name);
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
    const transaction = this.#database.transaction([...INDEXED_DB_STORES], 'readwrite', {
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
