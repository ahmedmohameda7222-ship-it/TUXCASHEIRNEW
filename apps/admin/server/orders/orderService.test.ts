import { describe, expect, it } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { createOrderService, type OrderStore } from './orderService.js';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const employeeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const businessId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const cancellationReasonId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const refundReasonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function principal(
  permissions: AdminSessionPrincipal['permissions'] = [
    'orders.view',
    'orders.cancel',
    'orders.refund',
  ],
): AdminSessionPrincipal {
  return {
    employeeId,
    businessId,
    role: 'OWNER',
    permissions,
    shopIds: [shopId],
  };
}

function fixtureStore(): OrderStore {
  return {
    async searchOrders(input) {
      return { rows: [], nextCursor: null, shopId: input.shopId };
    },
    async getOrderDetail(input) {
      return {
        id: input.orderId,
        shopId: input.shopId,
        status: 'ACTIVE',
        operationalRevision: 4,
        source: 'POS',
        displayOrderNo: 42,
        displayOrderLabel: '#42',
        createdAt: '2026-09-21T03:00:00.000Z',
        totalMinor: 12500,
        customer: null,
        fulfillment: null,
        payments: [],
        items: [],
        statusHistory: [],
        inventoryMovements: [],
        auditEvents: [],
      };
    },
    async cancelActiveOrder(input) {
      return {
        ok: true,
        orderId: input.orderId,
        status: 'CANCELLED',
        operationalRevision: input.expectedOperationalRevision + 1,
        lifecycleCursor: 101,
        replayed: false,
      };
    },
    async requestRefund(input) {
      return {
        ok: true,
        orderId: input.orderId,
        refundId: '11111111-1111-4111-8111-111111111111',
        state: 'POSTED',
        replayed: false,
      };
    },
    async returnOrderItems(input) {
      return {
        ok: true,
        orderId: input.orderId,
        returnId: '22222222-2222-4222-8222-222222222222',
        state: 'POSTED',
        replayed: false,
      };
    },
  };
}

describe('Admin order service', () => {
  it('requires orders.cancel and forwards CAS revision plus structured cancellation reason', async () => {
    let captured: Parameters<OrderStore['cancelActiveOrder']>[0] | null = null;
    const store = fixtureStore();
    store.cancelActiveOrder = async (input) => {
      captured = input;
      return {
        ok: true,
        orderId: input.orderId,
        status: 'CANCELLED',
        operationalRevision: input.expectedOperationalRevision + 1,
        lifecycleCursor: 101,
        replayed: false,
      };
    };

    const service = createOrderService(store);
    await expect(
      service.cancelActiveOrder(
        {
          shopId,
          orderId,
          expectedOperationalRevision: 4,
          reasonCodeId: cancellationReasonId,
          note: 'Customer requested cancellation',
          commandId: 'cancel-1',
        },
        principal(),
      ),
    ).resolves.toMatchObject({
      ok: true,
      orderId,
      status: 'CANCELLED',
      operationalRevision: 5,
    });

    expect(captured).toMatchObject({
      shopId,
      orderId,
      expectedOperationalRevision: 4,
      reasonCodeId: cancellationReasonId,
      employeeId,
      businessId,
      commandId: 'cancel-1',
    });
  });

  it('blocks cancellation when the principal lacks orders.cancel', async () => {
    const service = createOrderService(fixtureStore());
    await expect(
      service.cancelActiveOrder(
        {
          shopId,
          orderId,
          expectedOperationalRevision: 4,
          reasonCodeId: cancellationReasonId,
          note: null,
          commandId: 'cancel-2',
        },
        principal(['orders.view']),
      ),
    ).rejects.toThrow(/permission|forbidden/i);
  });

  it('keeps refunds as separate immutable events and requires a refund-family reason', async () => {
    let captured: Parameters<OrderStore['requestRefund']>[0] | null = null;
    const store = fixtureStore();
    store.requestRefund = async (input) => {
      captured = input;
      return {
        ok: true,
        orderId: input.orderId,
        refundId: '11111111-1111-4111-8111-111111111111',
        state: 'POSTED',
        replayed: false,
      };
    };

    const service = createOrderService(store);
    await service.requestRefund(
      {
        shopId,
        orderId,
        paymentId: '33333333-3333-4333-8333-333333333333',
        amountMinor: 5000,
        reasonCodeId: refundReasonId,
        note: null,
        commandId: 'refund-1',
      },
      principal(),
    );

    expect(captured).toMatchObject({
      orderId,
      paymentId: '33333333-3333-4333-8333-333333333333',
      reasonCodeId: refundReasonId,
      employeeId,
      businessId,
      commandId: 'refund-1',
    });
  });
});
