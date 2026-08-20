import { describe, expect, it } from 'vitest';
import type { OperationsConfigurationSnapshot } from './catalog';
import {
  buildEndDayReconciliationProjection,
  calculateEndDayFinancialProjection,
  endDayReconciliationMethods,
  normalizeEndDayVarianceReason,
} from './endDay';
import type { ExpenseLedgerRecord } from './expense';
import { parseEntityId } from './ids';
import type {
  BusinessDayId,
  ExpenseId,
  OrderId,
  OrderItemId,
  OrderTypeId,
  PaymentId,
  PaymentMethodId,
  ProductId,
  ShopId,
  WorkerId,
} from './ids';
import { moneyMinor } from './money';
import type { OrderSnapshot } from './models';
import { instant } from './time';

const SHOP_ID = parseEntityId<ShopId>('12000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('22000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('32000000-0000-4000-8000-000000000001');
const CASH_ID = parseEntityId<PaymentMethodId>('42000000-0000-4000-8000-000000000001');
const DIGITAL_ID = parseEntityId<PaymentMethodId>('42000000-0000-4000-8000-000000000002');

function configuration(): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: 1,
    updatedAt: instant('2026-08-18T10:00:00.000Z'),
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [
      {
        id: DIGITAL_ID,
        shopId: SHOP_ID,
        displayName: 'Instapay',
        logicType: 'DIGITAL',
        requiresReconciliation: true,
        active: true,
        sortOrder: 0,
      },
      {
        id: CASH_ID,
        shopId: SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 9,
      },
    ],
    deliveryZones: [],
  };
}

function order(
  id: string,
  status: OrderSnapshot['status'],
  cashMinor: number,
  digitalMinor: number,
): OrderSnapshot {
  const totalMinor = moneyMinor(cashMinor + digitalMinor);
  return {
    id: parseEntityId<OrderId>(id),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    displayOrderNo: Number(id.slice(-1)),
    idempotencyKey: `order:${id}`,
    status,
    source: 'POS',
    operatorWorkerId: WORKER_ID,
    operatorName: 'Ahmed',
    createdAt: instant('2026-08-18T15:00:00.000Z'),
    fulfillment: {
      orderTypeId: parseEntityId<OrderTypeId>('52000000-0000-4000-8000-000000000001'),
      orderTypeLabel: 'Take Away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: parseEntityId<OrderItemId>(`62000000-0000-4000-8000-00000000000${id.slice(-1)}`),
        productId: parseEntityId<ProductId>('72000000-0000-4000-8000-000000000001'),
        productName: 'Burger',
        unitPriceMinor: totalMinor,
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: totalMinor,
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor,
    payments: [
      ...(cashMinor === 0
        ? []
        : [
            {
              id: parseEntityId<PaymentId>(`82000000-0000-4000-8000-00000000000${id.slice(-1)}`),
              method: { id: CASH_ID, label: 'Cash', logicType: 'CASH' as const },
              allocatedMinor: moneyMinor(cashMinor),
              receivedMinor: moneyMinor(cashMinor),
              changeMinor: moneyMinor(0),
            },
          ]),
      ...(digitalMinor === 0
        ? []
        : [
            {
              id: parseEntityId<PaymentId>(`92000000-0000-4000-8000-00000000000${id.slice(-1)}`),
              method: { id: DIGITAL_ID, label: 'Instapay', logicType: 'DIGITAL' as const },
              allocatedMinor: moneyMinor(digitalMinor),
              receivedMinor: null,
              changeMinor: null,
            },
          ]),
    ],
  };
}

function cashExpense(): ExpenseLedgerRecord {
  return {
    id: parseEntityId<ExpenseId>('a2000000-0000-4000-8000-000000000001'),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    kind: 'MANUAL',
    description: 'Taxi',
    amountMinor: moneyMinor(2_500),
    paidFrom: 'CASH',
    note: null,
    orderId: null,
    createdByWorkerId: WORKER_ID,
    createdAt: instant('2026-08-18T18:00:00.000Z'),
    lifecycle: {
      revision: 0,
      updatedAt: null,
      updatedByWorkerId: null,
      deletedAt: null,
      deletedByWorkerId: null,
    },
  };
}

describe('End Day domain rules', () => {
  it('orders Cash before Instapay regardless of configured sort order', () => {
    expect(endDayReconciliationMethods(configuration()).map((method) => method.id)).toEqual([
      CASH_ID,
      DIGITAL_ID,
    ]);
  });

  it('counts DONE orders only and subtracts Cash-paid Expenses from Expected Cash', () => {
    const projection = calculateEndDayFinancialProjection({
      configuration: configuration(),
      expenses: [cashExpense()],
      orders: [
        order('b2000000-0000-4000-8000-000000000001', 'DONE', 10_000, 5_000),
        order('b2000000-0000-4000-8000-000000000002', 'CANCELLED', 20_000, 0),
        order('b2000000-0000-4000-8000-000000000003', 'RETURNED', 0, 30_000),
      ],
    });
    expect(projection.recognizedSalesMinor).toBe(moneyMinor(15_000));
    expect(projection.totalExpensesMinor).toBe(moneyMinor(2_500));
    expect(projection.cashExpensesMinor).toBe(moneyMinor(2_500));
    expect(projection.expectedPayments).toEqual([
      {
        paymentMethodId: CASH_ID,
        label: 'Cash',
        logicType: 'CASH',
        expectedMinor: moneyMinor(7_500),
      },
      {
        paymentMethodId: DIGITAL_ID,
        label: 'Instapay',
        logicType: 'DIGITAL',
        expectedMinor: moneyMinor(5_000),
      },
    ]);
  });

  it('builds exact signed variance and requires a reason only when non-zero', () => {
    const lines = buildEndDayReconciliationProjection(
      [
        {
          paymentMethodId: CASH_ID,
          label: 'Cash',
          logicType: 'CASH',
          expectedMinor: moneyMinor(10_000),
        },
      ],
      [{ paymentMethodId: CASH_ID, actualMinor: moneyMinor(9_500) }],
    );
    expect(lines[0]?.differenceMinor).toBe(moneyMinor(-500));
    expect(normalizeEndDayVarianceReason(moneyMinor(0), '')).toBeNull();
    expect(normalizeEndDayVarianceReason(moneyMinor(-500), '  counted twice  ')).toBe(
      'counted twice',
    );
    expect(() => normalizeEndDayVarianceReason(moneyMinor(-500), '')).toThrow(/reason/);
  });
});
