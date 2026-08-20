import {
  instant,
  moneyMinor,
  operationsSyncPayloadJson,
  parseEntityId,
  toOperationsSyncEnvelopeV1,
  type BusinessDayId,
  type InventoryItemId,
  type InventoryMovementId,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type OutboxEvent,
  type OutboxEventId,
  type ModifierId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it } from 'vitest';
import { buildRemoteMaterializationPlanV1, shouldApplyRemoteMutation } from './remoteMaterializer';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const dayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const at = instant('2026-08-20T00:00:00.000Z');

const order: OrderSnapshot = {
  id: parseEntityId<OrderId>('44444444-4444-4444-8444-444444444444'),
  shopId,
  businessDayId: dayId,
  displayOrderNo: 1,
  idempotencyKey: '55555555-5555-4555-8555-555555555555',
  status: 'ACTIVE',
  lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
  source: 'POS',
  operatorWorkerId: workerId,
  operatorName: 'Dev Worker',
  createdAt: at,
  fulfillment: {
    orderTypeId: parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666'),
    orderTypeLabel: 'Takeaway',
    behavior: 'TAKE_AWAY',
    delivery: null,
  },
  items: [
    {
      id: parseEntityId<OrderItemId>('77777777-7777-4777-8777-777777777777'),
      productId: parseEntityId<ProductId>('88888888-8888-4888-8888-888888888888'),
      productName: 'Burger',
      unitPriceMinor: moneyMinor(10000),
      quantity: 1,
      modifiers: [],
      comboBeverages: [],
      itemNote: null,
    },
  ],
  orderNote: null,
  itemsSubtotalMinor: moneyMinor(10000),
  discountMinor: moneyMinor(0),
  deliveryFeeMinor: moneyMinor(0),
  totalMinor: moneyMinor(10000),
  payments: [
    {
      id: parseEntityId<PaymentId>('99999999-9999-4999-8999-999999999999'),
      method: {
        id: parseEntityId<PaymentMethodId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        label: 'Cash',
        logicType: 'CASH',
      },
      allocatedMinor: moneyMinor(10000),
      receivedMinor: moneyMinor(10000),
      changeMinor: moneyMinor(0),
    },
  ],
};

