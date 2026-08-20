import { assertOrderSnapshotIntegrity } from './order';
import type { BusinessDay } from './businessDay';
import type { CustomerContact } from './catalog';
import type { ManualExpenseRecord } from './expense';
import {
  parseEntityId,
  type BusinessDayId,
  type CustomerContactId,
  type DeliveryZoneId,
  type EntityId,
  type ExpenseId,
  type InventoryItemId,
  type InventoryMovementId,
  type ModifierId,
  type OrderId,
  type OrderItemId,
  type OrderTypeId,
  type OutboxEventId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ReconciliationId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from './ids';
import type { JsonValue } from './json';
import { moneyMinor, type MoneyMinor } from './money';
import { stockQuantityMicros, type StockQuantityMicros } from './quantity';
import { instant, type Instant } from './time';
import type {
  Expense,
  ExpensePaidFrom,
  InventoryMovement,
  InventoryMovementType,
  OrderFulfillmentSnapshot,
  OrderLifecycleSnapshot,
  OrderSnapshot,
  OrderSource,
  OrderStatus,
  OrderTypeBehavior,
  OutboxEvent,
  PaymentLogicType,
  PaymentPart,
  Reconciliation,
  WorkerSession,
} from './models';

export const OPERATIONS_SYNC_PAYLOAD_VERSION = 1 as const;

export type OrderTransitionSyncEventType =
  'ORDER_MARKED_DONE' | 'ORDER_DONE_UNDONE' | 'ORDER_CANCELLED' | 'DELIVERY_RETURNED';

export interface OrderTransitionSyncSnapshotV1 {
  readonly eventType: OrderTransitionSyncEventType;
  readonly revision: number;
  readonly fromStatus: OrderSnapshot['status'];
  readonly toStatus: OrderSnapshot['status'];
  readonly at: Instant;
  readonly workerId: WorkerId;
  readonly workerName: string;
  readonly reason: string | null;
  readonly foodPrepared: boolean | null;
  readonly stockRestored: boolean | null;
}

export type ExpenseSyncEventType = 'EXPENSE_CREATED' | 'EXPENSE_EDITED' | 'EXPENSE_DELETED';
export type WorkerSessionSyncEventType =
  'WORKER_SIGNED_IN' | 'WORKER_SWITCHED' | 'WORKER_SIGNED_OUT';

export type OperationsSyncPayloadV1 =
  | {
      readonly eventType: 'ORDER_PLACED';
      readonly version: 1;
      readonly order: OrderSnapshot;
      readonly customerContactUpsert: CustomerContact | null;
      readonly inventoryMovements: readonly InventoryMovement[];
      readonly configurationVersion: number;
    }
  | {
      readonly eventType: OrderTransitionSyncEventType;
      readonly version: 1;
      readonly order: OrderSnapshot;
      readonly transition: OrderTransitionSyncSnapshotV1;
      readonly inventoryMovements: readonly InventoryMovement[];
      readonly deliveryFailedExpense: Extract<Expense, { kind: 'DELIVERY_FAILED' }> | null;
    }
  | {
      readonly eventType: ExpenseSyncEventType;
      readonly version: 1;
      readonly expense: ManualExpenseRecord;
    }
  | {
      readonly eventType: 'INVENTORY_MOVEMENT_RECORDED';
      readonly version: 1;
      readonly movement: InventoryMovement;
    }
  | {
      readonly eventType: 'BUSINESS_DAY_STARTED';
      readonly version: 1;
      readonly businessDay: BusinessDay;
    }
  | {
      readonly eventType: WorkerSessionSyncEventType;
      readonly version: 1;
      readonly session: WorkerSession;
      readonly previousSession: WorkerSession | null;
    }
  | {
      readonly eventType: 'RECONCILIATION_RECORDED';
      readonly version: 1;
      readonly reconciliation: Reconciliation;
    }
  | {
      readonly eventType: 'BUSINESS_DAY_CLOSED';
      readonly version: 1;
      readonly businessDay: BusinessDay;
    };

export interface OperationsSyncEnvelopeV1 {
  readonly eventId: OutboxEvent['id'];
  readonly shopId: OutboxEvent['shopId'];
  readonly businessDayId: OutboxEvent['businessDayId'];
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateRevision: number | null;
  readonly eventType: OperationsSyncPayloadV1['eventType'];
  readonly idempotencyKey: string;
  readonly payloadVersion: 1;
  readonly payload: OperationsSyncPayloadV1;
  readonly createdAt: OutboxEvent['createdAt'];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Operations sync ${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(
      `Operations sync ${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`,
    );
  }
  return value;
}

function fieldString(source: UnknownRecord, key: string, allowEmpty = false): string {
  return stringValue(source[key], key, allowEmpty);
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label, true);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Operations sync ${label} must be boolean.`);
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  return booleanValue(value, label);
}

function safeInteger(value: unknown, label: string, minimum?: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Operations sync ${label} must be a safe integer.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new TypeError(`Operations sync ${label} must be at least ${minimum}.`);
  }
  return value;
}

function nullableSafeInteger(value: unknown, label: string, minimum = 0): number | null {
  if (value === null) return null;
  return safeInteger(value, label, minimum);
}

function entityId<Id extends EntityId>(value: unknown, label: string): Id {
  return parseEntityId<Id>(stringValue(value, label));
}

const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function timestamp(value: unknown, label: string): Instant {
  const text = stringValue(value, label);
  if (!UTC_ISO_PATTERN.test(text)) {
    throw new TypeError(`Operations sync ${label} must be an ISO-8601 UTC timestamp.`);
  }
  return instant(text);
}

function nullableTimestamp(value: unknown, label: string): Instant | null {
  return value === null ? null : timestamp(value, label);
}

function money(value: unknown, label: string, nonNegative = true): MoneyMinor {
  const parsed = moneyMinor(safeInteger(value, label));
  if (nonNegative && parsed < 0) {
    throw new TypeError(`Operations sync ${label} cannot be negative.`);
  }
  return parsed;
}

function stockQuantity(value: unknown, label: string): StockQuantityMicros {
  return stockQuantityMicros(safeInteger(value, label));
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Operations sync ${label} must be an array.`);
  return value;
}

