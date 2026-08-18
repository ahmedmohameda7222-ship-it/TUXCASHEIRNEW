import type { OperationsConfigurationSnapshot } from './catalog';
import { DomainInvariantError } from './errors';
import { calculateExpenseTotals, type ExpenseLedgerRecord } from './expense';
import type { PaymentMethodId } from './ids';
import type { OrderSnapshot, PaymentLogicType } from './models';
import {
  addMoney,
  assertNonNegativeMoney,
  subtractMoney,
  ZERO_MONEY,
  type MoneyMinor,
} from './money';

export interface EndDayPaymentExpectation {
  readonly paymentMethodId: PaymentMethodId;
  readonly label: string;
  readonly logicType: PaymentLogicType;
  readonly expectedMinor: MoneyMinor;
}

export interface EndDayFinancialProjection {
  readonly recognizedSalesMinor: MoneyMinor;
  readonly totalExpensesMinor: MoneyMinor;
  readonly cashExpensesMinor: MoneyMinor;
  readonly expectedPayments: readonly EndDayPaymentExpectation[];
}

export interface EndDayActualPayment {
  readonly paymentMethodId: PaymentMethodId;
  readonly actualMinor: MoneyMinor;
}

export interface EndDayReconciliationProjectionLine extends EndDayPaymentExpectation {
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
}

export function endDayReconciliationMethods(
  configuration: OperationsConfigurationSnapshot,
): readonly OperationsConfigurationSnapshot['paymentMethods'][number][] {
  return configuration.paymentMethods
    .filter(
      (method) =>
        method.active &&
        method.requiresReconciliation &&
        (method.logicType === 'CASH' || method.logicType === 'DIGITAL'),
    )
    .sort((left, right) => {
      const leftPriority = left.logicType === 'CASH' ? 0 : 1;
      const rightPriority = right.logicType === 'CASH' ? 0 : 1;
      return leftPriority - rightPriority || left.sortOrder - right.sortOrder;
    });
}

export function calculateEndDayFinancialProjection(input: {
  readonly orders: readonly OrderSnapshot[];
  readonly expenses: readonly ExpenseLedgerRecord[];
  readonly configuration: OperationsConfigurationSnapshot;
}): EndDayFinancialProjection {
  const methods = endDayReconciliationMethods(input.configuration);
  if (methods.length === 0) {
    throw new DomainInvariantError('At least one active reconciliation payment method is required.');
  }
  const expectedByMethod = new Map<PaymentMethodId, MoneyMinor>(
    methods.map((method) => [method.id, ZERO_MONEY]),
  );

  let recognizedSalesMinor = ZERO_MONEY;
  for (const order of input.orders) {
    if (order.status !== 'DONE') continue;
    recognizedSalesMinor = addMoney(recognizedSalesMinor, order.totalMinor);
    for (const payment of order.payments) {
      if (!expectedByMethod.has(payment.method.id)) continue;
      expectedByMethod.set(
        payment.method.id,
        addMoney(expectedByMethod.get(payment.method.id) ?? ZERO_MONEY, payment.allocatedMinor),
      );
    }
  }

  const expenses = calculateExpenseTotals(input.expenses);
  if (expenses.cashExpensesMinor !== ZERO_MONEY) {
    const cashMethods = methods.filter((method) => method.logicType === 'CASH');
    if (cashMethods.length !== 1) {
      throw new DomainInvariantError(
        'Exactly one active Cash reconciliation method is required when Cash expenses exist.',
      );
    }
    const cash = cashMethods[0];
    if (cash === undefined) {
      throw new DomainInvariantError('Cash reconciliation method is unavailable.');
    }
    expectedByMethod.set(
      cash.id,
      subtractMoney(expectedByMethod.get(cash.id) ?? ZERO_MONEY, expenses.cashExpensesMinor),
    );
  }

  return {
    recognizedSalesMinor,
    totalExpensesMinor: expenses.totalExpensesMinor,
    cashExpensesMinor: expenses.cashExpensesMinor,
    expectedPayments: methods.map((method) => ({
      paymentMethodId: method.id,
      label: method.displayName,
      logicType: method.logicType,
      expectedMinor: expectedByMethod.get(method.id) ?? ZERO_MONEY,
    })),
  };
}

export function buildEndDayReconciliationProjection(
  expectations: readonly EndDayPaymentExpectation[],
  actualPayments: readonly EndDayActualPayment[],
): readonly EndDayReconciliationProjectionLine[] {
  if (actualPayments.length !== expectations.length) {
    throw new DomainInvariantError('Every reconciliation payment method requires one actual amount.');
  }
  const actualByMethod = new Map<PaymentMethodId, MoneyMinor>();
  for (const actual of actualPayments) {
    if (actualByMethod.has(actual.paymentMethodId)) {
      throw new DomainInvariantError('A reconciliation payment method cannot be entered twice.');
    }
    assertNonNegativeMoney(actual.actualMinor, 'Actual reconciliation amount');
    actualByMethod.set(actual.paymentMethodId, actual.actualMinor);
  }
  return expectations.map((expectation) => {
    const actualMinor = actualByMethod.get(expectation.paymentMethodId);
    if (actualMinor === undefined) {
      throw new DomainInvariantError('Every reconciliation payment method requires one actual amount.');
    }
    return {
      ...expectation,
      actualMinor,
      differenceMinor: subtractMoney(actualMinor, expectation.expectedMinor),
    };
  });
}

export function normalizeEndDayVarianceReason(
  differenceMinor: MoneyMinor,
  reason: string | null | undefined,
): string | null {
  if (differenceMinor === ZERO_MONEY) return null;
  const normalized = reason?.trim() ?? '';
  if (normalized.length === 0) {
    throw new DomainInvariantError('A variance reason is required for every non-zero difference.');
  }
  if (normalized.length > 500) {
    throw new DomainInvariantError('Variance reason cannot exceed 500 characters.');
  }
  return normalized;
}