function outbox(
  id: string,
  eventType: OutboxEvent['eventType'],
  payload: OutboxEvent['payload'],
  aggregateRevision = 0,
): OutboxEvent {
  return {
    id: parseEntityId<OutboxEventId>(id),
    shopId,
    businessDayId: dayId,
    aggregateType: 'ORDER',
    aggregateId: order.id,
    aggregateRevision,
    eventType,
    idempotencyKey: `${eventType}:${order.id}`,
    payloadVersion: 1,
    payload,
    createdAt: at,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

describe('buildRemoteMaterializationPlanV1', () => {
  it('uses exact local identities and retains placement-only configuration version', () => {
    const event = outbox(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'ORDER_PLACED',
      operationsSyncPayloadJson({
        eventType: 'ORDER_PLACED',
        version: 1,
        order,
        customerContactUpsert: null,
        inventoryMovements: [],
        configurationVersion: 42,
      }),
    );
    const plan = buildRemoteMaterializationPlanV1(toOperationsSyncEnvelopeV1(event));
    const orderMutation = plan.mutations.find((entry) => entry.table === 'orders');
    const statusMutation = plan.mutations.find((entry) => entry.table === 'order_status_events');
    expect(orderMutation?.row).toMatchObject({ id: order.id, configuration_version: 42 });
    expect(statusMutation?.row).toMatchObject({ id: event.id, order_id: order.id });
    expect(plan.mutations.every((entry) => entry.row['shop_id'] === shopId)).toBe(true);
  });

  it('does not erase placement-only configuration version on later lifecycle updates', () => {
    const doneOrder: OrderSnapshot = {
      ...order,
      status: 'DONE',
      lifecycle: { revision: 1, doneAt: at, cancellation: null, returned: null },
    };
    const event = outbox(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ORDER_MARKED_DONE',
      operationsSyncPayloadJson({
        eventType: 'ORDER_MARKED_DONE',
        version: 1,
        order: doneOrder,
        transition: {
          eventType: 'ORDER_MARKED_DONE',
          revision: 1,
          fromStatus: 'ACTIVE',
          toStatus: 'DONE',
          at,
          workerId,
          workerName: 'Dev Worker',
          reason: null,
          foodPrepared: null,
          stockRestored: null,
        },
        inventoryMovements: [],
        deliveryFailedExpense: null,
      }),
      1,
    );
    const plan = buildRemoteMaterializationPlanV1(toOperationsSyncEnvelopeV1(event));
    const orderMutation = plan.mutations.find((entry) => entry.table === 'orders');
    const statusMutation = plan.mutations.find((entry) => entry.table === 'order_status_events');
    expect(orderMutation?.row).not.toHaveProperty('configuration_version');
    expect(statusMutation?.row).toMatchObject({
      id: event.id,
      worker_id: workerId,
      operational_revision: 1,
      from_status: 'ACTIVE',
      to_status: 'DONE',
    });
  });

  it('rejects malformed nested network placement payloads before producing mutations', () => {
    const event = outbox(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'ORDER_PLACED',
      operationsSyncPayloadJson({
        eventType: 'ORDER_PLACED',
        version: 1,
        order,
        customerContactUpsert: null,
        inventoryMovements: [],
        configurationVersion: 42,
      }),
    );
    const envelope = toOperationsSyncEnvelopeV1(event);
    const item = order.items[0]!;
    const payment = order.payments[0]!;
    const invalidItemId = {
      ...envelope,
      payload: {
        ...envelope.payload,
        order: { ...order, items: [{ ...item, productId: 'not-a-uuid' }] },
      },
    };
    const invalidPaymentLogic = {
      ...envelope,
      payload: {
        ...envelope.payload,
        order: {
          ...order,
          payments: [{ ...payment, method: { ...payment.method, logicType: 'CRYPTO' } }],
        },
      },
    };
    const invalidRevision = {
      ...envelope,
      payload: {
        ...envelope.payload,
        order: {
          ...order,
          lifecycle: { revision: -1, doneAt: null, cancellation: null, returned: null },
        },
      },
    };
    const invalidTimestamp = {
      ...envelope,
      payload: { ...envelope.payload, order: { ...order, createdAt: 'not-a-timestamp' } },
    };
    const invalidMoney = {
      ...envelope,
      payload: { ...envelope.payload, order: { ...order, totalMinor: -1 } },
    };
    const unsafeMoney = {
      ...envelope,
      payload: {
        ...envelope.payload,
        order: { ...order, items: [{ ...item, unitPriceMinor: Number.MAX_SAFE_INTEGER + 1 }] },
      },
    };
    const invalidModifier = {
      ...envelope,
      payload: {
        ...envelope.payload,
        order: {
          ...order,
          items: [
            {
              ...item,
              modifiers: [
                {
                  modifierId: parseEntityId<ModifierId>('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
                  label: 'Extra',
                  unitPriceMinor: 0,
                  quantity: 'one',
                },
              ],
            },
          ],
        },
      },
    };
    const wrongShop = {
      ...envelope,
      shopId: parseEntityId<ShopId>('ffffffff-ffff-4fff-8fff-ffffffffffff'),
    };
    const malformedMovement = {
      ...envelope,
      payload: {
        ...envelope.payload,
        inventoryMovements: [
          {
            id: parseEntityId<InventoryMovementId>('12121212-1212-4212-8212-121212121212'),
            shopId,
            businessDayId: dayId,
            itemId: parseEntityId<InventoryItemId>('13131313-1313-4313-8313-131313131313'),
            movementType: 'UNKNOWN_MOVEMENT',
            quantityDeltaMicros: -1_000_000,
            idempotencyKey: 'bad-movement',
            workerId,
            orderId: order.id,
            createdAt: at,
            compensatesMovementId: null,
          },
        ],
      },
    };

    for (const malformed of [
      invalidItemId,
      invalidPaymentLogic,
      invalidRevision,
      invalidTimestamp,
      invalidMoney,
      unsafeMoney,
      invalidModifier,
      wrongShop,
      malformedMovement,
    ]) {
      expect(() => buildRemoteMaterializationPlanV1(malformed)).toThrow();
    }
  });
});

describe('remote monotonic mutation policy', () => {
  it('rejects stale order and expense revisions while accepting equal/idempotent or newer revisions', () => {
    expect(
      shouldApplyRemoteMutation(
        { operational_revision: 3 },
        {
          table: 'orders',
          mode: 'UPDATE',
          conflictColumns: ['id'],
          row: { id: order.id, operational_revision: 2 },
          guard: {
            kind: 'MONOTONIC_REVISION',
            column: 'operational_revision',
            incomingRevision: 2,
          },
        },
      ),
    ).toBe(false);
    expect(
      shouldApplyRemoteMutation(
        { lifecycle_revision: 3 },
        {
          table: 'expenses',
          mode: 'UPDATE',
          conflictColumns: ['id'],
          row: { id: 'expense', lifecycle_revision: 4 },
          guard: {
            kind: 'MONOTONIC_REVISION',
            column: 'lifecycle_revision',
            incomingRevision: 4,
          },
        },
      ),
    ).toBe(true);
  });

  it('prevents older customer learning and a stale worker-session reopen', () => {
    expect(
      shouldApplyRemoteMutation(
        { last_order_at: '2026-08-20T12:00:00.000Z' },
        {
          table: 'customer_contacts',
          mode: 'UPSERT',
          conflictColumns: ['id'],
          row: { id: 'contact', last_order_at: '2026-08-20T11:00:00.000Z' },
          guard: {
            kind: 'MONOTONIC_TIMESTAMP',
            column: 'last_order_at',
            incomingTimestamp: instant('2026-08-20T11:00:00.000Z'),
          },
        },
      ),
    ).toBe(false);
    expect(
      shouldApplyRemoteMutation(
        { ended_at: '2026-08-20T12:00:00.000Z' },
        {
          table: 'worker_sessions',
          mode: 'UPSERT',
          conflictColumns: ['id'],
          row: { id: 'session', ended_at: null },
          guard: {
            kind: 'MONOTONIC_TIMESTAMP',
            column: 'ended_at',
            incomingTimestamp: null,
          },
        },
      ),
    ).toBe(false);
  });

  it('prevents a stale Business Day start from reopening a closed day', () => {
    expect(
      shouldApplyRemoteMutation(
        { status: 'CLOSED' },
        {
          table: 'business_days',
          mode: 'UPSERT',
          conflictColumns: ['id'],
          row: { id: 'day', status: 'OPEN' },
          guard: {
            kind: 'STATE_RANK',
            column: 'status',
            incomingStatus: 'OPEN',
            rank: { OPEN: 0, CLOSED: 1 },
          },
        },
      ),
    ).toBe(false);
  });

  it('requires UPDATE mutations to target an existing remote aggregate', () => {
    expect(
      shouldApplyRemoteMutation(null, {
        table: 'orders',
        mode: 'UPDATE',
        conflictColumns: ['id'],
        row: { id: order.id, operational_revision: 1 },
        guard: {
          kind: 'MONOTONIC_REVISION',
          column: 'operational_revision',
          incomingRevision: 1,
        },
      }),
    ).toBe(false);
  });
});
