import {
  DomainInvariantError,
  ZERO_MONEY,
  canUndoOrderDone,
  cancelActiveOrder,
  markOrderDone,
  operationsSyncPayloadJson,
  orderLifecycle,
  parseEntityId,
  returnFailedDelivery,
  stockQuantityMicros,
  undoOrderDone,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type EntityId,
  type Expense,
  type ExpenseId,
  type Instant,
  type InventoryMovement,
  type InventoryMovementId,
  type JsonValue,
  type OperationsSyncPayloadV1,
  type OrderId,
  type OrderSnapshot,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type Worker,
} from '@tux/domain';
import type {
  OperationsDatabase,
  OperationsTransaction,
  OperatorSessionReadModel,
} from '@tux/persistence';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';

export interface OrdersBoardRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface OrdersBoardSnapshot {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly loadedAt: Instant;
  readonly orders: readonly OrderSnapshot[];
}

export interface CancelOrderInput {
  readonly orderId: OrderId;
  readonly foodPrepared: boolean;
  readonly reason: string;
}

export interface ReturnDeliveryInput {
  readonly orderId: OrderId;
  readonly reason: string;
}

export type OrdersBoardResult = Result<OrdersBoardSnapshot, ApplicationError>;
export type OrderTransitionResult = Result<OrderSnapshot, ApplicationError>;

interface MutationContext {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly operator: Worker;
}

function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function transitionError(cause: unknown): ApplicationError {
  if (cause instanceof DomainInvariantError) {
    return { code: 'CONFLICT_ERROR', message: cause.message, cause };
  }
  return persistenceError('The order state change could not be committed locally.', cause);
}

function itemSummary(order: OrderSnapshot): string {
  return order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ');
}

