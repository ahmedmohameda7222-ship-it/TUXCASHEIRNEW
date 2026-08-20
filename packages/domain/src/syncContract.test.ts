import { describe, expect, it } from 'vitest';
import {
  parseOperationsSyncPayloadV1,
  type OperationsSyncPayloadV1,
} from './syncContract';
import { moneyMinor } from './money';
import { stockQuantityMicros } from './quantity';
import { instant } from './time';
import {
  parseEntityId,
  type BusinessDayId,
  type CustomerContactId,
  type ExpenseId,
  type InventoryItemId,
  type InventoryMovementId,
  type OrderId,
  type OrderItemId,
  type OrderTypeId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ReconciliationId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from './ids';
import type {
  CustomerContact,
  InventoryMovement,
  OrderSnapshot,
  Reconciliation,
  WorkerSession,
} from './models';
import type { ManualExpenseRecord } from './expense';

const id = <Id extends string>(value: string): Id => parseEntityId(value) as Id;
const shopId = id<ShopId>('11111111-1111-4111-8111-111111111111');
const businessDayId = id<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = id<WorkerId>('33333333-3333-4333-8333-333333333333');
const at = instant('2026-08-20T00:00:00.000Z');

const order: OrderSnapshot = {
  id: id<OrderId>('44444444-4444-4444-8444-444444444444'),
  shopId,
  businessDayId,
  displayOrderNo: 17,
  idempotencyKey: '55555555-5555-4555-8555-555555555555',
  status: 'ACTIVE',
  lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
  source: 'POS',
  operatorWorkerId: workerId,
  operatorName: 'Dev Worker',
  createdAt: at,
  fulfillment: {
    orderTypeId: id<OrderTypeId>('66666666-6666-4666-8666-666666666666'),
    orderTypeLabel: 'Delivery',
    behavior: 'DELIVERY',
    delivery: {
      customerContactId: id<CustomerContactId>('77777777-7777-4777-8777-777777777777'),
      customerName: 'Customer',
      normalizedPhone: '01012345678',
      address: '1 Test Street',
      zoneId: id('88888888-8888-4888-8888-888888888888'),
      zoneLabel: 'Zone A',
      configuredFeeMinor: moneyMinor(2500),
      finalFeeMinor: moneyMinor(2500),
    },
  },
  items: [
    {
      id: id<OrderItemId>('99999999-9999-4999-8999-999999999999'),
      productId: id<ProductId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      productName: 'Burger',
      unitPriceMinor: moneyMinor(10000),
      quantity: 2,
      modifiers: [],
      comboBeverages: [],
      itemNote: 'No onions',
    },
  ],
  orderNote: 'Call on arrival',
  itemsSubtotalMinor: moneyMinor(20000),
  discountMinor: moneyMinor(0),
  deliveryFeeMinor: moneyMinor(2500),
  totalMinor: moneyMinor(22500),
  payments: [
    {
      id: id<PaymentId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      method: {
        id: id<PaymentMethodId>('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        label: 'Cash',
        logicType: 'CASH',
      },
      allocatedMinor: moneyMinor(22500),
      receivedMinor: moneyMinor(25000),
      changeMinor: moneyMinor(2500),
    },
  ],
};

const contact: CustomerContact = {
  id: order.fulfillment.delivery!.customerContactId,
  shopId,
  normalizedPhone: '01012345678',
  displayPhone: '+20 101 234 5678',
  name: 'Customer',
  latestAddress: '1 Test Street',
  latestZoneId: order.fulfillment.delivery!.zoneId,
  lastOrderAt: at,
};

const movement: InventoryMovement = {
  id: id<InventoryMovementId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  shopId,
  businessDayId,
  itemId: id<InventoryItemId>('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  movementType: 'ORDER_CONSUMPTION',
  quantityDeltaMicros: stockQuantityMicros(-1_000_000),
  idempotencyKey: `order-consumption:${order.id}:ingredient`,
  workerId,
  orderId: order.id,
  createdAt: at,
  compensatesMovementId: null,
};

const manualExpense: ManualExpenseRecord = {
  id: id<ExpenseId>('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  shopId,
  businessDayId,
  kind: 'MANUAL',
  description: 'Cleaning supplies',
  amountMinor: moneyMinor(5000),
  paidFrom: 'CASH',
  note: null,
  orderId: null,
  createdByWorkerId: workerId,
  createdAt: at,
  lifecycle: {
    revision: 0,
    updatedAt: null,
    updatedByWorkerId: null,
    deletedAt: null,
    deletedByWorkerId: null,
  },
};

const session: WorkerSession = {
  id: id<WorkerSessionId>('12121212-1212-4212-8212-121212121212'),
  shopId,
  businessDayId,
  workerId,
  startedAt: at,
  endedAt: null,
};

const reconciliation: Reconciliation = {
  id: id<ReconciliationId>('13131313-1313-4313-8313-131313131313'),
  shopId,
  businessDayId,
  createdByWorkerId: workerId,
  createdAt: at,
  lines: [
    {
      paymentMethod: order.payments[0]!.method,
      expectedMinor: moneyMinor(22500),
      actualMinor: moneyMinor(22000),
      differenceMinor: moneyMinor(-500),
      varianceReason: 'Short by 5 EGP',
    },
  ],
};

function roundTrip(payload: OperationsSyncPayloadV1): OperationsSyncPayloadV1 {
  return parseOperationsSyncPayloadV1(JSON.parse(JSON.stringify(payload)) as unknown);
}

describe('OperationsSyncPayloadV1', () => {
  it('preserves the complete ORDER_PLACED materialization facts', () => {
    const payload = roundTrip({
      eventType: 'ORDER_PLACED',
      version: 1,
      order,
      customerContactUpsert: contact,
      inventoryMovements: [movement],
      configurationVersion: 9,
    });
    expect(payload).toMatchObject({
      eventType: 'ORDER_PLACED',
      order: {
        id: order.id,
        fulfillment: { delivery: { customerContactId: contact.id } },
        items: order.items,
        payments: order.payments,
        totalMinor: order.totalMinor,
      },
      customerContactUpsert: contact,
      inventoryMovements: [movement],
      configurationVersion: 9,
    });
  });

  it('preserves exact transition attribution and side effects', () => {
    const cancelled = {
      ...order,
      status: 'CANCELLED' as const,
      lifecycle: {
        revision: 1,
        doneAt: null,
        cancellation: {
          at,
          workerId,
          workerName: 'Dev Worker',
          foodPrepared: false,
          reason: 'Customer cancelled',
          stockRestored: true,
        },
        returned: null,
      },
    };
    const restock = {
      ...movement,
      id: id<InventoryMovementId>('14141414-1414-4414-8414-141414141414'),
      movementType: 'CANCEL_RESTOCK' as const,
      quantityDeltaMicros: stockQuantityMicros(1_000_000),
      compensatesMovementId: movement.id,
      idempotencyKey: `cancel-restock:${order.id}:${movement.id}`,
    };
    const payload = roundTrip({
      eventType: 'ORDER_CANCELLED',
      version: 1,
      order: cancelled,
      transition: {
        eventType: 'ORDER_CANCELLED',
        revision: 1,
        fromStatus: 'ACTIVE',
        toStatus: 'CANCELLED',
        at,
        workerId,
        workerName: 'Dev Worker',
        reason: 'Customer cancelled',
        foodPrepared: false,
        stockRestored: true,
      },
      inventoryMovements: [restock],
      deliveryFailedExpense: null,
    });
    expect(payload).toMatchObject({
      eventType: 'ORDER_CANCELLED',
      transition: { workerId, revision: 1, foodPrepared: false, stockRestored: true },
      inventoryMovements: [{ id: restock.id, compensatesMovementId: movement.id }],
    });
  });

  it('round-trips every remaining critical remote event family', () => {
    const businessDay = {
      id: businessDayId,
      shopId,
      status: 'OPEN' as const,
      startedAt: at,
      endedAt: null,
      startedByWorkerId: workerId,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 17,
    };
    const payloads: OperationsSyncPayloadV1[] = [
      { eventType: 'EXPENSE_CREATED', version: 1, expense: manualExpense },
      { eventType: 'EXPENSE_EDITED', version: 1, expense: { ...manualExpense, lifecycle: { ...manualExpense.lifecycle, revision: 1, updatedAt: at, updatedByWorkerId: workerId } } },
      { eventType: 'EXPENSE_DELETED', version: 1, expense: { ...manualExpense, lifecycle: { ...manualExpense.lifecycle, revision: 1, deletedAt: at, deletedByWorkerId: workerId } } },
      { eventType: 'INVENTORY_MOVEMENT_RECORDED', version: 1, movement },
      { eventType: 'BUSINESS_DAY_STARTED', version: 1, businessDay },
      { eventType: 'WORKER_SIGNED_IN', version: 1, session, previousSession: null },
      { eventType: 'WORKER_SWITCHED', version: 1, session, previousSession: { ...session, id: id<WorkerSessionId>('15151515-1515-4515-8515-151515151515'), endedAt: at } },
      { eventType: 'WORKER_SIGNED_OUT', version: 1, session: { ...session, endedAt: at }, previousSession: null },
      { eventType: 'RECONCILIATION_RECORDED', version: 1, reconciliation },
      { eventType: 'BUSINESS_DAY_CLOSED', version: 1, businessDay: { ...businessDay, status: 'CLOSED', endedAt: at, endedByWorkerId: workerId } },
    ];
    for (const payload of payloads) {
      expect(roundTrip(payload)).toEqual(payload);
    }
  });

  it('rejects unsupported versions and incomplete placement facts at runtime', () => {
    expect(() => parseOperationsSyncPayloadV1({ eventType: 'ORDER_PLACED', version: 2 })).toThrow(
      /version/i,
    );
    expect(() =>
      parseOperationsSyncPayloadV1({
        eventType: 'ORDER_PLACED',
        version: 1,
        order: { id: order.id },
        customerContactUpsert: null,
        inventoryMovements: [],
        configurationVersion: 1,
      }),
    ).toThrow();
  });
});