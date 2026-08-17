import { DatabaseSync } from 'node:sqlite';
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
import { applySqliteMigrations } from './migrations';

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parsePayload<Value>(row: unknown): Value | null {
  if (row === undefined) {
    return null;
  }
  if (typeof row !== 'object' || row === null || !('payload_json' in row)) {
    throw new Error('SQLite row is missing payload_json.');
  }
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') {
    throw new Error('SQLite payload_json must be text.');
  }
  return JSON.parse(payload) as Value;
}

function createTransaction(database: DatabaseSync): OperationsTransaction {
  return {
    shops: {
      async getById(id: ShopId) {
        return parsePayload<Shop>(
          database.prepare('SELECT payload_json FROM shops WHERE id = ?').get(id),
        );
      },
      async put(shop: Shop) {
        database
          .prepare(
            `INSERT INTO shops(id, name, active, payload_json) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active, payload_json = excluded.payload_json`,
          )
          .run(shop.id, shop.name, shop.active ? 1 : 0, serialize(shop));
      },
    },
    devices: {
      async getById(id: DeviceId) {
        return parsePayload<Device>(
          database.prepare('SELECT payload_json FROM devices WHERE id = ?').get(id),
        );
      },
      async put(device: Device) {
        database
          .prepare(
            `INSERT INTO devices(id, shop_id, label, active, payload_json) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET label = excluded.label, active = excluded.active, payload_json = excluded.payload_json`,
          )
          .run(
            device.id,
            device.shopId,
            device.label,
            device.active ? 1 : 0,
            serialize(device),
          );
      },
    },
    workers: {
      async getById(id: WorkerId) {
        return parsePayload<Worker>(
          database.prepare('SELECT payload_json FROM workers WHERE id = ?').get(id),
        );
      },
      async put(worker: Worker) {
        database
          .prepare(
            `INSERT INTO workers(id, shop_id, display_name, pin_hash, active, payload_json) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, pin_hash = excluded.pin_hash, active = excluded.active, payload_json = excluded.payload_json`,
          )
          .run(
            worker.id,
            worker.shopId,
            worker.displayName,
            worker.pinHash,
            worker.active ? 1 : 0,
            serialize(worker),
          );
      },
    },
    workerSessions: {
      async put(session: WorkerSession) {
        database
          .prepare(
            `INSERT INTO worker_sessions(id, shop_id, business_day_id, worker_id, started_at, ended_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, payload_json = excluded.payload_json`,
          )
          .run(
            session.id,
            session.shopId,
            session.businessDayId,
            session.workerId,
            session.startedAt,
            session.endedAt,
            serialize(session),
          );
      },
    },
    configuration: {
      async getForShop(shopId: ShopId) {
        return parsePayload<OperationsConfigurationSnapshot>(
          database
            .prepare('SELECT payload_json FROM configuration_snapshots WHERE shop_id = ?')
            .get(shopId),
        );
      },
      async put(snapshot: OperationsConfigurationSnapshot) {
        if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0) {
          throw new RangeError('Configuration snapshot version must be a positive safe integer.');
        }
        database
          .prepare(
            `INSERT INTO configuration_snapshots(shop_id, version, updated_at, payload_json) VALUES (?, ?, ?, ?)
            ON CONFLICT(shop_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, payload_json = excluded.payload_json`,
          )
          .run(snapshot.shopId, snapshot.version, snapshot.updatedAt, serialize(snapshot));
      },
    },
    customerContacts: {
      async getByNormalizedPhone(shopId: ShopId, normalizedPhone: string) {
        return parsePayload<CustomerContact>(
          database
            .prepare(
              'SELECT payload_json FROM customer_contacts WHERE shop_id = ? AND normalized_phone = ?',
            )
            .get(shopId, normalizedPhone),
        );
      },
      async put(contact: CustomerContact) {
        database
          .prepare(
            `INSERT INTO customer_contacts(
              id, shop_id, normalized_phone, display_phone, name, last_order_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_id, normalized_phone) DO UPDATE SET
              id = excluded.id,
              display_phone = excluded.display_phone,
              name = excluded.name,
              last_order_at = excluded.last_order_at,
              payload_json = excluded.payload_json`,
          )
          .run(
            contact.id,
            contact.shopId,
            contact.normalizedPhone,
            contact.displayPhone,
            contact.name,
            contact.lastOrderAt,
            serialize(contact),
          );
      },
    },
    businessDays: {
      async getById(id: BusinessDayId) {
        return parsePayload<BusinessDay>(
          database.prepare('SELECT payload_json FROM business_days WHERE id = ?').get(id),
        );
      },
      async getOpenForShop(shopId: ShopId) {
        return parsePayload<BusinessDay>(
          database
            .prepare(
              "SELECT payload_json FROM business_days WHERE shop_id = ? AND status = 'OPEN' LIMIT 1",
            )
            .get(shopId),
        );
      },
      async put(day: BusinessDay) {
        database
          .prepare(
            `INSERT INTO business_days(
              id, shop_id, status, started_at, ended_at, started_by_worker_id, ended_by_worker_id,
              last_allocated_display_order_no, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              ended_at = excluded.ended_at,
              ended_by_worker_id = excluded.ended_by_worker_id,
              last_allocated_display_order_no = excluded.last_allocated_display_order_no,
              payload_json = excluded.payload_json`,
          )
          .run(
            day.id,
            day.shopId,
            day.status,
            day.startedAt,
            day.endedAt,
            day.startedByWorkerId,
            day.endedByWorkerId,
            day.lastAllocatedDisplayOrderNo,
            serialize(day),
          );
      },
    },
    orders: {
      async getById(id: OrderId) {
        return parsePayload<OrderSnapshot>(
          database.prepare('SELECT payload_json FROM orders WHERE id = ?').get(id),
        );
      },
      async getByIdempotencyKey(shopId: ShopId, idempotencyKey: string) {
        return parsePayload<OrderSnapshot>(
          database
            .prepare('SELECT payload_json FROM orders WHERE shop_id = ? AND idempotency_key = ?')
            .get(shopId, idempotencyKey),
        );
      },
      async insert(order: OrderSnapshot) {
        database
          .prepare(
            `INSERT INTO orders(
              id, shop_id, business_day_id, display_order_no, idempotency_key, status, source,
              operator_worker_id, created_at, total_minor, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            order.id,
            order.shopId,
            order.businessDayId,
            order.displayOrderNo,
            order.idempotencyKey,
            order.status,
            order.source,
            order.operatorWorkerId,
            order.createdAt,
            order.totalMinor,
            serialize(order),
          );
      },
    },
    expenses: {
      async put(expense: Expense) {
        database
          .prepare(
            `INSERT INTO expenses(id, shop_id, business_day_id, kind, amount_minor, paid_from, order_id, created_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET amount_minor = excluded.amount_minor, paid_from = excluded.paid_from, payload_json = excluded.payload_json`,
          )
          .run(
            expense.id,
            expense.shopId,
            expense.businessDayId,
            expense.kind,
            expense.amountMinor,
            expense.paidFrom,
            expense.orderId,
            expense.createdAt,
            serialize(expense),
          );
      },
    },
    inventory: {
      async putItem(item: InventoryItem) {
        database
          .prepare(
            `INSERT INTO inventory_items(id, shop_id, name, tracking_mode, active, payload_json) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, tracking_mode = excluded.tracking_mode, active = excluded.active, payload_json = excluded.payload_json`,
          )
          .run(
            item.id,
            item.shopId,
            item.name,
            item.trackingMode,
            item.active ? 1 : 0,
            serialize(item),
          );
      },
      async appendMovement(movement: InventoryMovement) {
        database
          .prepare(
            `INSERT INTO inventory_movements(
              id, shop_id, business_day_id, item_id, movement_type, quantity_delta_micros, idempotency_key,
              worker_id, order_id, created_at, compensates_movement_id, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            movement.id,
            movement.shopId,
            movement.businessDayId,
            movement.itemId,
            movement.movementType,
            movement.quantityDeltaMicros,
            movement.idempotencyKey,
            movement.workerId,
            movement.orderId,
            movement.createdAt,
            movement.compensatesMovementId,
            serialize(movement),
          );
      },
    },
    reconciliations: {
      async put(reconciliation: Reconciliation) {
        database
          .prepare(
            `INSERT INTO reconciliations(id, shop_id, business_day_id, created_by_worker_id, created_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(shop_id, business_day_id) DO UPDATE SET
              id = excluded.id,
              created_by_worker_id = excluded.created_by_worker_id,
              created_at = excluded.created_at,
              payload_json = excluded.payload_json`,
          )
          .run(
            reconciliation.id,
            reconciliation.shopId,
            reconciliation.businessDayId,
            reconciliation.createdByWorkerId,
            reconciliation.createdAt,
            serialize(reconciliation),
          );
      },
    },
    audit: {
      async append(event: AuditEvent) {
        database
          .prepare(
            `INSERT INTO audit_events(
              id, shop_id, business_day_id, aggregate_type, aggregate_id, event_type, worker_id, created_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.id,
            event.shopId,
            event.businessDayId,
            event.aggregateType,
            event.aggregateId,
            event.eventType,
            event.workerId,
            event.createdAt,
            serialize(event),
          );
      },
    },
    outbox: {
      async append(event: OutboxEvent) {
        database
          .prepare(
            `INSERT INTO outbox_events(
              id, shop_id, business_day_id, aggregate_type, aggregate_id, event_type, idempotency_key,
              payload_version, payload_json, created_at, attempt_count, next_attempt_at, last_error, delivered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.id,
            event.shopId,
            event.businessDayId,
            event.aggregateType,
            event.aggregateId,
            event.eventType,
            event.idempotencyKey,
            event.payloadVersion,
            serialize(event),
            event.createdAt,
            event.attemptCount,
            event.nextAttemptAt,
            event.lastError,
            event.deliveredAt,
          );
      },
      async listPending(now: Instant, limit: number) {
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          throw new RangeError('Outbox pending limit must be a positive safe integer.');
        }
        const rows = database
          .prepare(
            `SELECT payload_json FROM outbox_events
            WHERE delivered_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC LIMIT ?`,
          )
          .all(now, limit);
        return rows
          .map((row) => parsePayload<OutboxEvent>(row))
          .filter((event): event is OutboxEvent => event !== null);
      },
      async markDelivered(id: OutboxEventId, deliveredAt: Instant) {
        const existing = parsePayload<OutboxEvent>(
          database.prepare('SELECT payload_json FROM outbox_events WHERE id = ?').get(id),
        );
        if (existing === null) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        const updated: OutboxEvent = {
          ...existing,
          deliveredAt,
          lastError: null,
          nextAttemptAt: null,
        };
        database
          .prepare(
            'UPDATE outbox_events SET delivered_at = ?, last_error = NULL, next_attempt_at = NULL, payload_json = ? WHERE id = ?',
          )
          .run(deliveredAt, serialize(updated), id);
      },
      async recordFailure(
        id: OutboxEventId,
        attemptCount: number,
        nextAttemptAt: Instant,
        lastError: string,
      ) {
        const existing = parsePayload<OutboxEvent>(
          database.prepare('SELECT payload_json FROM outbox_events WHERE id = ?').get(id),
        );
        if (existing === null) {
          throw new Error(`Outbox event ${id} was not found.`);
        }
        const updated: OutboxEvent = { ...existing, attemptCount, nextAttemptAt, lastError };
        database
          .prepare(
            `UPDATE outbox_events SET attempt_count = ?, next_attempt_at = ?, last_error = ?, payload_json = ? WHERE id = ?`,
          )
          .run(attemptCount, nextAttemptAt, lastError, serialize(updated), id);
      },
    },
  };
}

export class SqliteOperationsDatabase implements OperationsDatabase {
  readonly #database: DatabaseSync;
  #initialized = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    this.#database.exec('PRAGMA foreign_keys = ON;');
    this.#database.exec('PRAGMA synchronous = FULL;');
    this.#database.exec('PRAGMA busy_timeout = 5000;');
    applySqliteMigrations(this.#database);
    this.#initialized = true;
  }

  async transaction<Result>(
    work: (transaction: OperationsTransaction) => Promise<Result>,
  ): Promise<Result> {
    if (!this.#initialized) {
      throw new Error('SQLite Operations database must be initialized before use.');
    }
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(createTransaction(this.#database));
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }
}
