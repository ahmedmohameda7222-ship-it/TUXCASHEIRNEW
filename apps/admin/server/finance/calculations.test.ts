import { describe, expect, it } from 'vitest';
import {
  deriveAccountBalances,
  estimatedOperatingProfit,
  materializeSale,
  materializePostedRefund,
  settlementEffects,
  transferEffects,
  staffPaymentExpenseTotal,
  financeSetupState,
  canFinalizeFinancialDay,
} from './calculations';

describe('Plan 7 finance accounting invariants', () => {
  it('posts allocated cash only, excluding tendered change, and handles split payment', () => {
    expect(
      materializeSale({
        paymentId: 'cash-1',
        allocatedMinor: 10000,
        receivedMinor: 20000,
        attributedFinanceAccountId: 'till-1',
        workerId: 'cashier-1',
      }),
    ).toMatchObject({ amountMinor: 10000, sourceId: 'cash-1', actorWorkerId: 'cashier-1' });
    const split = [6000, 4000].map((allocatedMinor, i) =>
      materializeSale({
        paymentId: `split-${i}`,
        allocatedMinor,
        receivedMinor: allocatedMinor,
        attributedFinanceAccountId: 'till-1',
        workerId: 'cashier-1',
      }),
    );
    expect(split.reduce((sum, x) => sum + (x?.amountMinor ?? 0), 0)).toBe(10000);
  });

  it('does not infer a historical attribution from current payment mappings', () => {
    expect(
      materializeSale({
        paymentId: 'old',
        allocatedMinor: 10000,
        receivedMinor: 10000,
        attributedFinanceAccountId: null,
        workerId: 'cashier-1',
      }),
    ).toBeNull();
  });

  it('ignores every refund state except POSTED and requires original attribution', () => {
    for (const status of ['PENDING', 'REJECTED', 'FAILED', 'CANCELLED'] as const) {
      expect(
        materializePostedRefund({
          refundId: 'r1',
          status,
          amountMinor: 350,
          originalPaymentAccountId: 'till-1',
          workerId: 'cashier-1',
        }),
      ).toBeNull();
    }
    expect(
      materializePostedRefund({
        refundId: 'r1',
        status: 'POSTED',
        amountMinor: 350,
        originalPaymentAccountId: 'till-1',
        workerId: 'cashier-1',
      }),
    ).toMatchObject({ amountMinor: -350, movementType: 'REFUND', sourceId: 'r1' });
    expect(
      materializePostedRefund({
        refundId: 'r2',
        status: 'POSTED',
        amountMinor: 350,
        originalPaymentAccountId: null,
        workerId: 'cashier-1',
      }),
    ).toBeNull();
  });

  it('separates opening-plus-ledger money from estimated operating profit', () => {
    const position = deriveAccountBalances(
      [
        { id: 'cash', accountType: 'CASH', openingBalanceMinor: 20000 },
        { id: 'bank', accountType: 'BANK', openingBalanceMinor: 100000 },
      ],
      [
        { financeAccountId: 'cash', amountMinor: 7000 },
        { financeAccountId: 'cash', amountMinor: -2000 },
        { financeAccountId: 'bank', amountMinor: 2000 },
      ],
    );
    expect(position.totalTrackedMoneyMinor).toBe(127000);
    expect(position.balances).toEqual({ cash: 25000, bank: 102000 });
    expect(
      estimatedOperatingProfit({ netSalesMinor: 15000, cogsMinor: 6000, expensesMinor: 2000 }),
    ).toBe(7000);
  });

  it('moves money without creating revenue or net tracked-money', () => {
    const effects = transferEffects(18000, 'cash', 'bank');
    expect(effects).toEqual([
      { movementType: 'TRANSFER_OUT', financeAccountId: 'cash', amountMinor: -18000 },
      { movementType: 'TRANSFER_IN', financeAccountId: 'bank', amountMinor: 18000 },
    ]);
    expect(effects.reduce((sum, m) => sum + m.amountMinor, 0)).toBe(0);
  });

  it('settles gross exactly once and charges only one fee', () => {
    expect(
      settlementEffects({
        pendingAccountId: 'pending',
        destinationAccountId: 'bank',
        grossMinor: 100000,
        feeMinor: 2500,
      }),
    ).toEqual([
      { movementType: 'SETTLEMENT', financeAccountId: 'pending', amountMinor: -97500 },
      { movementType: 'BANK_FEE', financeAccountId: 'pending', amountMinor: -2500 },
      { movementType: 'SETTLEMENT', financeAccountId: 'bank', amountMinor: 97500 },
    ]);
    expect(
      settlementEffects({
        pendingAccountId: 'pending',
        destinationAccountId: 'bank',
        grossMinor: 100000,
        feeMinor: 0,
      }),
    ).toHaveLength(2);
  });

  it('counts staff payment expense fact once even if a duplicate appears in a projection', () => {
    expect(
      staffPaymentExpenseTotal([
        { staffPaymentRecordId: 'sp1', paidAmountMinor: 10000 },
        { staffPaymentRecordId: 'sp1', paidAmountMinor: 10000 },
        { staffPaymentRecordId: 'sp2', paidAmountMinor: 5000 },
      ]),
    ).toBe(15000);
  });

  it('handles zero-account setup and unmapped payment methods without fabricated accounts', () => {
    expect(financeSetupState(0, 0)).toBe('SETUP_REQUIRED');
    expect(financeSetupState(1, 2)).toBe('NEEDS_ATTENTION');
    expect(financeSetupState(2, 0)).toBe('READY');
  });

  it('allows X while OPEN but never Admin Z/finalization before Operations CLOSED', () => {
    expect(canFinalizeFinancialDay('OPEN')).toBe(false);
    expect(canFinalizeFinancialDay('CLOSED')).toBe(true);
  });
});
