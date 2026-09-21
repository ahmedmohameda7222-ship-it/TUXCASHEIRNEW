import { describe, expect, it } from 'vitest';

import {
  instant,
  parseEntityId,
  type OrderId,
  type OrderSnapshot,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import {
  OrderLifecycleConvergenceService,
  type OrderLifecycleFeedPage,
  type OrderLifecycleFeedTransport,
} from './orderLifecycleConvergence';

const shopId = parseEntityId<ShopId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const orderId = parseEntityId<OrderId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

function order(): OrderSnapshot {
  return {
    id: orderId,
    shopId,
    businessDayId: parseEntityId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    displayOrderNo: 42,
    idempotencyKey: 'order-42',
    status: 'ACTIVE',
    lifecycle: {
      revision: 0,
      doneAt: null,
      cancellation: null,
      returned: null,
    },
    source: 'POS',
    operatorWorkerId: parseEntityId('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    operatorName: 'Ahmed',
    createdAt: instant('2026-09-21T03:00:00.000Z'),
    fulfillment: {
      orderTypeId: parseEntityId('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      orderTypeLabel: 'Take away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: parseEntityId('ffffffff-ffff-4fff-8fff-ffffffffffff'),
        productId: parseEntityId('11111111-1111-4111-8111-111111111111'),
        productName: 'Burger',
        unitPriceMinor: 10000,
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: 10000,
    discountMinor: 0,
    deliveryFeeMinor: 0,
    totalMinor: 10000,
    payments: [
      {
        id: parseEntityId('22222222-2222-4222-8222-222222222222'),
        method: {
          id: parseEntityId('33333333-3333-4333-8333-333333333333'),
          label: 'Cash',
          logicType: 'CASH',
          requiresReconciliation: true,
        },
        allocatedMinor: 10000,
        receivedMinor: 10000,
        changeMinor: 0,
      },
    ],
  };
}

function fakeDatabase() {
  let stored = order();
  let cursor: string | null = null;
  const transaction = {
    orders: {
      async getById(id: OrderId) {
        return id === stored.id ? stored : null;
      },
      async updateOperationalState(next: OrderSnapshot) {
        stored = next;
      },
      async getLifecycleSyncCursor(_shopId: ShopId) {
        return cursor;
      },
      async setLifecycleSyncCursor(_shopId: ShopId, next: string) {
        cursor = next;
      },
    },
  } as unknown as OperationsTransaction;
  const database: OperationsDatabase = {
    transaction: async (work) => work(transaction),
  };
  return {
    database,
    get order() {
      return stored;
    },
    get cursor() {
      return cursor;
    },
  };
}

describe('OrderLifecycleConvergenceService', () => {
  it('applies an Admin cancellation and advances the durable cursor atomically', async () => {
    const state = fakeDatabase();
    const page: OrderLifecycleFeedPage = {
      shopId,
      events: [
        {
          sequence: 11,
          orderId,
          operationalRevision: 1,
          status: 'CANCELLED',
          eventType: 'CANCELLED',
          occurredAt: instant('2026-09-21T03:05:00.000Z'),
          workerId: null,
          workerName: 'Admin',
          adminEmployeeId: '44444444-4444-4444-8444-444444444444',
          foodPrepared: false,
          reason: {
            id: '55555555-5555-4555-8555-555555555555',
            key: 'customer_cancelled',
            family: 'CANCELLATION',
            label: 'Customer cancelled',
            version: 3,
            scope: 'BUSINESS',
          },
          note: 'Called shop',
        },
      ],
      nextCursor: '11',
      hasMore: false,
    };
    const transport: OrderLifecycleFeedTransport = {
      async pull(requestShopId, cursor) {
        expect(requestShopId).toBe(shopId);
        expect(cursor).toBeNull();
        return page;
      },
    };

    const applied = await new OrderLifecycleConvergenceService(
      state.database,
      transport,
    ).syncShop(shopId);

    expect(applied).toBe(1);
    expect(state.cursor).toBe('11');
    expect(state.order.status).toBe('CANCELLED');
    expect(state.order.lifecycle?.revision).toBe(1);
    expect(state.order.lifecycle?.cancellation).toMatchObject({
      workerId: null,
      workerName: 'Admin',
      adminEmployeeId: '44444444-4444-4444-8444-444444444444',
      reason: 'Customer cancelled',
      stockRestored: true,
    });
  });

  it('ignores older canonical events while still advancing the feed cursor', async () => {
    const state = fakeDatabase();
    const existing = {
      ...state.order,
      status: 'DONE' as const,
      lifecycle: {
        revision: 2,
        doneAt: instant('2026-09-21T03:02:00.000Z'),
        cancellation: null,
        returned: null,
      },
    };
    await state.database.transaction((tx) => tx.orders.updateOperationalState(existing));

    const transport: OrderLifecycleFeedTransport = {
      async pull() {
        return {
          shopId,
          events: [
            {
              sequence: 12,
              orderId,
              operationalRevision: 1,
              status: 'CANCELLED',
              eventType: 'CANCELLED',
              occurredAt: instant('2026-09-21T03:01:00.000Z'),
              workerId: null,
              workerName: 'Admin',
              adminEmployeeId: '44444444-4444-4444-8444-444444444444',
              foodPrepared: false,
              reason: null,
              note: null,
            },
          ],
          nextCursor: '12',
          hasMore: false,
        };
      },
    };

    expect(
      await new OrderLifecycleConvergenceService(state.database, transport).syncShop(shopId),
    ).toBe(0);
    expect(state.order.status).toBe('DONE');
    expect(state.order.lifecycle?.revision).toBe(2);
    expect(state.cursor).toBe('12');
  });

  it('rejects a cross-shop feed before mutating local state or cursor', async () => {
    const state = fakeDatabase();
    const wrongShop = parseEntityId<ShopId>('66666666-6666-4666-8666-666666666666');
    const transport: OrderLifecycleFeedTransport = {
      async pull() {
        return { shopId: wrongShop, events: [], nextCursor: '20', hasMore: false };
      },
    };

    await expect(
      new OrderLifecycleConvergenceService(state.database, transport).syncShop(shopId),
    ).rejects.toThrow(/shop mismatch/i);
    expect(state.cursor).toBeNull();
    expect(state.order.status).toBe('ACTIVE');
  });
});