function orderStatus(value: unknown, label = 'order status'): OrderStatus {
  if (value === 'ACTIVE' || value === 'DONE' || value === 'CANCELLED' || value === 'RETURNED') {
    return value;
  }
  throw new TypeError(`Operations sync ${label} is unsupported.`);
}

function orderSource(value: unknown): OrderSource {
  if (value === 'POS' || value === 'ONLINE') return value;
  throw new TypeError('Operations sync order source is unsupported.');
}

function orderBehavior(value: unknown): OrderTypeBehavior {
  if (value === 'TAKE_AWAY' || value === 'DINE_IN' || value === 'DELIVERY' || value === 'OTHER') {
    return value;
  }
  throw new TypeError('Operations sync order fulfillment behavior is unsupported.');
}

function paymentLogic(value: unknown): PaymentLogicType {
  if (value === 'CASH' || value === 'CARD' || value === 'DIGITAL' || value === 'OTHER')
    return value;
  throw new TypeError('Operations sync payment logic type is unsupported.');
}

function expensePaidFrom(value: unknown): ExpensePaidFrom {
  if (value === 'CASH' || value === 'OTHER') return value;
  throw new TypeError('Operations sync expense paidFrom is unsupported.');
}

function movementType(value: unknown): InventoryMovementType {
  if (
    value === 'ORDER_CONSUMPTION' ||
    value === 'CANCEL_RESTOCK' ||
    value === 'BULK_UNIT_FINISHED' ||
    value === 'BULK_STOCK_RECEIVED' ||
    value === 'UNDO_BULK_UNIT_FINISHED' ||
    value === 'UNDO_BULK_STOCK_RECEIVED' ||
    value === 'ADMIN_ADJUSTMENT'
  ) {
    return value;
  }
  throw new TypeError('Operations sync inventory movement type is unsupported.');
}

function parseLifecycle(value: unknown): OrderLifecycleSnapshot {
  const source = record(value, 'order lifecycle');
  const cancellationValue = source['cancellation'];
  const returnedValue = source['returned'];
  const cancellation =
    cancellationValue === null
      ? null
      : (() => {
          const cancellationSource = record(cancellationValue, 'order cancellation');
          return {
            at: timestamp(cancellationSource['at'], 'order cancellation at'),
            workerId: entityId<WorkerId>(
              cancellationSource['workerId'],
              'order cancellation workerId',
            ),
            workerName: fieldString(cancellationSource, 'workerName'),
            foodPrepared: booleanValue(
              cancellationSource['foodPrepared'],
              'order cancellation foodPrepared',
            ),
            stockRestored: booleanValue(
              cancellationSource['stockRestored'],
              'order cancellation stockRestored',
            ),
            reason: fieldString(cancellationSource, 'reason'),
          };
        })();
  const returned =
    returnedValue === null
      ? null
      : (() => {
          const returnedSource = record(returnedValue, 'order return');
          return {
            at: timestamp(returnedSource['at'], 'order return at'),
            workerId: entityId<WorkerId>(returnedSource['workerId'], 'order return workerId'),
            workerName: fieldString(returnedSource, 'workerName'),
            reason: fieldString(returnedSource, 'reason'),
          };
        })();
  return {
    revision: safeInteger(source['revision'], 'order lifecycle revision', 0),
    doneAt: nullableTimestamp(source['doneAt'], 'order lifecycle doneAt'),
    cancellation,
    returned,
  };
}

