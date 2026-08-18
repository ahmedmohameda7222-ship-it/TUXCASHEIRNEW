import { describe, expect, it } from 'vitest';
import {
  calculateExpenseTotals,
  createManualExpense,
  deleteManualExpense,
  editManualExpense,
  isExpenseDeleted,
  toExpenseLedgerRecord,
  type ExpenseLedgerRecord,
} from './expense';
import { parseEntityId } from './ids';
import { moneyMinor } from './money';
import { instant } from './time';
import type { BusinessDayId, ExpenseId, OrderId, ShopId, WorkerId } from './ids';
import type { Expense } from './models';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const OTHER_WORKER_ID = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000002');

function manual(id: string, amount: number, paidFrom: 'CASH' | 'OTHER') {
  return createManualExpense(
    {
      id: parseEntityId<ExpenseId>(id),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-18T10:00:00.000Z'),
    },
    { description: ' Taxi ', amountMinor: moneyMinor(amount), paidFrom, note: ' shift ride ' },
  );
}

describe('expense domain', () => {
  it('normalizes manual values and tracks audited edit/delete lifecycle', () => {
    const created = manual('40000000-0000-4000-8000-000000000001', 15_000, 'CASH');
    expect(created.description).toBe('Taxi');
    expect(created.note).toBe('shift ride');
    expect(created.lifecycle.revision).toBe(0);

    const edited = editManualExpense(
      created,
      { description: 'Fuel', amountMinor: moneyMinor(20_000), paidFrom: 'OTHER', note: '  ' },
      instant('2026-08-18T11:00:00.000Z'),
      OTHER_WORKER_ID,
    );
    expect(edited.note).toBeNull();
    expect(edited.lifecycle.revision).toBe(1);
    expect(edited.lifecycle.updatedByWorkerId).toBe(OTHER_WORKER_ID);

    const deleted = deleteManualExpense(edited, instant('2026-08-18T12:00:00.000Z'), WORKER_ID);
    expect(isExpenseDeleted(deleted)).toBe(true);
    expect(deleted.lifecycle.revision).toBe(2);
  });

  it('upgrades legacy manual rows with an initial lifecycle', () => {
    const legacy: Expense = {
      id: parseEntityId<ExpenseId>('40000000-0000-4000-8000-000000000002'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      kind: 'MANUAL',
      description: 'Legacy',
      amountMinor: moneyMinor(1000),
      paidFrom: 'CASH',
      note: null,
      orderId: null,
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-18T09:00:00.000Z'),
    };
    const upgraded = toExpenseLedgerRecord(legacy);
    expect(upgraded.kind).toBe('MANUAL');
    if (upgraded.kind === 'MANUAL') expect(upgraded.lifecycle.revision).toBe(0);
  });

  it('totals only active financial expenses and separates drawer Cash impact', () => {
    const cash = manual('40000000-0000-4000-8000-000000000003', 15_000, 'CASH');
    const other = manual('40000000-0000-4000-8000-000000000004', 20_000, 'OTHER');
    const deleted = deleteManualExpense(
      manual('40000000-0000-4000-8000-000000000005', 99_000, 'CASH'),
      instant('2026-08-18T12:00:00.000Z'),
      WORKER_ID,
    );
    const deliveryFailed: ExpenseLedgerRecord = {
      id: parseEntityId<ExpenseId>('40000000-0000-4000-8000-000000000006'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      kind: 'DELIVERY_FAILED',
      description: 'Delivery Failed — Order #12',
      amountMinor: null,
      paidFrom: null,
      note: 'Customer unavailable',
      orderId: parseEntityId<OrderId>('50000000-0000-4000-8000-000000000001'),
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-18T12:30:00.000Z'),
    };

    expect(calculateExpenseTotals([cash, other, deleted, deliveryFailed])).toEqual({
      totalExpensesMinor: moneyMinor(35_000),
      cashExpensesMinor: moneyMinor(15_000),
    });
  });

  it('locks Delivery Failed and rejects zero-value manual expenses', () => {
    const deliveryFailed: ExpenseLedgerRecord = {
      id: parseEntityId<ExpenseId>('40000000-0000-4000-8000-000000000007'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      kind: 'DELIVERY_FAILED',
      description: 'Delivery Failed',
      amountMinor: null,
      paidFrom: null,
      note: null,
      orderId: parseEntityId<OrderId>('50000000-0000-4000-8000-000000000002'),
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-18T12:30:00.000Z'),
    };
    expect(() =>
      deleteManualExpense(deliveryFailed, instant('2026-08-18T13:00:00.000Z'), WORKER_ID),
    ).toThrow(/locked/);
    expect(() =>
      createManualExpense(
        {
          id: parseEntityId<ExpenseId>('40000000-0000-4000-8000-000000000008'),
          shopId: SHOP_ID,
          businessDayId: DAY_ID,
          createdByWorkerId: WORKER_ID,
          createdAt: instant('2026-08-18T13:00:00.000Z'),
        },
        { description: 'Zero', amountMinor: moneyMinor(0), paidFrom: 'CASH', note: null },
      ),
    ).toThrow(/greater than zero/);
  });
});
