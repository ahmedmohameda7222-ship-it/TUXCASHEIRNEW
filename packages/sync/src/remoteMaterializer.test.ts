import {
  instant,
  moneyMinor,
  operationsSyncPayloadJson,
  parseEntityId,
  toOperationsSyncEnvelopeV1,
  type BusinessDayId,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type OutboxEvent,
  type OutboxEventId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it } from 'vitest';
import { buildRemoteMaterializationPlanV1 } from './remoteMaterializer';

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
    behavior: 'TAKEAWAY',
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
): OutboxEvent {
  return {
    id: parseEntityId<OutboxEventId>(id),
    shopId,
    businessDayId: dayId,
    aggregateType: 'ORDER',
    aggregateId: order.id,
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
});