function parseFulfillment(value: unknown): OrderFulfillmentSnapshot {
  const source = record(value, 'order fulfillment');
  const behavior = orderBehavior(source['behavior']);
  const orderTypeId = entityId<OrderTypeId>(source['orderTypeId'], 'order fulfillment orderTypeId');
  const orderTypeLabel = fieldString(source, 'orderTypeLabel');
  if (behavior !== 'DELIVERY') {
    if (source['delivery'] !== null) {
      throw new TypeError('Operations sync non-Delivery fulfillment must have delivery=null.');
    }
    return { orderTypeId, orderTypeLabel, behavior, delivery: null };
  }
  const delivery = record(source['delivery'], 'Delivery customer snapshot');
  const customerContactId =
    delivery['customerContactId'] === null
      ? null
      : entityId<CustomerContactId>(delivery['customerContactId'], 'Delivery customerContactId');
  return {
    orderTypeId,
    orderTypeLabel,
    behavior: 'DELIVERY',
    delivery: {
      customerContactId,
      customerName: fieldString(delivery, 'customerName'),
      normalizedPhone: fieldString(delivery, 'normalizedPhone'),
      address: fieldString(delivery, 'address'),
      zoneId: entityId<DeliveryZoneId>(delivery['zoneId'], 'Delivery zoneId'),
      zoneLabel: fieldString(delivery, 'zoneLabel'),
      configuredFeeMinor: money(delivery['configuredFeeMinor'], 'configured delivery fee'),
      finalFeeMinor: money(delivery['finalFeeMinor'], 'final delivery fee'),
    },
  };
}

function parsePayment(value: unknown): PaymentPart {
  const source = record(value, 'order payment');
  const method = record(source['method'], 'order payment method');
  const logicType = paymentLogic(method['logicType']);
  const identity = {
    id: entityId<PaymentId>(source['id'], 'payment id'),
    method: {
      id: entityId<PaymentMethodId>(method['id'], 'payment method id'),
      label: fieldString(method, 'label'),
      logicType,
    },
    allocatedMinor: money(source['allocatedMinor'], 'payment allocatedMinor'),
  };
  if (logicType === 'CASH') {
    if (source['receivedMinor'] === null || source['changeMinor'] === null) {
      throw new TypeError('Operations sync Cash payment requires receivedMinor and changeMinor.');
    }
    return {
      ...identity,
      method: { ...identity.method, logicType: 'CASH' },
      receivedMinor: money(source['receivedMinor'], 'payment receivedMinor'),
      changeMinor: money(source['changeMinor'], 'payment changeMinor'),
    };
  }
  if (source['receivedMinor'] !== null || source['changeMinor'] !== null) {
    throw new TypeError(
      'Operations sync non-Cash payment must not include received/change amounts.',
    );
  }
  return {
    ...identity,
    method: { ...identity.method, logicType },
    receivedMinor: null,
    changeMinor: null,
  };
}

function parseOrder(value: unknown): OrderSnapshot {
  const source = record(value, 'order');
  const items = arrayValue(source['items'], 'order items').map((rawItem) => {
    const item = record(rawItem, 'order item');
    return {
      id: entityId<OrderItemId>(item['id'], 'order item id'),
      productId: entityId<ProductId>(item['productId'], 'order item productId'),
      productName: fieldString(item, 'productName'),
      unitPriceMinor: money(item['unitPriceMinor'], 'order item unitPriceMinor'),
      quantity: safeInteger(item['quantity'], 'order item quantity', 1),
      modifiers: arrayValue(item['modifiers'], 'order item modifiers').map((rawModifier) => {
        const modifier = record(rawModifier, 'order item modifier');
        return {
          modifierId: entityId<ModifierId>(modifier['modifierId'], 'order modifier id'),
          label: fieldString(modifier, 'label'),
          unitPriceMinor: money(modifier['unitPriceMinor'], 'order modifier unitPriceMinor', false),
          quantity: safeInteger(modifier['quantity'], 'order modifier quantity', 1),
        };
      }),
      comboBeverages: arrayValue(item['comboBeverages'], 'order combo beverages').map(
        (rawBeverage) => {
          const beverage = record(rawBeverage, 'order combo beverage');
          return {
            productId: entityId<ProductId>(beverage['productId'], 'combo beverage productId'),
            label: fieldString(beverage, 'label'),
          };
        },
      ),
      itemNote: nullableString(item['itemNote'], 'order item note'),
    };
  });
  const lifecycle = parseLifecycle(source['lifecycle']);
  const order: OrderSnapshot = {
    id: entityId<OrderId>(source['id'], 'order id'),
    shopId: entityId<ShopId>(source['shopId'], 'order shopId'),
    businessDayId: entityId<BusinessDayId>(source['businessDayId'], 'order businessDayId'),
    displayOrderNo: safeInteger(source['displayOrderNo'], 'order displayOrderNo', 1),
    idempotencyKey: fieldString(source, 'idempotencyKey'),
    status: orderStatus(source['status']),
    lifecycle,
    source: orderSource(source['source']),
    operatorWorkerId: entityId<WorkerId>(source['operatorWorkerId'], 'order operatorWorkerId'),
    operatorName: fieldString(source, 'operatorName'),
    createdAt: timestamp(source['createdAt'], 'order createdAt'),
    fulfillment: parseFulfillment(source['fulfillment']),
    items,
    orderNote: nullableString(source['orderNote'], 'order note'),
    itemsSubtotalMinor: money(source['itemsSubtotalMinor'], 'order itemsSubtotalMinor'),
    discountMinor: money(source['discountMinor'], 'order discountMinor'),
    deliveryFeeMinor: money(source['deliveryFeeMinor'], 'order deliveryFeeMinor'),
    totalMinor: money(source['totalMinor'], 'order totalMinor'),
    payments: arrayValue(source['payments'], 'order payments').map(parsePayment),
  };
  if (order.status === 'CANCELLED' && lifecycle.cancellation === null) {
    throw new TypeError('Operations sync CANCELLED order requires cancellation lifecycle data.');
  }
  if (order.status === 'RETURNED' && lifecycle.returned === null) {
    throw new TypeError('Operations sync RETURNED order requires return lifecycle data.');
  }
  if (order.status === 'DONE' && lifecycle.doneAt === null) {
    throw new TypeError('Operations sync DONE order requires doneAt lifecycle data.');
  }
  assertOrderSnapshotIntegrity(order);
  return order;
}

