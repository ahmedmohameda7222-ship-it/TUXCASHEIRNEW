import {
  BULK_STOCK_UNDO_WINDOW_MS,
  DomainInvariantError,
  bulkStockBalance,
  bulkStockWholeUnitCount,
  canUndoBulkMovement,
  finishedBulkUnitDelta,
  parseEntityId,
  receivedBulkStockDelta,
  undoBulkMovementDelta,
  undoBulkMovementType,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type EntityId,
  type Instant,
  type InventoryItem,
  type InventoryItemId,
  type InventoryMovement,
  type InventoryMovementId,
  type JsonValue,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type StockQuantityMicros,
  type Worker,
} from '@tux/domain';
import type {
  BulkStockStore,
  OperationsDatabase,
  OperatorSessionReadModel,
} from '@tux/persistence';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';

export interface BulkStockRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface BulkStockBoardItem {
  readonly id: InventoryItemId;
  readonly name: string;
  readonly unitLabel: string;
  readonly balanceMicros: StockQuantityMicros;
  readonly currentWholeUnits: number;
}

export interface BulkStockBoard {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly loadedAt: Instant;
  readonly items: readonly BulkStockBoardItem[];
}

export interface BulkStockMovementInput {
  readonly itemId: InventoryItemId;
  readonly commandId: string;
}

export interface AddBulkStockInput extends BulkStockMovementInput {
  readonly units: number;
}

export interface UndoBulkStockInput {
  readonly movementId: InventoryMovementId;
  readonly commandId: string;
}

export interface BulkStockMutation {
  readonly movement: InventoryMovement;
  readonly undoUntil: Instant | null;
}

export type BulkStockBoardResult = Result<BulkStockBoard, ApplicationError>;
export type BulkStockMutationResult = Result<BulkStockMutation, ApplicationError>;

interface MutationContext {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly operator: Worker;
}

function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function commandMovementId(commandId: string): InventoryMovementId {
  try {
    return parseEntityId<InventoryMovementId>(commandId.trim());
  } catch (cause) {
    throw new DomainInvariantError('Bulk Stock command ID must be a UUID.', { cause });
  }
}

function addMilliseconds(value: Instant, milliseconds: number): Instant {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new DomainInvariantError('Invalid Bulk Stock movement time.');
  return new Date(timestamp + milliseconds).toISOString() as Instant;
}

