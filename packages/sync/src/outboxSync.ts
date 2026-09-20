import {
  cancelActiveOrder,
  parseEntityId,
  stockQuantityMicros,
  type AuditEventId,
  type EntityId,
  type Instant,
  type InventoryMovement,
  type InventoryMovementId,
  type OrderId,
  type OutboxEvent,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';

export type OutboxFailureKind = 'TRANSIENT' | 'PERMANENT';

export class OutboxDeliveryError extends Error {
  readonly kind: OutboxFailureKind;
  readonly status: number | null;

  constructor(
    message: string,
    kind: OutboxFailureKind,
    status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OutboxDeliveryError';
    this.kind = kind;
    this.status = status;
  }
}

export interface OutboxTransport {
  deliver(event: OutboxEvent): Promise<void>;
}

export interface OutboxSyncRuntime {
  now(): Instant;
}

export interface OutboxSyncSummary {
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly quarantined: number;
  readonly dependencyBlocked: number;
  readonly blockedUntil: Instant | null;
  readonly lastError: string | null;
}

const DEFAULT_BATCH_SIZE = 50;
const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

export function outboxRetryDelayMs(attemptCount: number): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount <= 0) {
    throw new RangeError('Outbox retry attempt count must be a positive safe integer.');
  }
  const exponent = Math.min(attemptCount - 1, 30);
  return Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
}

export function nextOutboxRetryAt(now: Instant, attemptCount: number): Instant {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new RangeError('Outbox retry time must be valid.');
  return new Date(timestamp + outboxRetryDelayMs(attemptCount)).toISOString() as Instant;
}

function normalizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 1_000) || 'Remote outbox delivery failed.';
}

function failureKind(error: unknown): OutboxFailureKind {
  return error instanceof OutboxDeliveryError ? error.kind : 'TRANSIENT';
}

function newEntityId<Id extends EntityId>(): Id {
  return parseEntityId<Id>(globalThis.crypto.randomUUID());
}

function isCanonicalReservationRejection(error: unknown): boolean {
  return error instanceof OutboxDeliveryError && error.kind === 'PERMANENT' && error.status === 422;
}

async function reconcileRejectedOrderPlacement(
  transaction: OperationsTransaction,
  event: OutboxEvent,
  failedAt: Instant,
): Promise<string | null> {
  if (event.aggregateType !== 'ORDER' || event.eventType !== 'ORDER_PLACED') return null;

  let orderId: OrderId;
  try {
    orderId = parseEntityId<OrderId>(event.aggregateId);
  } catch {
    return null;
  }

  const order = await transaction.orders.getById(orderId);
  if (order === null) return null;

  if (order.status === 'DONE') {
    const detail = `Order ${order.displayOrderNo} is already DONE locally after canonical inventory rejection; manual reconciliation required.`;
    await transaction.audit.append({
      id: newEntityId<AuditEventId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType: 'ORDER_SYNC_CONFLICT',
      workerId: order.operatorWorkerId,
      createdAt: failedAt,
      details: {
        syncConflict: 'inventory_reservation_rejected_after_fulfillment',
        localStatus: order.status,
        manualReconciliationRequired: true,
        rejectedOutboxEventId: event.id,
      },
    });
    return detail;
  }

  if (order.status !== 'ACTIVE') return null;

  const existingMovements = await transaction.inventory.listMovementsForOrder(order.id);
  const reservationByItem = new Map<InventoryMovement['itemId'], number>();
  for (const movement of existingMovements) {
    const reservedDelta = movement.reservedDeltaMicros ?? 0;
    if (reservedDelta === 0) continue;
    reservationByItem.set(
      movement.itemId,
      (reservationByItem.get(movement.itemId) ?? 0) + reservedDelta,
    );
  }

  for (const [itemId, reservedMicros] of reservationByItem) {
    if (reservedMicros <= 0) continue;
    await transaction.inventory.appendMovement({
      id: newEntityId<InventoryMovementId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      itemId,
      movementType: 'ORDER_RESERVATION_RELEASE',
      quantityDeltaMicros: stockQuantityMicros(0),
      reservedDeltaMicros: stockQuantityMicros(-reservedMicros),
      idempotencyKey: `sync-rejected-reservation-release:${event.id}:${itemId}`,
      workerId: order.operatorWorkerId,
      orderId: order.id,
      createdAt: failedAt,
      compensatesMovementId: null,
    });
  }

  const cancelled = cancelActiveOrder(order, {
    at: failedAt,
    workerId: order.operatorWorkerId,
    workerName: order.operatorName,
    foodPrepared: false,
    reason: 'Inventory reservation rejected by canonical stock authority.',
  });
  await transaction.orders.updateOperationalState(cancelled);
  await transaction.audit.append({
    id: newEntityId<AuditEventId>(),
    shopId: order.shopId,
    businessDayId: order.businessDayId,
    aggregateType: 'ORDER',
    aggregateId: order.id,
    eventType: 'ORDER_CANCELLED',
    workerId: order.operatorWorkerId,
    createdAt: failedAt,
    details: {
      reason: 'Inventory reservation rejected by canonical stock authority.',
      stockRestored: true,
      syncConflict: 'inventory_reservation_rejected',
      rejectedOutboxEventId: event.id,
    },
  });
  return null;
}