function parseCustomerContact(value: unknown): CustomerContact {
  const source = record(value, 'customer contact');
  return {
    id: entityId<CustomerContactId>(source['id'], 'customer contact id'),
    shopId: entityId<ShopId>(source['shopId'], 'customer contact shopId'),
    normalizedPhone: fieldString(source, 'normalizedPhone'),
    displayPhone: fieldString(source, 'displayPhone'),
    name: fieldString(source, 'name'),
    latestAddress: nullableString(source['latestAddress'], 'customer latestAddress'),
    latestZoneId:
      source['latestZoneId'] === null
        ? null
        : entityId<DeliveryZoneId>(source['latestZoneId'], 'customer latestZoneId'),
    lastOrderAt: nullableTimestamp(source['lastOrderAt'], 'customer lastOrderAt'),
  };
}

function parseMovement(value: unknown): InventoryMovement {
  const source = record(value, 'inventory movement');
  const movement: InventoryMovement = {
    id: entityId<InventoryMovementId>(source['id'], 'inventory movement id'),
    shopId: entityId<ShopId>(source['shopId'], 'inventory movement shopId'),
    businessDayId:
      source['businessDayId'] === null
        ? null
        : entityId<BusinessDayId>(source['businessDayId'], 'inventory movement businessDayId'),
    itemId: entityId<InventoryItemId>(source['itemId'], 'inventory movement itemId'),
    movementType: movementType(source['movementType']),
    quantityDeltaMicros: stockQuantity(
      source['quantityDeltaMicros'],
      'inventory movement quantityDeltaMicros',
    ),
    idempotencyKey: fieldString(source, 'idempotencyKey'),
    workerId: entityId<WorkerId>(source['workerId'], 'inventory movement workerId'),
    orderId:
      source['orderId'] === null
        ? null
        : entityId<OrderId>(source['orderId'], 'inventory movement orderId'),
    createdAt: timestamp(source['createdAt'], 'inventory movement createdAt'),
    compensatesMovementId:
      source['compensatesMovementId'] === null
        ? null
        : entityId<InventoryMovementId>(source['compensatesMovementId'], 'compensated movement id'),
  };
  if (movement.quantityDeltaMicros === 0) {
    throw new TypeError('Operations sync inventory movement quantity cannot be zero.');
  }
  return movement;
}

function parseManualExpense(value: unknown): ManualExpenseRecord {
  const source = record(value, 'manual expense');
  if (source['kind'] !== 'MANUAL') {
    throw new TypeError('Operations sync manual expense kind must be MANUAL.');
  }
  if (source['orderId'] !== null)
    throw new TypeError('Operations sync manual expense orderId must be null.');
  const lifecycle = record(source['lifecycle'], 'manual expense lifecycle');
  const amount = money(source['amountMinor'], 'expense amountMinor');
  if (amount <= 0) throw new TypeError('Operations sync manual expense amount must be positive.');
  const parsed: ManualExpenseRecord = {
    id: entityId<ExpenseId>(source['id'], 'expense id'),
    shopId: entityId<ShopId>(source['shopId'], 'expense shopId'),
    businessDayId: entityId<BusinessDayId>(source['businessDayId'], 'expense businessDayId'),
    kind: 'MANUAL',
    description: fieldString(source, 'description'),
    amountMinor: amount,
    paidFrom: expensePaidFrom(source['paidFrom']),
    note: nullableString(source['note'], 'expense note'),
    orderId: null,
    createdByWorkerId: entityId<WorkerId>(source['createdByWorkerId'], 'expense createdByWorkerId'),
    createdAt: timestamp(source['createdAt'], 'expense createdAt'),
    lifecycle: {
      revision: safeInteger(lifecycle['revision'], 'expense lifecycle revision', 0),
      updatedAt: nullableTimestamp(lifecycle['updatedAt'], 'expense updatedAt'),
      updatedByWorkerId:
        lifecycle['updatedByWorkerId'] === null
          ? null
          : entityId<WorkerId>(lifecycle['updatedByWorkerId'], 'expense updatedByWorkerId'),
      deletedAt: nullableTimestamp(lifecycle['deletedAt'], 'expense deletedAt'),
      deletedByWorkerId:
        lifecycle['deletedByWorkerId'] === null
          ? null
          : entityId<WorkerId>(lifecycle['deletedByWorkerId'], 'expense deletedByWorkerId'),
    },
  };
  if ((parsed.lifecycle.deletedAt === null) !== (parsed.lifecycle.deletedByWorkerId === null)) {
    throw new TypeError(
      'Operations sync deleted expense requires matching deletedAt/deletedByWorkerId.',
    );
  }
  return parsed;
}

