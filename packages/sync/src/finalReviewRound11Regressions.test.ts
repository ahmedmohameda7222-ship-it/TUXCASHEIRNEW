import { describe, expect, it } from 'vitest';

import { buildRemoteMaterializationPlanV1 } from './remoteMaterializer';

const shopId = '11111111-1111-4111-8111-111111111111';
const businessDayId = '22222222-2222-4222-8222-222222222222';
const workerId = '33333333-3333-4333-8333-333333333333';
const at = '2026-09-16T10:00:00.000Z';

function plan(
  payload: Record<string, unknown>,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
) {
  return buildRemoteMaterializationPlanV1({
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shopId,
    businessDayId,
    aggregateType,
    aggregateId,
    aggregateRevision: eventType === 'RECONCILIATION_RECORDED' ? null : 1,
    eventType,
    idempotencyKey: `round11:${eventType}`,
    payloadVersion: 1,
    payload,
    createdAt: at,
  } as never);
}

function cancelledOrder() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    shopId,
    businessDayId,
    displayOrderNo: 1,
    idempotencyKey: '55555555-5555-4555-8555-555555555555',
    status: 'CANCELLED',
    lifecycle: {
      revision: 1,
      doneAt: null,
      cancellation: {
        at,
        workerId,
        workerName: 'Dev Worker',
        foodPrepared: false,
        stockRestored: true,
        reason: 'Customer changed mind',
        reasonCode: {
          id: 'cancel-reason',
          key: 'CUSTOMER_CHANGED_MIND',
          family: 'CANCELLATION',
          label: 'Customer changed mind',
          version: 4,
          scope: 'SHOP',
        },
        note: 'Called before preparation',
      },
      returned: null,
    },
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Dev Worker',
    createdAt: '2026-09-16T09:55:00.000Z',
    fulfillment: {
      orderTypeId: '66666666-6666-4666-8666-666666666666',
      orderTypeLabel: 'Takeaway',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        productId: '88888888-8888-4888-8888-888888888888',
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
        id: '99999999-9999-4999-8999-999999999999',
        method: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          label: 'Cash',
          logicType: 'CASH',
        },
        allocatedMinor: 10000,
        receivedMinor: 10000,
        changeMinor: 0,
      },
    ],
  };
}

describe('Plan 2 final review round 11 remote durability regressions', () => {
  it('refreshes the remote order snapshot on lifecycle sync so immutable reason identity survives', () => {
    const order = cancelledOrder();
    const materialization = plan(
      {
        eventType: 'ORDER_CANCELLED',
        version: 1,
        order,
        transition: {
          eventType: 'ORDER_CANCELLED',
          revision: 1,
          fromStatus: 'ACTIVE',
          toStatus: 'CANCELLED',
          at,
          workerId,
          workerName: 'Dev Worker',
          reason: 'Customer changed mind',
          foodPrepared: false,
          stockRestored: true,
        },
        inventoryMovements: [],
        deliveryFailedExpense: null,
      },
      'ORDER_CANCELLED',
      'ORDER',
      order.id,
    );

    const orderMutation = materialization.mutations.find((entry) => entry.table === 'orders');
    expect(orderMutation?.mode).toBe('UPDATE');
    expect(orderMutation?.row).toHaveProperty('snapshot_json');
    expect(orderMutation?.row['snapshot_json']).toMatchObject({
      status: 'CANCELLED',
      lifecycle: {
        cancellation: {
          reasonCode: {
            id: 'cancel-reason',
            key: 'CUSTOMER_CHANGED_MIND',
            family: 'CANCELLATION',
            label: 'Customer changed mind',
            version: 4,
            scope: 'SHOP',
          },
        },
      },
    });
  });

  it('materializes the immutable CASH_VARIANCE reason snapshot on reconciliation lines', () => {
    const reconciliationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const reasonSnapshot = {
      id: 'cash-short',
      key: 'CASH_SHORT',
      family: 'CASH_VARIANCE',
      label: 'Cash short',
      version: 3,
      scope: 'SHOP',
    };
    const materialization = plan(
      {
        eventType: 'RECONCILIATION_RECORDED',
        version: 1,
        reconciliation: {
          id: reconciliationId,
          shopId,
          businessDayId,
          createdByWorkerId: workerId,
          createdAt: at,
          lines: [
            {
              paymentMethod: {
                id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                label: 'Cash',
                logicType: 'CASH',
              },
              expectedMinor: 0,
              actualMinor: 100,
              differenceMinor: 100,
              varianceReason: 'Cash short',
              varianceReasonCode: reasonSnapshot,
            },
          ],
        },
      },
      'RECONCILIATION_RECORDED',
      'RECONCILIATION',
      reconciliationId,
    );

    const lineMutation = materialization.mutations.find(
      (entry) => entry.table === 'reconciliation_lines',
    );
    expect(lineMutation?.row['variance_reason_code_snapshot']).toEqual(reasonSnapshot);
  });
});
