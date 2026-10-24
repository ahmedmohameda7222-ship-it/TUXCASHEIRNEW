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
import { describe, expect, it, vi } from 'vitest';
import { createOrderStore } from '../../api/admin/orders';
import type { AdminSupabaseClient } from '../supabaseAdmin';
import { buildRemoteMaterializationPlanV1 } from '../../../../packages/sync/src/remoteMaterializer';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const DAY_ID = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const WORKER_ID = parseEntityId<WorkerId>('44444444-4444-4444-8444-444444444444');
const ORDER_ID = parseEntityId<OrderId>('55555555-5555-4555-8555-555555555555');
const CREATED_AT = instant('2026-10-24T04:00:00.000Z');

function placedOrderEvent(): OutboxEvent {
  const order: OrderSnapshot = {
    id: ORDER_ID,
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    displayOrderNo: 73,
    idempotencyKey: 'ORDER_PLACED:admin-visibility-fixture',
    status: 'ACTIVE',
    lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
    source: 'POS',
    operatorWorkerId: WORKER_ID,
    operatorName: 'Visibility Worker',
    createdAt: CREATED_AT,
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
        productName: 'Visibility Burger',
        unitPriceMinor: moneyMinor(12_500),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(12_500),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor: moneyMinor(12_500),
    payments: [
      {
        id: parseEntityId<PaymentId>('99999999-9999-4999-8999-999999999999'),
        method: {
          id: parseEntityId<PaymentMethodId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          label: 'Cash',
          logicType: 'CASH',
        },
        allocatedMinor: moneyMinor(12_500),
        receivedMinor: moneyMinor(12_500),
        changeMinor: moneyMinor(0),
      },
    ],
  };

  return {
    id: parseEntityId<OutboxEventId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    aggregateType: 'ORDER',
    aggregateId: ORDER_ID,
    aggregateRevision: 0,
    eventType: 'ORDER_PLACED',
    idempotencyKey: order.idempotencyKey,
    payloadVersion: 1,
    payload: operationsSyncPayloadJson({
      eventType: 'ORDER_PLACED',
      version: 1,
      order,
      customerContactUpsert: null,
      inventoryMovements: [],
      configurationVersion: 7,
    }),
    createdAt: CREATED_AT,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

describe('Operations sync to Admin order visibility', () => {
  it('makes the canonical ORDER_PLACED row readable by the Admin order store', async () => {
    const plan = buildRemoteMaterializationPlanV1(toOperationsSyncEnvelopeV1(placedOrderEvent()));
    const orderMutation = plan.mutations.find((entry) => entry.table === 'orders');
    expect(orderMutation).toBeDefined();

    const select = vi.fn(async (table: string) => {
      if (table === 'business_shops') return [{ shop_id: SHOP_ID }];
      if (table === 'orders') return [orderMutation!.row];
      throw new Error(`unexpected_table:${table}`);
    });
    const store = createOrderStore({ select } as unknown as AdminSupabaseClient);

    const result = await store.searchOrders({
      shopId: SHOP_ID,
      businessId: BUSINESS_ID,
      employeeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      limit: 50,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: ORDER_ID,
        shopId: SHOP_ID,
        status: 'ACTIVE',
        operationalRevision: 0,
        source: 'POS',
        displayOrderLabel: '#73',
        totalMinor: 12_500,
        orderTypeLabel: 'Takeaway',
      }),
    ]);
    expect(select).toHaveBeenNthCalledWith(2, 'orders', expect.any(URLSearchParams));
  });
});