function parseDeliveryFailedExpense(value: unknown): Extract<Expense, { kind: 'DELIVERY_FAILED' }> {
  const source = record(value, 'Delivery Failed expense');
  if (source['kind'] !== 'DELIVERY_FAILED') {
    throw new TypeError('Operations sync Delivery Failed expense kind is invalid.');
  }
  if (source['amountMinor'] !== null || source['paidFrom'] !== null) {
    throw new TypeError('Operations sync Delivery Failed expense must be non-financial.');
  }
  return {
    id: entityId<ExpenseId>(source['id'], 'Delivery Failed expense id'),
    shopId: entityId<ShopId>(source['shopId'], 'Delivery Failed expense shopId'),
    businessDayId: entityId<BusinessDayId>(
      source['businessDayId'],
      'Delivery Failed expense businessDayId',
    ),
    kind: 'DELIVERY_FAILED',
    description: fieldString(source, 'description'),
    amountMinor: null,
    paidFrom: null,
    note: nullableString(source['note'], 'Delivery Failed expense note'),
    orderId: entityId<OrderId>(source['orderId'], 'Delivery Failed expense orderId'),
    createdByWorkerId: entityId<WorkerId>(
      source['createdByWorkerId'],
      'Delivery Failed createdByWorkerId',
    ),
    createdAt: timestamp(source['createdAt'], 'Delivery Failed createdAt'),
  };
}

function parseBusinessDay(value: unknown): BusinessDay {
  const source = record(value, 'Business Day');
  const base = {
    id: entityId<BusinessDayId>(source['id'], 'Business Day id'),
    shopId: entityId<ShopId>(source['shopId'], 'Business Day shopId'),
    startedAt: timestamp(source['startedAt'], 'Business Day startedAt'),
    startedByWorkerId: entityId<WorkerId>(
      source['startedByWorkerId'],
      'Business Day startedByWorkerId',
    ),
    lastAllocatedDisplayOrderNo: safeInteger(
      source['lastAllocatedDisplayOrderNo'],
      'Business Day lastAllocatedDisplayOrderNo',
      0,
    ),
  };
  if (source['status'] === 'OPEN') {
    if (source['endedAt'] !== null || source['endedByWorkerId'] !== null) {
      throw new TypeError('Operations sync OPEN Business Day cannot have closure metadata.');
    }
    return { ...base, status: 'OPEN', endedAt: null, endedByWorkerId: null };
  }
  if (source['status'] === 'CLOSED') {
    const endedAt = timestamp(source['endedAt'], 'Business Day endedAt');
    if (endedAt < base.startedAt)
      throw new TypeError('Operations sync Business Day ends before it starts.');
    return {
      ...base,
      status: 'CLOSED',
      endedAt,
      endedByWorkerId: entityId<WorkerId>(
        source['endedByWorkerId'],
        'Business Day endedByWorkerId',
      ),
    };
  }
  throw new TypeError('Operations sync Business Day status is unsupported.');
}

function parseWorkerSession(value: unknown): WorkerSession {
  const source = record(value, 'worker session');
  const common = {
    id: entityId<WorkerSessionId>(source['id'], 'worker session id'),
    shopId: entityId<ShopId>(source['shopId'], 'worker session shopId'),
    businessDayId: entityId<BusinessDayId>(source['businessDayId'], 'worker session businessDayId'),
    workerId: entityId<WorkerId>(source['workerId'], 'worker session workerId'),
    startedAt: timestamp(source['startedAt'], 'worker session startedAt'),
  };
  const endedAt = nullableTimestamp(source['endedAt'], 'worker session endedAt');
  if (endedAt !== null && endedAt < common.startedAt) {
    throw new TypeError('Operations sync worker session ends before it starts.');
  }
  return endedAt === null ? { ...common, endedAt: null } : { ...common, endedAt };
}

function parseReconciliation(value: unknown): Reconciliation {
  const source = record(value, 'reconciliation');
  return {
    id: entityId<ReconciliationId>(source['id'], 'reconciliation id'),
    shopId: entityId<ShopId>(source['shopId'], 'reconciliation shopId'),
    businessDayId: entityId<BusinessDayId>(source['businessDayId'], 'reconciliation businessDayId'),
    createdByWorkerId: entityId<WorkerId>(
      source['createdByWorkerId'],
      'reconciliation createdByWorkerId',
    ),
    createdAt: timestamp(source['createdAt'], 'reconciliation createdAt'),
    lines: arrayValue(source['lines'], 'reconciliation lines').map((rawLine) => {
      const line = record(rawLine, 'reconciliation line');
      const paymentMethod = record(line['paymentMethod'], 'reconciliation payment method');
      const logicType = paymentLogic(paymentMethod['logicType']);
      const expectedMinor = money(line['expectedMinor'], 'reconciliation expectedMinor');
      const actualMinor = money(line['actualMinor'], 'reconciliation actualMinor');
      const differenceMinor = money(
        line['differenceMinor'],
        'reconciliation differenceMinor',
        false,
      );
      if (differenceMinor !== actualMinor - expectedMinor) {
        throw new TypeError(
          'Operations sync reconciliation difference does not match actual minus expected.',
        );
      }
      return {
        paymentMethod: {
          id: entityId<PaymentMethodId>(paymentMethod['id'], 'reconciliation payment method id'),
          label: fieldString(paymentMethod, 'label'),
          logicType,
        },
        expectedMinor,
        actualMinor,
        differenceMinor,
        varianceReason: nullableString(line['varianceReason'], 'reconciliation varianceReason'),
      };
    }),
  };
}

