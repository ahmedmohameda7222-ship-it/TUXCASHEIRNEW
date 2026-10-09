import type { FinanceAccountType, FinanceSetupState } from '@tux/admin-contracts';

type SourcePayment = {
  readonly paymentId: string;
  readonly allocatedMinor: number;
  readonly receivedMinor: number | null;
  readonly attributedFinanceAccountId: string | null;
  readonly workerId: string;
};

type RefundSource = {
  readonly refundId: string;
  readonly status: 'PENDING' | 'REJECTED' | 'FAILED' | 'CANCELLED' | 'POSTED';
  readonly amountMinor: number;
  readonly originalPaymentAccountId: string | null;
  readonly workerId: string;
};

type SourceMovement = {
  readonly movementType: 'SALE' | 'REFUND';
  readonly financeAccountId: string;
  readonly amountMinor: number;
  readonly sourceKind: 'PAYMENT' | 'REFUND';
  readonly sourceId: string;
  readonly actorWorkerId: string;
};

type LedgerEffect = {
  readonly movementType: 'TRANSFER_IN' | 'TRANSFER_OUT' | 'SETTLEMENT' | 'BANK_FEE';
  readonly financeAccountId: string;
  readonly amountMinor: number;
};

function checkedMinor(value: number, allowNegative = false): number {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new Error('finance_amount_invalid');
  }
  return value;
}

function checkedSum(values: readonly number[]): number {
  const result = values.reduce((sum, amount) => sum + BigInt(checkedMinor(amount, true)), 0n);
  if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('finance_amount_overflow');
  }
  return Number(result);
}

export function materializeSale(payment: SourcePayment): SourceMovement | null {
  const amountMinor = checkedMinor(payment.allocatedMinor);
  if (payment.receivedMinor !== null) checkedMinor(payment.receivedMinor);
  if (amountMinor === 0 || !payment.attributedFinanceAccountId) return null;
  return {
    movementType: 'SALE',
    financeAccountId: payment.attributedFinanceAccountId,
    amountMinor,
    sourceKind: 'PAYMENT',
    sourceId: payment.paymentId,
    actorWorkerId: payment.workerId,
  };
}

export function materializePostedRefund(refund: RefundSource): SourceMovement | null {
  const amountMinor = checkedMinor(refund.amountMinor);
  if (refund.status !== 'POSTED' || !refund.originalPaymentAccountId || amountMinor === 0) {
    return null;
  }
  return {
    movementType: 'REFUND',
    financeAccountId: refund.originalPaymentAccountId,
    amountMinor: -amountMinor,
    sourceKind: 'REFUND',
    sourceId: refund.refundId,
    actorWorkerId: refund.workerId,
  };
}

export function deriveAccountBalances(
  accounts: readonly {
    readonly id: string;
    readonly accountType: FinanceAccountType;
    readonly openingBalanceMinor: number;
  }[],
  movements: readonly { readonly financeAccountId: string; readonly amountMinor: number }[],
): { balances: Record<string, number>; totalTrackedMoneyMinor: number } {
  const byId = new Map(
    accounts.map((account) => [account.id, [checkedMinor(account.openingBalanceMinor, true)]]),
  );
  if (byId.size !== accounts.length) throw new Error('finance_account_duplicate');
  for (const movement of movements) {
    const amounts = byId.get(movement.financeAccountId);
    if (!amounts) throw new Error('finance_movement_unknown_account');
    amounts.push(checkedMinor(movement.amountMinor, true));
  }
  const balances = Object.fromEntries([...byId].map(([id, amounts]) => [id, checkedSum(amounts)]));
  return { balances, totalTrackedMoneyMinor: checkedSum(Object.values(balances)) };
}

export function estimatedOperatingProfit(input: {
  readonly netSalesMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
}): number {
  checkedMinor(input.netSalesMinor, true);
  checkedMinor(input.cogsMinor);
  checkedMinor(input.expensesMinor);
  return checkedSum([input.netSalesMinor, -input.cogsMinor, -input.expensesMinor]);
}

export function transferEffects(
  amountMinor: number,
  fromAccountId: string,
  toAccountId: string,
): LedgerEffect[] {
  if (checkedMinor(amountMinor) === 0 || fromAccountId === toAccountId) {
    throw new Error('finance_transfer_invalid');
  }
  return [
    { movementType: 'TRANSFER_OUT', financeAccountId: fromAccountId, amountMinor: -amountMinor },
    { movementType: 'TRANSFER_IN', financeAccountId: toAccountId, amountMinor },
  ];
}

export function settlementEffects(input: {
  readonly pendingAccountId: string;
  readonly destinationAccountId: string;
  readonly grossMinor: number;
  readonly feeMinor: number;
}): LedgerEffect[] {
  const grossMinor = checkedMinor(input.grossMinor);
  const feeMinor = checkedMinor(input.feeMinor);
  if (
    grossMinor === 0 ||
    feeMinor >= grossMinor ||
    input.pendingAccountId === input.destinationAccountId
  ) {
    throw new Error('finance_settlement_invalid');
  }
  const netMinor = grossMinor - feeMinor;
  const effects: LedgerEffect[] = [
    {
      movementType: 'SETTLEMENT',
      financeAccountId: input.pendingAccountId,
      amountMinor: -netMinor,
    },
  ];
  if (feeMinor > 0) {
    effects.push({
      movementType: 'BANK_FEE',
      financeAccountId: input.pendingAccountId,
      amountMinor: -feeMinor,
    });
  }
  effects.push({
    movementType: 'SETTLEMENT',
    financeAccountId: input.destinationAccountId,
    amountMinor: netMinor,
  });
  return effects;
}

export function staffPaymentExpenseTotal(
  events: readonly { readonly staffPaymentRecordId: string; readonly paidAmountMinor: number }[],
): number {
  const byId = new Map<string, number>();
  for (const event of events) {
    const paidAmountMinor = checkedMinor(event.paidAmountMinor);
    const existing = byId.get(event.staffPaymentRecordId);
    if (existing !== undefined && existing !== paidAmountMinor) {
      throw new Error('finance_staff_payment_conflict');
    }
    byId.set(event.staffPaymentRecordId, paidAmountMinor);
  }
  return checkedSum([...byId.values()]);
}

export function financeSetupState(
  accountCount: number,
  unmappedMethodCount: number,
): FinanceSetupState {
  checkedMinor(accountCount);
  checkedMinor(unmappedMethodCount);
  return accountCount === 0
    ? 'SETUP_REQUIRED'
    : unmappedMethodCount > 0
      ? 'NEEDS_ATTENTION'
      : 'READY';
}

export function canFinalizeFinancialDay(status: 'OPEN' | 'CLOSED'): boolean {
  return status === 'CLOSED';
}
