import { DatabaseSync } from 'node:sqlite';
import type {
  AuditEvent,
  InventoryItem,
  InventoryItemId,
  InventoryMovement,
  InventoryMovementId,
  OutboxEvent,
  ShopId,
} from '@tux/domain';
import type { BulkStockMovementCommit, BulkStockStore } from '../bulkStockStore';

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parsePayload<Value>(row: unknown): Value | null {
  if (row === undefined) return null;
  if (typeof row !== 'object' || row === null || !('payload_json' in row)) {
    throw new Error('SQLite Bulk Stock row is missing payload_json.');
  }
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') throw new Error('SQLite Bulk Stock payload_json must be text.');
  return JSON.parse(payload) as Value;
}

export class SqliteBulkStockStore implements BulkStockStore {
  readonly #database: DatabaseSync;
  #initialized = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#database.exec('PRAGMA foreign_keys = ON;');
    this.#database.exec('PRAGMA synchronous = FULL;');
    this.#database.exec('PRAGMA busy_timeout = 5000;');
    this.#initialized = true;
  }

  async listActiveItems(shopId: ShopId): Promise<readonly InventoryItem[]> {
    this.#assertInitialized();
    return this.#database
      .prepare(
        `SELECT payload_json FROM inventory_items
         WHERE shop_id = ? AND tracking_mode = 'BULK_MANUAL' AND active = 1
         ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all(shopId)
      .map((row) => parsePayload<InventoryItem>(row))
      .filter((item): item is InventoryItem => item !== null);
  }

  async listMovements(itemId: InventoryItemId): Promise<readonly InventoryMovement[]> {
    this.#assertInitialized();
    return this.#database
      .prepare(
        `SELECT payload_json FROM inventory_movements
         WHERE item_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(itemId)
      .map((row) => parsePayload<InventoryMovement>(row))
      .filter((movement): movement is InventoryMovement => movement !== null);
  }

  async getMovementById(id: InventoryMovementId): Promise<InventoryMovement | null> {
    this.#assertInitialized();
    return parsePayload<InventoryMovement>(
      this.#database.prepare('SELECT payload_json FROM inventory_movements WHERE id = ?').get(id),
    );
  }

  async hasCompensationFor(id: InventoryMovementId): Promise<boolean> {
    this.#assertInitialized();
    return (
      this.#database
        .prepare('SELECT id FROM inventory_movements WHERE compensates_movement_id = ? LIMIT 1')
        .get(id) !== undefined
    );
  }

  async commitMovement(commit: BulkStockMovementCommit): Promise<void> {
    this.#assertInitialized();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#assertContext(commit);
      this.#assertItem(commit);
      this.#assertCompensation(commit);
      this.#insertMovement(commit.movement);
      this.#appendAudit(commit.audit);
      this.#appendOutbox(commit.outbox);
      this.#database.exec('COMMIT');
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new Error('SQLite Bulk Stock store must be initialized before use.');
    }
  }

  #assertContext(commit: BulkStockMovementCommit): void {
    const day = this.#database
      .prepare('SELECT shop_id, status FROM business_days WHERE id = ?')
      .get(commit.expectedBusinessDayId) as Record<string, unknown> | undefined;
    if (
      day === undefined ||
      day['status'] !== 'OPEN' ||
      day['shop_id'] !== commit.expectedShopId ||
      commit.movement.shopId !== commit.expectedShopId ||
      commit.movement.businessDayId !== commit.expectedBusinessDayId
    ) {
      throw new Error('The Business Day changed before the Bulk Stock movement committed.');
    }
    const session = this.#database
      .prepare(
        'SELECT id FROM worker_sessions WHERE business_day_id = ? AND worker_id = ? AND ended_at IS NULL LIMIT 1',
      )
      .get(commit.expectedBusinessDayId, commit.expectedWorkerId);
    if (session === undefined) {
      throw new Error('The Current Operator changed before the Bulk Stock movement committed.');
    }
  }

  #assertItem(commit: BulkStockMovementCommit): void {
    const item = this.#database
      .prepare(
        `SELECT shop_id, tracking_mode, active FROM inventory_items WHERE id = ?`,
      )
      .get(commit.movement.itemId) as Record<string, unknown> | undefined;
    if (
      item === undefined ||
      item['shop_id'] !== commit.expectedShopId ||
      item['tracking_mode'] !== 'BULK_MANUAL' ||
      item['active'] !== 1
    ) {
      throw new Error('The Bulk Stock item is unavailable or no longer worker-trackable.');
    }
  }

  #assertCompensation(commit: BulkStockMovementCommit): void {
    const expected = commit.expectedCompensatedMovementId;
    if (expected === null) {
      if (commit.movement.compensatesMovementId !== null) {
        throw new Error('Unexpected Bulk Stock compensation target.');
      }
      return;
    }
    if (commit.movement.compensatesMovementId !== expected) {
      throw new Error('Bulk Stock compensation target changed before commit.');
    }
    const original = parsePayload<InventoryMovement>(
      this.#database
        .prepare('SELECT payload_json FROM inventory_movements WHERE id = ?')
        .get(expected),
    );
    if (
      original === null ||
      original.shopId !== commit.expectedShopId ||
      original.businessDayId !== commit.expectedBusinessDayId ||
      original.itemId !== commit.movement.itemId ||
      (original.movementType !== 'BULK_UNIT_FINISHED' &&
        original.movementType !== 'BULK_STOCK_RECEIVED')
    ) {
      throw new Error('The original Bulk Stock movement can no longer be undone.');
    }
    const existing = this.#database
      .prepare('SELECT id FROM inventory_movements WHERE compensates_movement_id = ? LIMIT 1')
      .get(expected);
    if (existing !== undefined) {
      throw new Error('The Bulk Stock movement has already been undone.');
    }
  }

  #insertMovement(movement: InventoryMovement): void {
    this.#database
      .prepare(
        `INSERT INTO inventory_movements(
          id, shop_id, business_day_id, item_id, movement_type, quantity_delta_micros,
          idempotency_key, worker_id, order_id, created_at, compensates_movement_id, payload_json
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
  }

  #appendAudit(event: AuditEvent): void {
    this.#database
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
  }

  #appendOutbox(event: OutboxEvent): void {
    this.#database
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
  }
}