export class OperationsBulkStockService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #store: BulkStockStore;
  readonly #runtime: BulkStockRuntime;
  readonly #coordinator: ApplicationCommandCoordinator;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    store: BulkStockStore,
    runtime: BulkStockRuntime,
    coordinator = new ApplicationCommandCoordinator(),
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#store = store;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
  }

  async loadBoard(): Promise<BulkStockBoardResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const items = await this.#store.listActiveItems(context.shopId);
        const boardItems = await Promise.all(items.map((item) => this.#boardItem(item)));
        return ok({
          shopId: context.shopId,
          businessDayId: context.businessDayId,
          loadedAt: this.#runtime.now(),
          items: boardItems,
        });
      } catch (cause) {
        return err(persistenceError('Could not load the local Bulk Stock ledger.', cause));
      }
    });
  }

  async finishOne(input: BulkStockMovementInput): Promise<BulkStockMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const movementId = commandMovementId(input.commandId);
        const existing = await this.#store.getMovementById(movementId);
        if (existing !== null) {
          return this.#idempotentExisting(existing, context, input.itemId, 'BULK_UNIT_FINISHED');
        }
        await this.#requireCurrentItem(context.shopId, input.itemId);
        const now = this.#runtime.now();
        const movement: InventoryMovement = {
          id: movementId,
          shopId: context.shopId,
          businessDayId: context.businessDayId,
          itemId: input.itemId,
          movementType: 'BULK_UNIT_FINISHED',
          quantityDeltaMicros: finishedBulkUnitDelta(),
          idempotencyKey: `bulk-stock:${movementId}`,
          workerId: context.operator.id,
          orderId: null,
          createdAt: now,
          compensatesMovementId: null,
        };
        await this.#commit(context, movement, null);
        return ok({
          movement,
          undoUntil: addMilliseconds(now, BULK_STOCK_UNDO_WINDOW_MS),
        });
      } catch (cause) {
        return this.#mutationError(cause, 'The Finished 1 movement could not be committed locally.');
      }
    });
  }

  async addStock(input: AddBulkStockInput): Promise<BulkStockMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const movementId = commandMovementId(input.commandId);
        const existing = await this.#store.getMovementById(movementId);
        if (existing !== null) {
          return this.#idempotentExisting(existing, context, input.itemId, 'BULK_STOCK_RECEIVED');
        }
        await this.#requireCurrentItem(context.shopId, input.itemId);
        const now = this.#runtime.now();
        const movement: InventoryMovement = {
          id: movementId,
          shopId: context.shopId,
          businessDayId: context.businessDayId,
          itemId: input.itemId,
          movementType: 'BULK_STOCK_RECEIVED',
          quantityDeltaMicros: receivedBulkStockDelta(input.units),
          idempotencyKey: `bulk-stock:${movementId}`,
          workerId: context.operator.id,
          orderId: null,
          createdAt: now,
          compensatesMovementId: null,
        };
        await this.#commit(context, movement, null);
        return ok({
          movement,
          undoUntil: addMilliseconds(now, BULK_STOCK_UNDO_WINDOW_MS),
        });
      } catch (cause) {
        return this.#mutationError(cause, 'The stock receipt could not be committed locally.');
      }
    });
  }

  async undoMovement(input: UndoBulkStockInput): Promise<BulkStockMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const movementId = commandMovementId(input.commandId);
        const existingUndo = await this.#store.getMovementById(movementId);
        if (existingUndo !== null) {
          if (
            existingUndo.shopId === context.shopId &&
            existingUndo.businessDayId === context.businessDayId &&
            existingUndo.compensatesMovementId === input.movementId &&
            (existingUndo.movementType === 'UNDO_BULK_UNIT_FINISHED' ||
              existingUndo.movementType === 'UNDO_BULK_STOCK_RECEIVED')
          ) {
            return ok({ movement: existingUndo, undoUntil: null });
          }
          return err({ code: 'CONFLICT_ERROR', message: 'Bulk Stock command identity conflict.' });
        }

        const original = await this.#store.getMovementById(input.movementId);
        if (
          original === null ||
          original.shopId !== context.shopId ||
          original.businessDayId !== context.businessDayId
        ) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'The Bulk Stock movement is not part of the current Business Day.',
          });
        }
        const compensated = await this.#store.hasCompensationFor(original.id);
        const now = this.#runtime.now();
        if (!canUndoBulkMovement(original, now, compensated)) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'The short Bulk Stock Undo window has expired or was already used.',
          });
        }
        await this.#requireCurrentItem(context.shopId, original.itemId);
        const movement: InventoryMovement = {
          id: movementId,
          shopId: context.shopId,
          businessDayId: context.businessDayId,
          itemId: original.itemId,
          movementType: undoBulkMovementType(original),
          quantityDeltaMicros: undoBulkMovementDelta(original),
          idempotencyKey: `bulk-stock:${movementId}`,
          workerId: context.operator.id,
          orderId: null,
          createdAt: now,
          compensatesMovementId: original.id,
        };
        await this.#commit(context, movement, original.id);
        return ok({ movement, undoUntil: null });
      } catch (cause) {
        return this.#mutationError(cause, 'The Bulk Stock Undo could not be committed locally.');
      }
    });
  }

  async #boardItem(item: InventoryItem): Promise<BulkStockBoardItem> {
    const movements = await this.#store.listMovements(item.id);
    const balanceMicros = bulkStockBalance(movements);
    return {
      id: item.id,
      name: item.name,
      unitLabel: item.unitLabel,
      balanceMicros,
      currentWholeUnits: bulkStockWholeUnitCount(balanceMicros),
    };
  }

  async #requireCurrentItem(shopId: ShopId, itemId: InventoryItemId): Promise<void> {
    const items = await this.#store.listActiveItems(shopId);
    if (!items.some((item) => item.id === itemId)) {
      throw new DomainInvariantError('The Bulk Stock item is unavailable or no longer active.');
    }
  }

  #idempotentExisting(
    existing: InventoryMovement,
    context: MutationContext,
    itemId: InventoryItemId,
    expectedType: 'BULK_UNIT_FINISHED' | 'BULK_STOCK_RECEIVED',
  ): BulkStockMutationResult {
    if (
      existing.shopId !== context.shopId ||
      existing.businessDayId !== context.businessDayId ||
      existing.itemId !== itemId ||
      existing.movementType !== expectedType
    ) {
      return err({ code: 'CONFLICT_ERROR', message: 'Bulk Stock command identity conflict.' });
    }
    return ok({
      movement: existing,
      undoUntil: addMilliseconds(existing.createdAt, BULK_STOCK_UNDO_WINDOW_MS),
    });
  }

  async #commit(
    context: MutationContext,
    movement: InventoryMovement,
    expectedCompensatedMovementId: InventoryMovementId | null,
  ): Promise<void> {
    await this.#store.commitMovement({
      expectedBusinessDayId: context.businessDayId,
      expectedWorkerId: context.operator.id,
      expectedShopId: context.shopId,
      movement,
      expectedCompensatedMovementId,
      audit: this.#audit(movement),
      outbox: this.#outbox(movement),
    });
  }

  #audit(movement: InventoryMovement): AuditEvent {
    return {
      id: this.#id<AuditEventId>(),
      shopId: movement.shopId,
      businessDayId: movement.businessDayId,
      aggregateType: 'INVENTORY_ITEM',
      aggregateId: movement.itemId,
      eventType: 'INVENTORY_MOVEMENT_RECORDED',
      workerId: movement.workerId,
      createdAt: movement.createdAt,
      details: this.#movementPayload(movement),
    };
  }

  #outbox(movement: InventoryMovement): OutboxEvent {
    return {
      id: this.#id<OutboxEventId>(),
      shopId: movement.shopId,
      businessDayId: movement.businessDayId,
      aggregateType: 'INVENTORY_ITEM',
      aggregateId: movement.itemId,
      eventType: 'INVENTORY_MOVEMENT_RECORDED',
      idempotencyKey: `inventory-movement:${movement.id}`,
      payloadVersion: 1,
      payload: this.#movementPayload(movement),
      createdAt: movement.createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  #movementPayload(movement: InventoryMovement): Record<string, JsonValue> {
    return {
      movementId: movement.id,
      businessDayId: movement.businessDayId,
      itemId: movement.itemId,
      movementType: movement.movementType,
      quantityDeltaMicros: movement.quantityDeltaMicros,
      workerId: movement.workerId,
      compensatesMovementId: movement.compensatesMovementId,
    };
  }

  async #resolveContext(): Promise<Result<MutationContext, ApplicationError>> {
    try {
      const shops = await this.#readModel.listActiveShops();
      const shop = shops.length === 1 ? shops[0] : undefined;
      if (shop === undefined) {
        return err({
          code: 'CONFLICT_ERROR',
          message: 'This device is not assigned to exactly one active shop.',
        });
      }
      const day = await this.#database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(shop.id),
      );
      if (day === null || day.status !== 'OPEN') {
        return err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' });
      }
      const session = await this.#readModel.getOpenWorkerSession(day.id);
      if (session === null || session.endedAt !== null) {
        return err({ code: 'CONFLICT_ERROR', message: 'A Current Operator is required.' });
      }
      const worker = await this.#database.transaction((transaction) =>
        transaction.workers.getById(session.workerId),
      );
      if (worker === null || !worker.active || worker.shopId !== shop.id) {
        return err({ code: 'CONFLICT_ERROR', message: 'The Current Operator is unavailable.' });
      }
      return ok({ shopId: shop.id, businessDayId: day.id, operator: worker });
    } catch (cause) {
      return err(persistenceError('Could not resolve the current Bulk Stock session.', cause));
    }
  }

  #mutationError(cause: unknown, fallback: string): BulkStockMutationResult {
    if (cause instanceof DomainInvariantError) {
      return err({ code: 'VALIDATION_ERROR', message: cause.message, cause });
    }
    return err(persistenceError(fallback, cause));
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }
}