export class OutboxSyncService {
  readonly #database: OperationsDatabase;
  readonly #transport: OutboxTransport;
  readonly #runtime: OutboxSyncRuntime;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    database: OperationsDatabase,
    transport: OutboxTransport,
    runtime: OutboxSyncRuntime,
  ) {
    this.#database = database;
    this.#transport = transport;
    this.#runtime = runtime;
  }

  async syncOnce(limit = DEFAULT_BATCH_SIZE): Promise<OutboxSyncSummary> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError('Outbox sync batch size must be between 1 and 500.');
    }
    return this.#exclusive(() => this.#syncUnlocked(limit));
  }

  async #syncUnlocked(limit: number): Promise<OutboxSyncSummary> {
    const now = this.#runtime.now();
    const pending = await this.#database.transaction((transaction) =>
      transaction.outbox.listPending(now, limit),
    );
    let delivered = 0;
    let quarantined = 0;
    let dependencyBlocked = 0;
    let attempted = 0;
    let lastPermanentError: string | null = null;
    const blockedAggregateRevisions = new Map<string, number>();

    for (const event of pending) {
      const aggregateKey = `${event.shopId}:${event.aggregateType}:${event.aggregateId}`;
      const blockedAfterRevision = blockedAggregateRevisions.get(aggregateKey);
      if (
        blockedAfterRevision !== undefined &&
        event.aggregateRevision !== null &&
        event.aggregateRevision > blockedAfterRevision
      ) {
        continue;
      }
      attempted += 1;
      try {
        // Network I/O deliberately happens outside every local transaction and outside the
        // application business-command coordinator. Local POS commands remain independent.
        await this.#transport.deliver(event);
        const deliveredAt = this.#runtime.now();
        await this.#database.transaction((transaction) =>
          transaction.outbox.markDelivered(event.id, deliveredAt),
        );
        delivered += 1;
      } catch (error) {
        const lastError = normalizedError(error);
        const failedAt = this.#runtime.now();
        if (failureKind(error) === 'PERMANENT') {
          let permanentError = lastError;
          dependencyBlocked += await this.#database.transaction(async (transaction) => {
            if (isCanonicalReservationRejection(error)) {
              permanentError =
                (await reconcileRejectedOrderPlacement(transaction, event, failedAt)) ?? lastError;
            }
            await transaction.outbox.quarantine(event.id, failedAt, permanentError);
            return transaction.outbox.quarantineDependents(event, failedAt, permanentError);
          });
          if (event.aggregateRevision !== null) {
            blockedAggregateRevisions.set(aggregateKey, event.aggregateRevision);
          }
          quarantined += 1;
          lastPermanentError = permanentError;
          continue;
        }

        const attemptCount = event.attemptCount + 1;
        const nextAttemptAt = nextOutboxRetryAt(failedAt, attemptCount);
        await this.#database.transaction((transaction) =>
          transaction.outbox.recordFailure(event.id, attemptCount, nextAttemptAt, lastError),
        );
        return {
          attempted,
          delivered,
          failed: 1,
          quarantined,
          dependencyBlocked,
          blockedUntil: nextAttemptAt,
          lastError,
        };
      }
    }

    return {
      attempted,
      delivered,
      failed: 0,
      quarantined,
      dependencyBlocked,
      blockedUntil: null,
      lastError: lastPermanentError,
    };
  }

  async #exclusive<Result>(work: () => Promise<Result>): Promise<Result> {
    const previous = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