function parseTransition(
  value: unknown,
  eventType: OrderTransitionSyncEventType,
): OrderTransitionSyncSnapshotV1 {
  const source = record(value, 'order transition');
  if (source['eventType'] !== eventType) {
    throw new TypeError('Operations sync transition event type must match its payload.');
  }
  return {
    eventType,
    revision: safeInteger(source['revision'], 'order transition revision', 1),
    fromStatus: orderStatus(source['fromStatus'], 'transition fromStatus'),
    toStatus: orderStatus(source['toStatus'], 'transition toStatus'),
    at: timestamp(source['at'], 'order transition at'),
    workerId: entityId<WorkerId>(source['workerId'], 'order transition workerId'),
    workerName: fieldString(source, 'workerName'),
    reason: nullableString(source['reason'], 'order transition reason'),
    foodPrepared: nullableBoolean(source['foodPrepared'], 'order transition foodPrepared'),
    stockRestored: nullableBoolean(source['stockRestored'], 'order transition stockRestored'),
  };
}

const SUPPORTED_EVENT_TYPES = new Set<OperationsSyncPayloadV1['eventType']>([
  'ORDER_PLACED',
  'ORDER_MARKED_DONE',
  'ORDER_DONE_UNDONE',
  'ORDER_CANCELLED',
  'DELIVERY_RETURNED',
  'EXPENSE_CREATED',
  'EXPENSE_EDITED',
  'EXPENSE_DELETED',
  'INVENTORY_MOVEMENT_RECORDED',
  'BUSINESS_DAY_STARTED',
  'WORKER_SIGNED_IN',
  'WORKER_SWITCHED',
  'WORKER_SIGNED_OUT',
  'RECONCILIATION_RECORDED',
  'BUSINESS_DAY_CLOSED',
]);

function supportedEventType(value: unknown): OperationsSyncPayloadV1['eventType'] {
  const candidate = stringValue(value, 'eventType');
  if (!SUPPORTED_EVENT_TYPES.has(candidate as OperationsSyncPayloadV1['eventType'])) {
    throw new TypeError(`Unsupported Operations sync event type: ${candidate}.`);
  }
  return candidate as OperationsSyncPayloadV1['eventType'];
}

function assertSameIdentity(actual: string | null, expected: string | null, label: string): void {
  if (actual !== expected) throw new TypeError(`Operations sync ${label} identity mismatch.`);
}

function validateMovementContext(
  movement: InventoryMovement,
  shopId: ShopId,
  businessDayId: BusinessDayId,
  orderId?: OrderId,
): void {
  assertSameIdentity(movement.shopId, shopId, 'inventory movement shop');
  assertSameIdentity(movement.businessDayId, businessDayId, 'inventory movement Business Day');
  if (orderId !== undefined)
    assertSameIdentity(movement.orderId, orderId, 'inventory movement order');
}