export class OperationsOrdersBoardService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #runtime: OrdersBoardRuntime;
  readonly #coordinator: ApplicationCommandCoordinator;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    runtime: OrdersBoardRuntime,
    coordinator = new ApplicationCommandCoordinator(),
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
  }

  async loadBoard(): Promise<OrdersBoardResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const shops = await this.#readModel.listActiveShops();
        const shop = shops.length === 1 ? shops[0] : undefined;
        if (shop === undefined) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'This device is not assigned to exactly one active shop.',
          });
        }
        const snapshot = await this.#database.transaction(async (transaction) => {
          const day = await transaction.businessDays.getOpenForShop(shop.id);
          if (day === null || day.status !== 'OPEN') return null;
          const orders = await transaction.orders.listByBusinessDay(day.id);
          return {
            shopId: shop.id,
            businessDayId: day.id,
            loadedAt: this.#runtime.now(),
            orders,
          } satisfies OrdersBoardSnapshot;
        });
        return snapshot === null
          ? err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' })
          : ok(snapshot);
      } catch (cause) {
        return err(persistenceError('Could not load the local Orders Board.', cause));
      }
    });
  }

  async markDone(orderId: OrderId): Promise<OrderTransitionResult> {
    return this.#mutate(async (transaction, context, now) => {
      const order = await this.#currentOrder(transaction, context, orderId);
      const updated = markOrderDone(order, now);
      await transaction.orders.updateOperationalState(updated);
      await transaction.audit.append(
        this.#audit(updated, context.operator, now, 'ORDER_MARKED_DONE', {
          fromStatus: 'ACTIVE',
          toStatus: 'DONE',
          operationalRevision: orderLifecycle(updated).revision,
        }),
      );
      await transaction.outbox.append(this.#outbox(updated, now, 'ORDER_MARKED_DONE', [], null));
      return updated;
    });
  }

  async undoDone(orderId: OrderId): Promise<OrderTransitionResult> {
    return this.#mutate(async (transaction, context, now) => {
      const order = await this.#currentOrder(transaction, context, orderId);
      if (!canUndoOrderDone(order, now)) {
        throw new DomainInvariantError('The Done undo window has expired.');
      }
      const updated = undoOrderDone(order);
      await transaction.orders.updateOperationalState(updated);
      await transaction.audit.append(
        this.#audit(updated, context.operator, now, 'ORDER_DONE_UNDONE', {
          fromStatus: 'DONE',
          toStatus: 'ACTIVE',
          operationalRevision: orderLifecycle(updated).revision,
        }),
      );
      await transaction.outbox.append(this.#outbox(updated, now, 'ORDER_DONE_UNDONE', [], null));
      return updated;
    });
  }

  async cancelOrder(input: CancelOrderInput): Promise<OrderTransitionResult> {
    return this.#mutate(async (transaction, context, now) => {
      const order = await this.#currentOrder(transaction, context, input.orderId);
      const updated = cancelActiveOrder(order, {
        at: now,
        workerId: context.operator.id,
        workerName: context.operator.displayName,
        foodPrepared: input.foodPrepared,
        reason: input.reason,
      });
      const restockMovements: InventoryMovement[] = [];
      if (!input.foodPrepared) {
        const movements = await transaction.inventory.listMovementsForOrder(order.id);
        for (const movement of movements) {
          if (movement.movementType !== 'ORDER_CONSUMPTION') continue;
          if (movement.quantityDeltaMicros >= 0) {
            throw new DomainInvariantError('Order consumption movement must be negative.');
          }
          const restock: InventoryMovement = {
            id: this.#id<InventoryMovementId>(),
            shopId: order.shopId,
            businessDayId: order.businessDayId,
            itemId: movement.itemId,
            movementType: 'CANCEL_RESTOCK',
            quantityDeltaMicros: stockQuantityMicros(-movement.quantityDeltaMicros),
            idempotencyKey: `cancel-restock:${order.id}:${movement.id}`,
            workerId: context.operator.id,
            orderId: order.id,
            createdAt: now,
            compensatesMovementId: movement.id,
          };
          restockMovements.push(restock);
          await transaction.inventory.appendMovement(restock);
        }
      }

      await transaction.orders.updateOperationalState(updated);
      const cancellation = orderLifecycle(updated).cancellation;
      if (cancellation === null) throw new Error('Cancelled order is missing cancellation metadata.');
      await transaction.audit.append(
        this.#audit(updated, context.operator, now, 'ORDER_CANCELLED', {
          reason: cancellation.reason,
          foodPrepared: cancellation.foodPrepared,
          stockRestored: cancellation.stockRestored,
          operationalRevision: orderLifecycle(updated).revision,
        }),
      );
      await transaction.outbox.append(
        this.#outbox(updated, now, 'ORDER_CANCELLED', restockMovements, null),
      );
      return updated;
    });
  }

  async returnDelivery(input: ReturnDeliveryInput): Promise<OrderTransitionResult> {
    return this.#mutate(async (transaction, context, now) => {
      const order = await this.#currentOrder(transaction, context, input.orderId);
      const updated = returnFailedDelivery(order, {
        at: now,
        workerId: context.operator.id,
        workerName: context.operator.displayName,
        reason: input.reason,
      });
      const returned = orderLifecycle(updated).returned;
      if (returned === null) throw new Error('Returned Delivery is missing return metadata.');

      const expense: Extract<Expense, { kind: 'DELIVERY_FAILED' }> = {
        id: this.#id<ExpenseId>(),
        shopId: order.shopId,
        businessDayId: order.businessDayId,
        kind: 'DELIVERY_FAILED',
        description: `Delivery Failed — Order #${order.displayOrderNo}: ${itemSummary(order)}`,
        amountMinor: null,
        paidFrom: null,
        note: returned.reason,
        orderId: order.id,
        createdByWorkerId: context.operator.id,
        createdAt: now,
      };

      await transaction.orders.updateOperationalState(updated);
      await transaction.expenses.put(expense);
      await transaction.audit.append(
        this.#audit(updated, context.operator, now, 'DELIVERY_RETURNED', {
          reason: returned.reason,
          historicalOrderTotalMinor: order.totalMinor,
          recognizedRevenueMinor: ZERO_MONEY,
          collectedPaymentMinor: ZERO_MONEY,
          excludedFromExpectedReconciliation: true,
          inventoryRestored: false,
          expenseId: expense.id,
          operationalRevision: orderLifecycle(updated).revision,
        }),
      );
      await transaction.outbox.append(this.#outbox(updated, now, 'DELIVERY_RETURNED', [], expense));
      return updated;
    });
  }

  async #mutate(
    work: (
      transaction: OperationsTransaction,
      context: MutationContext,
      now: Instant,
    ) => Promise<OrderSnapshot>,
  ): Promise<OrderTransitionResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const contextResult = await this.#resolveMutationContext();
        if (!contextResult.ok) return contextResult;
        const context = contextResult.value;
        const now = this.#runtime.now();
        const updated = await this.#database.transaction((transaction) =>
          work(transaction, context, now),
        );
        return ok(updated);
      } catch (cause) {
        return err(transitionError(cause));
      }
    });
  }

  async #resolveMutationContext(): Promise<Result<MutationContext, ApplicationError>> {
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
  }

  async #currentOrder(
    transaction: OperationsTransaction,
    context: MutationContext,
    orderId: OrderId,
  ): Promise<OrderSnapshot> {
    const day = await transaction.businessDays.getOpenForShop(context.shopId);
    if (day === null || day.status !== 'OPEN' || day.id !== context.businessDayId) {
      throw new DomainInvariantError('The Business Day changed before the order action committed.');
    }
    const order = await transaction.orders.getById(orderId);
    if (order === null || order.shopId !== context.shopId || order.businessDayId !== day.id) {
      throw new DomainInvariantError('The order is not part of the current Business Day.');
    }
    return order;
  }

  #audit(
    order: OrderSnapshot,
    worker: Worker,
    createdAt: Instant,
    eventType: Extract<
      AuditEvent['eventType'],
      'ORDER_MARKED_DONE' | 'ORDER_DONE_UNDONE' | 'ORDER_CANCELLED' | 'DELIVERY_RETURNED'
    >,
    details: Readonly<Record<string, JsonValue>>,
  ): AuditEvent {
    return {
      id: this.#id<AuditEventId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType,
      workerId: worker.id,
      createdAt,
      details,
    };
  }

  #outbox(
    order: OrderSnapshot,
    createdAt: Instant,
    eventType: 'ORDER_MARKED_DONE' | 'ORDER_DONE_UNDONE' | 'ORDER_CANCELLED' | 'DELIVERY_RETURNED',
    inventoryMovements: readonly InventoryMovement[],
    deliveryFailedExpense: Extract<Expense, { kind: 'DELIVERY_FAILED' }> | null,
  ): OutboxEvent {
    const payload = {
      eventType,
      version: 1,
      order,
      inventoryMovements,
      deliveryFailedExpense,
    } satisfies OperationsSyncPayloadV1;
    const revision = orderLifecycle(order).revision;
    return {
      id: this.#id<OutboxEventId>(),
      shopId: order.shopId,
      businessDayId: order.businessDayId,
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType,
      idempotencyKey: `order-operational:${order.id}:${revision}:${eventType}`,
      payloadVersion: 1,
      payload: operationsSyncPayloadJson(payload),
      createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }
}
