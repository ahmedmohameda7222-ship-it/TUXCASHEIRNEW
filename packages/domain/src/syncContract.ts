import { assertOrderSnapshotIntegrity } from './order';
import type { BusinessDay } from './businessDay';
import type { ExpenseLedgerRecord, ManualExpenseRecord } from './expense';
import type { Instant } from './time';
import type { WorkerId } from './ids';
import type {
  CustomerContact,
  Expense,
  InventoryMovement,
  OrderSnapshot,
  OutboxEvent,
  Reconciliation,
  WorkerSession,
} from './models';
import type { JsonValue } from './json';

export const OPERATIONS_SYNC_PAYLOAD_VERSION = 1 as const;

export type OrderTransitionSyncEventType =
  | 'ORDER_MARKED_DONE'
  | 'ORDER_DONE_UNDONE'
  | 'ORDER_CANCELLED'
  | 'DELIVERY_RETURNED';

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
export type WorkerSessionSyncEventType = 'WORKER_SIGNED_IN' | 'WORKER_SWITCHED' | 'WORKER_SIGNED_OUT';

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
  readonly eventType: OperationsSyncPayloadV1['eventType'];
  readonly idempotencyKey: string;
  readonly payloadVersion: 1;
  readonly payload: OperationsSyncPayloadV1;
  readonly createdAt: OutboxEvent['createdAt'];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Operations sync ${key} must be a non-empty string.`);
  }
  return value;
}

function requiredSafeInteger(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`Operations sync ${key} must be a safe integer.`);
  }
  return value;
}

function assertOrder(value: unknown): asserts value is OrderSnapshot {
  if (!isRecord(value)) throw new TypeError('Operations sync order must be an object.');
  requiredString(value, 'id');
  requiredString(value, 'shopId');
  requiredString(value, 'businessDayId');
  requiredString(value, 'idempotencyKey');
  requiredString(value, 'operatorWorkerId');
  requiredString(value, 'operatorName');
  requiredString(value, 'createdAt');
  requiredSafeInteger(value, 'displayOrderNo');
  requiredSafeInteger(value, 'itemsSubtotalMinor');
  requiredSafeInteger(value, 'discountMinor');
  requiredSafeInteger(value, 'deliveryFeeMinor');
  requiredSafeInteger(value, 'totalMinor');
  if (!Array.isArray(value['items']) || !Array.isArray(value['payments'])) {
    throw new TypeError('Operations sync order must include item and payment snapshots.');
  }
  if (!isRecord(value['fulfillment'])) {
    throw new TypeError('Operations sync order must include fulfillment snapshot.');
  }
  if (!isRecord(value['lifecycle'])) {
    throw new TypeError('Operations sync order must include lifecycle snapshot.');
  }
  assertOrderSnapshotIntegrity(value as unknown as OrderSnapshot);
}

function assertCustomerContact(value: unknown): asserts value is CustomerContact {
  if (!isRecord(value)) throw new TypeError('Operations sync customer contact must be an object.');
  for (const key of ['id', 'shopId', 'normalizedPhone', 'displayPhone', 'name', 'lastOrderAt']) {
    requiredString(value, key);
  }
}

function assertMovement(value: unknown): asserts value is InventoryMovement {
  if (!isRecord(value)) throw new TypeError('Operations sync inventory movement must be an object.');
  for (const key of ['id', 'shopId', 'itemId', 'movementType', 'idempotencyKey', 'workerId', 'createdAt']) {
    requiredString(value, key);
  }
  requiredSafeInteger(value, 'quantityDeltaMicros');
}

function assertExpense(value: unknown): asserts value is ExpenseLedgerRecord {
  if (!isRecord(value)) throw new TypeError('Operations sync expense must be an object.');
  for (const key of ['id', 'shopId', 'businessDayId', 'kind', 'description', 'createdByWorkerId', 'createdAt']) {
    requiredString(value, key);
  }
  if (value['kind'] === 'MANUAL') {
    requiredSafeInteger(value, 'amountMinor');
    if (!isRecord(value['lifecycle'])) {
      throw new TypeError('Operations sync manual expense must include lifecycle metadata.');
    }
    requiredSafeInteger(value['lifecycle'], 'revision');
  } else if (value['kind'] !== 'DELIVERY_FAILED') {
    throw new TypeError('Operations sync expense kind is unsupported.');
  }
}

function assertBusinessDay(value: unknown): void {
  if (!isRecord(value)) throw new TypeError('Operations sync Business Day must be an object.');
  for (const key of ['id', 'shopId', 'status', 'startedAt', 'startedByWorkerId']) requiredString(value, key);
  requiredSafeInteger(value, 'lastAllocatedDisplayOrderNo');
}

function assertWorkerSession(value: unknown): void {
  if (!isRecord(value)) throw new TypeError('Operations sync worker session must be an object.');
  for (const key of ['id', 'shopId', 'businessDayId', 'workerId', 'startedAt']) requiredString(value, key);
  if (value['endedAt'] !== null && typeof value['endedAt'] !== 'string') {
    throw new TypeError('Operations sync worker session endedAt must be a string or null.');
  }
}

function assertReconciliation(value: unknown): void {
  if (!isRecord(value)) throw new TypeError('Operations sync reconciliation must be an object.');
  for (const key of ['id', 'shopId', 'businessDayId', 'createdByWorkerId', 'createdAt']) requiredString(value, key);
  if (!Array.isArray(value['lines'])) throw new TypeError('Operations sync reconciliation lines are required.');
  for (const line of value['lines']) {
    if (!isRecord(line) || !isRecord(line['paymentMethod'])) {
      throw new TypeError('Operations sync reconciliation line is invalid.');
    }
    requiredString(line['paymentMethod'], 'id');
    requiredString(line['paymentMethod'], 'label');
    requiredString(line['paymentMethod'], 'logicType');
    requiredSafeInteger(line, 'expectedMinor');
    requiredSafeInteger(line, 'actualMinor');
    requiredSafeInteger(line, 'differenceMinor');
  }
}

function assertTransition(value: unknown, eventType: OrderTransitionSyncEventType): void {
  if (!isRecord(value)) throw new TypeError('Operations sync order transition must be an object.');
  if (requiredString(value, 'eventType') !== eventType) {
    throw new TypeError('Operations sync transition event type must match its payload.');
  }
  requiredSafeInteger(value, 'revision');
  requiredString(value, 'fromStatus');
  requiredString(value, 'toStatus');
  requiredString(value, 'at');
  requiredString(value, 'workerId');
  requiredString(value, 'workerName');
  for (const key of ['reason', 'foodPrepared', 'stockRestored']) {
    const field = value[key];
    if (
      (key === 'reason' && field !== null && typeof field !== 'string') ||
      (key !== 'reason' && field !== null && typeof field !== 'boolean')
    ) {
      throw new TypeError(`Operations sync transition ${key} is invalid.`);
    }
  }
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

export function parseOperationsSyncPayloadV1(value: unknown): OperationsSyncPayloadV1 {
  if (!isRecord(value)) throw new TypeError('Operations sync payload must be an object.');
  const eventType = requiredString(value, 'eventType') as OperationsSyncPayloadV1['eventType'];
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw new TypeError(`Unsupported Operations sync event type: ${eventType}.`);
  }
  if (value['version'] !== OPERATIONS_SYNC_PAYLOAD_VERSION) {
    throw new TypeError('Unsupported Operations sync payload version.');
  }

  if (eventType === 'ORDER_PLACED') {
    assertOrder(value['order']);
    if (value['customerContactUpsert'] !== null) assertCustomerContact(value['customerContactUpsert']);
    if (!Array.isArray(value['inventoryMovements'])) throw new TypeError('ORDER_PLACED inventory movements are required.');
    value['inventoryMovements'].forEach(assertMovement);
    requiredSafeInteger(value, 'configurationVersion');
  } else if (
    eventType === 'ORDER_MARKED_DONE' ||
    eventType === 'ORDER_DONE_UNDONE' ||
    eventType === 'ORDER_CANCELLED' ||
    eventType === 'DELIVERY_RETURNED'
  ) {
    assertOrder(value['order']);
    assertTransition(value['transition'], eventType);
    if (!Array.isArray(value['inventoryMovements'])) throw new TypeError('Order transition inventory movements are required.');
    value['inventoryMovements'].forEach(assertMovement);
    if (value['deliveryFailedExpense'] !== null) assertExpense(value['deliveryFailedExpense']);
  } else if (
    eventType === 'EXPENSE_CREATED' ||
    eventType === 'EXPENSE_EDITED' ||
    eventType === 'EXPENSE_DELETED'
  ) {
    assertExpense(value['expense']);
  } else if (eventType === 'INVENTORY_MOVEMENT_RECORDED') {
    assertMovement(value['movement']);
  } else if (eventType === 'BUSINESS_DAY_STARTED' || eventType === 'BUSINESS_DAY_CLOSED') {
    assertBusinessDay(value['businessDay']);
  } else if (
    eventType === 'WORKER_SIGNED_IN' ||
    eventType === 'WORKER_SWITCHED' ||
    eventType === 'WORKER_SIGNED_OUT'
  ) {
    assertWorkerSession(value['session']);
    if (value['previousSession'] !== null) assertWorkerSession(value['previousSession']);
  } else if (eventType === 'RECONCILIATION_RECORDED') {
    assertReconciliation(value['reconciliation']);
  }

  return value as unknown as OperationsSyncPayloadV1;
}

export function operationsSyncPayloadJson(payload: OperationsSyncPayloadV1): JsonValue {
  parseOperationsSyncPayloadV1(payload);
  return payload as unknown as JsonValue;
}

export function toOperationsSyncEnvelopeV1(event: OutboxEvent): OperationsSyncEnvelopeV1 {
  if (event.payloadVersion !== OPERATIONS_SYNC_PAYLOAD_VERSION) {
    throw new TypeError(`Unsupported outbox payload version: ${event.payloadVersion}.`);
  }
  const payload = parseOperationsSyncPayloadV1(event.payload);
  if (payload.eventType !== event.eventType) {
    throw new TypeError('Outbox event type does not match its versioned payload.');
  }
  return {
    eventId: event.id,
    shopId: event.shopId,
    businessDayId: event.businessDayId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: payload.eventType,
    idempotencyKey: event.idempotencyKey,
    payloadVersion: OPERATIONS_SYNC_PAYLOAD_VERSION,
    payload,
    createdAt: event.createdAt,
  };
}