export function parseOperationsSyncPayloadV1(value: unknown): OperationsSyncPayloadV1 {
  const source = record(value, 'payload');
  const eventType = supportedEventType(source['eventType']);
  if (source['version'] !== OPERATIONS_SYNC_PAYLOAD_VERSION) {
    throw new TypeError('Unsupported Operations sync payload version.');
  }

  if (eventType === 'ORDER_PLACED') {
    const order = parseOrder(source['order']);
    if (order.lifecycle?.revision !== 0 || order.status !== 'ACTIVE') {
      throw new TypeError('Operations sync ORDER_PLACED requires ACTIVE order revision 0.');
    }
    const customerContactUpsert =
      source['customerContactUpsert'] === null
        ? null
        : parseCustomerContact(source['customerContactUpsert']);
    if (customerContactUpsert !== null) {
      assertSameIdentity(customerContactUpsert.shopId, order.shopId, 'customer contact shop');
      const delivery = order.fulfillment.delivery;
      if (delivery === null || delivery.customerContactId !== customerContactUpsert.id) {
        throw new TypeError(
          'Operations sync customer contact must match the placed Delivery order.',
        );
      }
      if (customerContactUpsert.lastOrderAt !== order.createdAt) {
        throw new TypeError(
          'Operations sync customer learning timestamp must match order placement.',
        );
      }
    }
    const inventoryMovements = arrayValue(
      source['inventoryMovements'],
      'ORDER_PLACED inventory movements',
    ).map(parseMovement);
    inventoryMovements.forEach((movement) =>
      validateMovementContext(movement, order.shopId, order.businessDayId, order.id),
    );
    return {
      eventType,
      version: 1,
      order,
      customerContactUpsert,
      inventoryMovements,
      configurationVersion: safeInteger(source['configurationVersion'], 'configurationVersion', 1),
    };
  }

  if (
    eventType === 'ORDER_MARKED_DONE' ||
    eventType === 'ORDER_DONE_UNDONE' ||
    eventType === 'ORDER_CANCELLED' ||
    eventType === 'DELIVERY_RETURNED'
  ) {
    const order = parseOrder(source['order']);
    const transition = parseTransition(source['transition'], eventType);
    if (order.lifecycle?.revision !== transition.revision || order.status !== transition.toStatus) {
      throw new TypeError(
        'Operations sync order lifecycle must match its transition revision/status.',
      );
    }
    const inventoryMovements = arrayValue(
      source['inventoryMovements'],
      'order transition inventory movements',
    ).map(parseMovement);
    inventoryMovements.forEach((movement) =>
      validateMovementContext(movement, order.shopId, order.businessDayId, order.id),
    );
    const deliveryFailedExpense =
      source['deliveryFailedExpense'] === null
        ? null
        : parseDeliveryFailedExpense(source['deliveryFailedExpense']);
    if (deliveryFailedExpense !== null) {
      if (eventType !== 'DELIVERY_RETURNED') {
        throw new TypeError(
          'Operations sync Delivery Failed expense is only valid for DELIVERY_RETURNED.',
        );
      }
      assertSameIdentity(
        deliveryFailedExpense.shopId,
        order.shopId,
        'Delivery Failed expense shop',
      );
      assertSameIdentity(
        deliveryFailedExpense.businessDayId,
        order.businessDayId,
        'Delivery Failed expense Business Day',
      );
      assertSameIdentity(deliveryFailedExpense.orderId, order.id, 'Delivery Failed expense order');
    }
    return {
      eventType,
      version: 1,
      order,
      transition,
      inventoryMovements,
      deliveryFailedExpense,
    };
  }

  if (
    eventType === 'EXPENSE_CREATED' ||
    eventType === 'EXPENSE_EDITED' ||
    eventType === 'EXPENSE_DELETED'
  ) {
    const expense = parseManualExpense(source['expense']);
    if (eventType === 'EXPENSE_CREATED' && expense.lifecycle.revision !== 0) {
      throw new TypeError('Operations sync EXPENSE_CREATED requires lifecycle revision 0.');
    }
    if (eventType !== 'EXPENSE_CREATED' && expense.lifecycle.revision < 1) {
      throw new TypeError(
        'Operations sync expense mutation requires a positive lifecycle revision.',
      );
    }
    return { eventType, version: 1, expense };
  }

  if (eventType === 'INVENTORY_MOVEMENT_RECORDED') {
    return { eventType, version: 1, movement: parseMovement(source['movement']) };
  }

  if (eventType === 'BUSINESS_DAY_STARTED' || eventType === 'BUSINESS_DAY_CLOSED') {
    const businessDay = parseBusinessDay(source['businessDay']);
    if ((eventType === 'BUSINESS_DAY_STARTED') !== (businessDay.status === 'OPEN')) {
      throw new TypeError('Operations sync Business Day event does not match Business Day status.');
    }
    return { eventType, version: 1, businessDay };
  }

  if (
    eventType === 'WORKER_SIGNED_IN' ||
    eventType === 'WORKER_SWITCHED' ||
    eventType === 'WORKER_SIGNED_OUT'
  ) {
    const session = parseWorkerSession(source['session']);
    const previousSession =
      source['previousSession'] === null ? null : parseWorkerSession(source['previousSession']);
    if (eventType === 'WORKER_SIGNED_OUT' && session.endedAt === null) {
      throw new TypeError('Operations sync WORKER_SIGNED_OUT requires an ended session.');
    }
    if (eventType !== 'WORKER_SIGNED_OUT' && session.endedAt !== null) {
      throw new TypeError('Operations sync sign-in/switch requires an open new session.');
    }
    if (previousSession !== null) {
      assertSameIdentity(previousSession.shopId, session.shopId, 'previous worker session shop');
      assertSameIdentity(
        previousSession.businessDayId,
        session.businessDayId,
        'previous worker session Business Day',
      );
      if (previousSession.endedAt === null) {
        throw new TypeError('Operations sync previous worker session must already be ended.');
      }
    }
    if (eventType === 'WORKER_SWITCHED' && previousSession === null) {
      throw new TypeError('Operations sync WORKER_SWITCHED requires the previous ended session.');
    }
    return { eventType, version: 1, session, previousSession };
  }

  return {
    eventType: 'RECONCILIATION_RECORDED',
    version: 1,
    reconciliation: parseReconciliation(source['reconciliation']),
  };
}

