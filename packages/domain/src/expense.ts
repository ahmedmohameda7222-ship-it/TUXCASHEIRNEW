import { DomainInvariantError } from './errors';
import type { BusinessDayId, ExpenseId, ShopId, WorkerId } from './ids';
import type { Expense, ExpensePaidFrom } from './models';
import { addMoney, ZERO_MONEY, type MoneyMinor } from './money';
import type { Instant } from './time';

export interface ManualExpenseLifecycleSnapshot {
  readonly revision: number;
  readonly updatedAt: Instant | null;
  readonly updatedByWorkerId: WorkerId | null;
  readonly deletedAt: Instant | null;
  readonly deletedByWorkerId: WorkerId | null;
}

export type ManualExpenseRecord = Extract<Expense, { kind: 'MANUAL' }> & {
  readonly lifecycle: ManualExpenseLifecycleSnapshot;
};

export type DeliveryFailedExpenseRecord = Extract<Expense, { kind: 'DELIVERY_FAILED' }>;
export type ExpenseLedgerRecord = ManualExpenseRecord | DeliveryFailedExpenseRecord;

export interface ManualExpenseValues {
  readonly description: string;
  readonly amountMinor: MoneyMinor;
  readonly paidFrom: ExpensePaidFrom;
  readonly note: string | null;
}

export interface ExpenseTotals {
  readonly totalExpensesMinor: MoneyMinor;
  readonly cashExpensesMinor: MoneyMinor;
}

const INITIAL_LIFECYCLE: ManualExpenseLifecycleSnapshot = {
  revision: 0,
  updatedAt: null,
  updatedByWorkerId: null,
  deletedAt: null,
  deletedByWorkerId: null,
};

export function toExpenseLedgerRecord(expense: Expense | ExpenseLedgerRecord): ExpenseLedgerRecord {
  if (expense.kind === 'DELIVERY_FAILED') return expense;
  const lifecycle = (
    expense as Extract<Expense, { kind: 'MANUAL' }> & {
      readonly lifecycle?: ManualExpenseLifecycleSnapshot;
    }
  ).lifecycle;
  return { ...expense, lifecycle: lifecycle ?? INITIAL_LIFECYCLE };
}

export function isExpenseDeleted(expense: ExpenseLedgerRecord): boolean {
  return expense.kind === 'MANUAL' && expense.lifecycle.deletedAt !== null;
}

function nextRevision(expense: ManualExpenseRecord): number {
  const next = expense.lifecycle.revision + 1;
  if (!Number.isSafeInteger(next) || next <= 0) {
    throw new DomainInvariantError('Expense revision overflowed its safe range.');
  }
  return next;
}

export function normalizeManualExpenseValues(values: ManualExpenseValues): ManualExpenseValues {
  const description = values.description.trim();
  if (description.length === 0) {
    throw new DomainInvariantError('Expense description is required.');
  }
  if (description.length > 160) {
    throw new DomainInvariantError('Expense description cannot exceed 160 characters.');
  }
  if (values.amountMinor <= ZERO_MONEY) {
    throw new DomainInvariantError('Expense amount must be greater than zero.');
  }
  if (values.paidFrom !== 'CASH' && values.paidFrom !== 'OTHER') {
    throw new DomainInvariantError('Expense Paid From must be Cash or Other.');
  }
  const note = values.note?.trim() ?? '';
  if (note.length > 500) {
    throw new DomainInvariantError('Expense note cannot exceed 500 characters.');
  }
  return {
    description,
    amountMinor: values.amountMinor,
    paidFrom: values.paidFrom,
    note: note.length === 0 ? null : note,
  };
}

export function createManualExpense(
  identity: {
    readonly id: ExpenseId;
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly createdByWorkerId: WorkerId;
    readonly createdAt: Instant;
  },
  values: ManualExpenseValues,
): ManualExpenseRecord {
  return {
    ...identity,
    kind: 'MANUAL',
    ...normalizeManualExpenseValues(values),
    orderId: null,
    lifecycle: INITIAL_LIFECYCLE,
  };
}

export function editManualExpense(
  expense: ExpenseLedgerRecord,
  values: ManualExpenseValues,
  updatedAt: Instant,
  updatedByWorkerId: WorkerId,
): ManualExpenseRecord {
  if (expense.kind !== 'MANUAL') {
    throw new DomainInvariantError('System Delivery Failed expenses are locked.');
  }
  if (expense.lifecycle.deletedAt !== null) {
    throw new DomainInvariantError('Deleted expenses cannot be edited.');
  }
  return {
    ...expense,
    ...normalizeManualExpenseValues(values),
    lifecycle: {
      ...expense.lifecycle,
      revision: nextRevision(expense),
      updatedAt,
      updatedByWorkerId,
    },
  };
}

export function deleteManualExpense(
  expense: ExpenseLedgerRecord,
  deletedAt: Instant,
  deletedByWorkerId: WorkerId,
): ManualExpenseRecord {
  if (expense.kind !== 'MANUAL') {
    throw new DomainInvariantError('System Delivery Failed expenses are locked.');
  }
  if (expense.lifecycle.deletedAt !== null) {
    throw new DomainInvariantError('Expense is already deleted.');
  }
  return {
    ...expense,
    lifecycle: {
      ...expense.lifecycle,
      revision: nextRevision(expense),
      deletedAt,
      deletedByWorkerId,
    },
  };
}

export function calculateExpenseTotals(expenses: readonly ExpenseLedgerRecord[]): ExpenseTotals {
  let totalExpensesMinor = ZERO_MONEY;
  let cashExpensesMinor = ZERO_MONEY;
  for (const expense of expenses) {
    if (expense.kind !== 'MANUAL' || isExpenseDeleted(expense)) continue;
    totalExpensesMinor = addMoney(totalExpensesMinor, expense.amountMinor);
    if (expense.paidFrom === 'CASH') {
      cashExpensesMinor = addMoney(cashExpensesMinor, expense.amountMinor);
    }
  }
  return { totalExpensesMinor, cashExpensesMinor };
}
