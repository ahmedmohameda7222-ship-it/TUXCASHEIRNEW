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
      async getLifecycleSyncCursor(shopId) {
        const row = await recordOrNull<{ shopId: string; cursor: string }>(
          store('orderLifecycleSyncCursor').get(shopId),
        );
        return row?.cursor ?? null;
      },
      async setLifecycleSyncCursor(shopId, cursor) {
        if (!cursor) throw new Error('Order lifecycle sync cursor must not be empty.');
        await requestResult(store('orderLifecycleSyncCursor').put({ shopId, cursor }));
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
      async getBalance(itemId) {
        const movements = (await requestResult(
          store('inventoryMovements').getAll(),
        )) as InventoryMovement[];
        let onHandMicros = 0;
        let reservedMicros = 0;
        for (const movement of movements) {
          if (movement.itemId !== itemId) continue;
          onHandMicros += movement.quantityDeltaMicros;
          reservedMicros += movement.reservedDeltaMicros ?? 0;
        }
        return {
          onHandMicros,
          reservedMicros,
          availableMicros: onHandMicros - reservedMicros,
        };
      },
      async appendMovement(movement: InventoryMovement) {
        await requestResult(store('inventoryMovements').add(movement));
      },
      async upsertCanonicalMovement(movement: InventoryMovement) {
        await requestResult(store('inventoryMovements').put(movement));
      },
      async getWeightedUnitCost(itemId) {
        const row = await recordOrNull<{ itemId: string; weightedUnitCostMinor: number }>(
          store('inventoryCostState').get(itemId),
        );
        return row?.weightedUnitCostMinor ?? 0;
      },
      async putWeightedUnitCost(shopId, itemId, unitCostMinor) {
        if (!Number.isFinite(unitCostMinor) || unitCostMinor < 0) {
          throw new Error('Inventory weighted cost must be a non-negative finite number.');
        }
        await requestResult(
          store('inventoryCostState').put({
            itemId,
            shopId,
            weightedUnitCostMinor: unitCostMinor,
          }),
        );
      },
      async getInventorySyncCursor(shopId) {
        const row = await recordOrNull<{ shopId: string; cursor: string }>(
          store('inventorySyncCursor').get(shopId),
        );
        return row?.cursor ?? null;
      },
      async setInventorySyncCursor(shopId, cursor) {
        if (!cursor) throw new Error('Inventory sync cursor must not be empty.');
        await requestResult(store('inventorySyncCursor').put({ shopId, cursor }));
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
      async listPending(now: Instant, limit: number, shopId?: ShopId) {
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          throw new RangeError('Outbox pending limit must be a positive safe integer.');
        }
        const all = (await requestResult(
          store('outboxEvents').index('createdAt').getAll(),
        )) as StoredOutboxEvent[];
        // Do not let a retry-delayed Business Day START/CLOSE be bypassed by
        // newer worker sessions or Orders in the same shop. Preserve other shop
        // progress, and the existing aggregate-quarantine semantics.
        const pending = all
          .filter(
            (event) =>
              event.deliveredAt === null &&
              (shopId === undefined || event.shopId === shopId) &&
              (event.quarantinedAt ?? null) === null,
          )
          .sort((left, right) => {
            const chronological = left.createdAt.localeCompare(right.createdAt);
            if (chronological !== 0) return chronological;
            if (
              left.shopId === right.shopId &&
              left.aggregateType === right.aggregateType &&
              left.aggregateId === right.aggregateId &&
              left.aggregateRevision !== null &&
              right.aggregateRevision !== null &&
              left.aggregateRevision !== right.aggregateRevision
            ) {
              return left.aggregateRevision - right.aggregateRevision;
            }
            // IndexedDB secondary indexes order tied timestamps by random UUID,
            // unlike insertion order in SQLite. Use domain causality for ties.
            const priority = (eventType: string): number => {
              switch (eventType) {
                case 'BUSINESS_DAY_STARTED':
                  return -20;
                case 'WORKER_SIGNED_IN':
                case 'WORKER_SWITCHED':
                  return -10;
                case 'RECONCILIATION_RECORDED':
                  return 10;
                case 'BUSINESS_DAY_CLOSED':
                  return 20;
                case 'WORKER_SIGNED_OUT':
                  return 30;
                default:
                  return 0;
              }
            };
            return priority(left.eventType) - priority(right.eventType);
          });
        const retryBlockedShops = new Set<ShopId>();
        return pending
          .filter((event) => {
            if (retryBlockedShops.has(event.shopId)) return false;
            if (event.nextAttemptAt !== null && event.nextAttemptAt > now) {
              retryBlockedShops.add(event.shopId);
              return false;
            }
            return true;
          })
          .slice(0, limit);
      },
      async getDeliveryStatus(shopId?: ShopId) {
        const all = (await requestResult(
          store('outboxEvents').index('createdAt').getAll(),
        )) as StoredOutboxEvent[];
        const scoped = all.filter((event) => shopId === undefined || event.shopId === shopId);
        const pending = scoped.filter(
          (event) => event.deliveredAt === null && (event.quarantinedAt ?? null) === null,
        );
        const latestFailure = scoped
          .filter((event) => event.deliveredAt === null && event.lastError !== null)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const latestDelivery = scoped
          .filter((event) => event.deliveredAt !== null)
          .sort((left, right) =>
            (right.deliveredAt ?? '').localeCompare(left.deliveredAt ?? ''),
          )[0];
        return {
          pendingCount: pending.length,
          quarantinedCount: scoped.filter(
            (event) => event.deliveredAt === null && (event.quarantinedAt ?? null) !== null,
          ).length,
          nextAttemptAt:
            pending
              .map((event) => event.nextAttemptAt)
              .filter((value): value is Instant => value !== null)
              .sort()[0] ?? null,
          lastError:
            latestFailure?.lastError === null || latestFailure === undefined
              ? null
              : (latestFailure.quarantinedAt ?? null) === null
                ? latestFailure.lastError
                : `${latestFailure.lastError} Event: ${latestFailure.eventType} ${latestFailure.id}; Business Day: ${latestFailure.businessDayId ?? 'none'}.`,
          lastSuccessfulDeliveryAt: latestDelivery?.deliveredAt ?? null,
        };
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
      async recoverMissingBusinessDayStart(businessDayId: BusinessDayId) {
        const objectStore = store('outboxEvents');
        const candidates = (await requestResult(objectStore.getAll())) as StoredOutboxEvent[];
        const origin = candidates
          .filter(
            (event) =>
              event.businessDayId === businessDayId && event.eventType === 'BUSINESS_DAY_STARTED',
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
        if (origin === undefined) return 'MISSING';
        const earliestDependentAt = candidates
          .filter(
            (event) =>
              event.id !== origin.id &&
              event.shopId === origin.shopId &&
              event.deliveredAt === null,
          )
          .map((event) => event.createdAt)
          .sort()[0];
        const recoveredCreatedAt =
          earliestDependentAt !== undefined && origin.createdAt >= earliestDependentAt
            ? (new Date(Date.parse(earliestDependentAt) - 1).toISOString() as Instant)
            : origin.createdAt;
        if (
          origin.deliveredAt === null &&
          origin.quarantinedAt === null &&
          origin.nextAttemptAt === null &&
          recoveredCreatedAt === origin.createdAt
        ) {
          return 'PRESENT';
        }
        await requestResult(
          objectStore.put({
            ...origin,
            createdAt: recoveredCreatedAt,
            attemptCount: 0,
            nextAttemptAt: null,
            lastError: null,
            deliveredAt: null,
            quarantinedAt: null,
            permanentFailureReason: null,
            blockedByEventId: null,
          } satisfies StoredOutboxEvent),
        );
        return 'RECOVERED';
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