function expectedEnvelopeIdentity(payload: OperationsSyncPayloadV1): {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateRevision: number | null;
} {
  switch (payload.eventType) {
    case 'ORDER_PLACED':
      return {
        shopId: payload.order.shopId,
        businessDayId: payload.order.businessDayId,
        aggregateType: 'ORDER',
        aggregateId: payload.order.id,
        aggregateRevision: 0,
      };
    case 'ORDER_MARKED_DONE':
    case 'ORDER_DONE_UNDONE':
    case 'ORDER_CANCELLED':
    case 'DELIVERY_RETURNED':
      return {
        shopId: payload.order.shopId,
        businessDayId: payload.order.businessDayId,
        aggregateType: 'ORDER',
        aggregateId: payload.order.id,
        aggregateRevision: payload.transition.revision,
      };
    case 'EXPENSE_CREATED':
    case 'EXPENSE_EDITED':
    case 'EXPENSE_DELETED':
      return {
        shopId: payload.expense.shopId,
        businessDayId: payload.expense.businessDayId,
        aggregateType: 'EXPENSE',
        aggregateId: payload.expense.id,
        aggregateRevision: payload.expense.lifecycle.revision,
      };
    case 'INVENTORY_MOVEMENT_RECORDED':
      return {
        shopId: payload.movement.shopId,
        businessDayId: payload.movement.businessDayId,
        aggregateType: 'INVENTORY_ITEM',
        aggregateId: payload.movement.itemId,
        aggregateRevision: null,
      };
    case 'BUSINESS_DAY_STARTED':
      return {
        shopId: payload.businessDay.shopId,
        businessDayId: payload.businessDay.id,
        aggregateType: 'BUSINESS_DAY',
        aggregateId: payload.businessDay.id,
        aggregateRevision: 0,
      };
    case 'BUSINESS_DAY_CLOSED':
      return {
        shopId: payload.businessDay.shopId,
        businessDayId: payload.businessDay.id,
        aggregateType: 'BUSINESS_DAY',
        aggregateId: payload.businessDay.id,
        aggregateRevision: 1,
      };
    case 'WORKER_SIGNED_IN':
    case 'WORKER_SWITCHED':
      return {
        shopId: payload.session.shopId,
        businessDayId: payload.session.businessDayId,
        aggregateType: 'WORKER_SESSION',
        aggregateId: payload.session.id,
        aggregateRevision: 0,
      };
    case 'WORKER_SIGNED_OUT':
      return {
        shopId: payload.session.shopId,
        businessDayId: payload.session.businessDayId,
        aggregateType: 'WORKER_SESSION',
        aggregateId: payload.session.id,
        aggregateRevision: 1,
      };
    case 'RECONCILIATION_RECORDED':
      return {
        shopId: payload.reconciliation.shopId,
        businessDayId: payload.reconciliation.businessDayId,
        aggregateType: 'RECONCILIATION',
        aggregateId: payload.reconciliation.id,
        aggregateRevision: null,
      };
  }
}

export function parseOperationsSyncEnvelopeV1(value: unknown): OperationsSyncEnvelopeV1 {
  const source = record(value, 'envelope');
  const eventId = entityId<OutboxEventId>(source['eventId'], 'eventId');
  const shopId = entityId<ShopId>(source['shopId'], 'envelope shopId');
  const businessDayId =
    source['businessDayId'] === null
      ? null
      : entityId<BusinessDayId>(source['businessDayId'], 'envelope businessDayId');
  const aggregateType = fieldString(source, 'aggregateType');
  const aggregateId = fieldString(source, 'aggregateId');
  parseEntityId(aggregateId);
  const aggregateRevision = nullableSafeInteger(source['aggregateRevision'], 'aggregateRevision');
  const eventType = supportedEventType(source['eventType']);
  if (source['payloadVersion'] !== OPERATIONS_SYNC_PAYLOAD_VERSION) {
    throw new TypeError('Unsupported Operations sync envelope payload version.');
  }
  const payload = parseOperationsSyncPayloadV1(source['payload']);
  if (payload.eventType !== eventType) {
    throw new TypeError('Operations sync envelope event type does not match payload.');
  }
  const expected = expectedEnvelopeIdentity(payload);
  assertSameIdentity(shopId, expected.shopId, 'envelope shop');
  assertSameIdentity(businessDayId, expected.businessDayId, 'envelope Business Day');
  assertSameIdentity(aggregateType, expected.aggregateType, 'envelope aggregate type');
  assertSameIdentity(aggregateId, expected.aggregateId, 'envelope aggregate');
  if (aggregateRevision !== expected.aggregateRevision) {
    throw new TypeError('Operations sync envelope aggregate revision mismatch.');
  }
  return {
    eventId,
    shopId,
    businessDayId,
    aggregateType,
    aggregateId,
    aggregateRevision,
    eventType,
    idempotencyKey: fieldString(source, 'idempotencyKey'),
    payloadVersion: 1,
    payload,
    createdAt: timestamp(source['createdAt'], 'envelope createdAt'),
  };
}

export function operationsSyncPayloadJson(payload: OperationsSyncPayloadV1): JsonValue {
  parseOperationsSyncPayloadV1(payload);
  return payload as unknown as JsonValue;
}

export function toOperationsSyncEnvelopeV1(event: OutboxEvent): OperationsSyncEnvelopeV1 {
  return parseOperationsSyncEnvelopeV1({
    eventId: event.id,
    shopId: event.shopId,
    businessDayId: event.businessDayId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateRevision: event.aggregateRevision,
    eventType: event.eventType,
    idempotencyKey: event.idempotencyKey,
    payloadVersion: event.payloadVersion,
    payload: event.payload,
    createdAt: event.createdAt,
  });
}
