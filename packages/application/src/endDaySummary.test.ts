import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type ExpenseId,
  type ManualExpenseRecord,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderId,
  type OrderSnapshot,
  type OrderTypeId,
  type PaymentId,
  type PaymentMethodId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type {
  ExpenseLedgerStore,
  OperationsDatabase,
  OperationsTransaction,
  OperatorSessionReadModel,
  OrderDraftStore,
} from '@tux/persistence';
import { describe, expect, it } from 'vitest';
import { OperationsEndDayService } from './endDay';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const dayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const paymentMethodId = parseEntityId<PaymentMethodId>('44444444-4444-4444-8444-444444444444');
const orderTypeId = parseEntityId<OrderTypeId>('55555555-5555-4555-8555-555555555555');
const at = instant('2026-08-20T00:00:00.000Z');

const day: OpenBusinessDay = {
  id: dayId,
  shopId,
  status: 'OPEN',
  startedAt: at,
  endedAt: null,
  startedByWorkerId: workerId,
  endedByWorkerId: null,
  lastAllocatedDisplayOrderNo: 3,
};

const configuration: OperationsConfigurationSnapshot = {
  shopId,
  version: 1,
  categories: [],
  products: [],
  modifierGroups: [],
  modifiers: [],
  orderTypes: [
    { id: orderTypeId, shopId, name: 'Takeaway', behavior: 'TAKEAWAY', sortOrder: 1, active: true },
  ],
  paymentMethods: [
    { id: paymentMethodId, shopId, displayName: 'Cash', logicType: 'CASH', sortOrder: 1, active: true },
  ],
  deliveryZones: [],
  inventoryItems: [],
  recipeLines: [],
  updatedAt: at,
};

function order(id: string, displayOrderNo: number, status: OrderSnapshot['status']): OrderSnapshot {
  return {
    id: parseEntityId<OrderId>(id),
    shopId,
    businessDayId: dayId,
    displayOrderNo,
    idempotencyKey: `checkout-${displayOrderNo}`,
    status,
    lifecycle: {
      revision: status === 'DONE' ? 1 : status === 'CANCELLED' ? 1 : status === 'RETURNED' ? 2 : 0,
      doneAt: status === 'DONE' || status === 'RETURNED' ? at : null,
      cancellation:
        status === 'CANCELLED'
          ? {
              at,
              workerId,
              workerName: 'Dev Worker',
              foodPrepared: true,
              reason: 'Cancelled',
              stockRestored: false,
            }
          : null,
      returned:
        status === 'RETURNED'
          ? { at, workerId, workerName: 'Dev Worker', reason: 'Delivery failed' }
          : null,
    },
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Dev Worker',
    createdAt: at,
    fulfillment: {
      orderTypeId,
      orderTypeLabel: 'Takeaway',
      behavior: 'TAKEAWAY',
      delivery: null,
    },
    items: [],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(10000),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor: moneyMinor(10000),
    payments: [
      {
        id: parseEntityId<PaymentId>(`66666666-6666-4666-8666-${String(displayOrderNo).padStart(12, '0')}`),
        method: { id: paymentMethodId, label: 'Cash', logicType: 'CASH' },
        allocatedMinor: moneyMinor(10000),
        receivedMinor: moneyMinor(10000),
        changeMinor: moneyMinor(0),
      },
    ],
  };
}

const expenses: readonly ManualExpenseRecord[] = [
  {
    id: parseEntityId<ExpenseId>('77777777-7777-4777-8777-777777777771'),
    shopId,
    businessDayId: dayId,
    kind: 'MANUAL',
    description: 'Cash supplies',
    amountMinor: moneyMinor(2000),
    paidFrom: 'CASH',
    note: null,
    orderId: null,
    createdByWorkerId: workerId,
    createdAt: at,
    lifecycle: { revision: 0, updatedAt: null, updatedByWorkerId: null, deletedAt: null, deletedByWorkerId: null },
  },
  {
    id: parseEntityId<ExpenseId>('77777777-7777-4777-8777-777777777772'),
    shopId,
    businessDayId: dayId,
    kind: 'MANUAL',
    description: 'Other supplies',
    amountMinor: moneyMinor(3000),
    paidFrom: 'OTHER',
    note: null,
    orderId: null,
    createdByWorkerId: workerId,
    createdAt: at,
    lifecycle: { revision: 0, updatedAt: null, updatedByWorkerId: null, deletedAt: null, deletedByWorkerId: null },
  },
];

function fixture() {
  const orders = [
    order('88888888-8888-4888-8888-888888888881', 1, 'DONE'),
    order('88888888-8888-4888-8888-888888888882', 2, 'CANCELLED'),
    order('88888888-8888-4888-8888-888888888883', 3, 'RETURNED'),
  ];
  const database: OperationsDatabase = {
    transaction: async <Result>(work: (transaction: OperationsTransaction) => Promise<Result>) =>
      work({
        businessDays: {
          getById: async () => day,
          getOpenForShop: async () => day,
          put: async () => undefined,
        },
        configuration: {
          getForShop: async () => configuration,
          put: async () => undefined,
        },
        workers: {
          getById: async () => ({ id: workerId, shopId, displayName: 'Dev Worker', pinHash: 'hash', active: true }),
          put: async () => undefined,
        },
        orders: {
          getById: async () => null,
          getByIdempotencyKey: async () => null,
          listByBusinessDay: async () => orders,
          insert: async () => undefined,
          updateOperationalState: async () => undefined,
        },
      } as unknown as OperationsTransaction),
  };
  const readModel = {
    getOpenWorkerSession: async () => ({
      id: parseEntityId<WorkerSessionId>('99999999-9999-4999-8999-999999999999'),
      shopId,
      businessDayId: dayId,
      workerId,
      startedAt: at,
      endedAt: null,
    }),
  } as unknown as OperatorSessionReadModel;
  const draftStore = { get: async () => null } as unknown as OrderDraftStore;
  const expenseStore = {
    listByBusinessDay: async () => expenses,
  } as unknown as ExpenseLedgerStore;
  return new OperationsEndDayService(database, readModel, draftStore, expenseStore, {
    now: () => at,
    createUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
}

describe('End Day approved final summary projection', () => {
  it('projects Completed/Cancelled/Returned and separate Total/Cash Expenses', async () => {
    const service = fixture();
    const result = await service.previewReconciliation({
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      actualPayments: [{ paymentMethodId, actualMinor: moneyMinor(8000) }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      completedCount: 1,
      cancelledCount: 1,
      returnedCount: 1,
      totalExpensesMinor: moneyMinor(5000),
      cashExpensesMinor: moneyMinor(2000),
    });
    expect(result.value.lines).toHaveLength(1);
    expect(result.value.lines[0]?.paymentMethod.logicType).toBe('CASH');
  });
});