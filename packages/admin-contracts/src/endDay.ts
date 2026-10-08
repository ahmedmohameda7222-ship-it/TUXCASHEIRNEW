export type BusinessDayFinanceStatus = 'OPEN' | 'CLOSED';

export type CashierReconciliation = {
  readonly shopId: string;
  readonly businessDayId: string;
  readonly cashierWorkerId: string;
  readonly expectedCashMinor: number;
  readonly actualCashMinor: number;
  readonly varianceMinor: number;
  readonly varianceReason: string | null;
  readonly reviewerEmployeeId: string;
  readonly postedAt: string;
};

export type FinancialEndDaySnapshot = {
  readonly id: string;
  readonly shopId: string;
  readonly businessDayId: string;
  readonly status: 'FINALIZED';
  readonly finalizedAt: string;
  readonly finalizedByEmployeeId: string;
  readonly netSalesMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly estimatedOperatingProfitMinor: number;
  readonly expectedCashMinor: number;
  readonly actualCashMinor: number | null;
  readonly cashVarianceMinor: number | null;
};

export type FinancialAdjustment = {
  readonly id: string;
  readonly snapshotId: string;
  readonly amountMinor: number;
  readonly reason: string;
  readonly createdAt: string;
};

export type XReport = {
  readonly businessDayStatus: BusinessDayFinanceStatus;
  readonly shopId: string;
  readonly businessDayId: string;
  readonly orderCount: number;
  readonly netSalesMinor: number;
  readonly expensesMinor: number;
  readonly cogsMinor: number;
  readonly estimatedOperatingProfitMinor: number;
  readonly expectedCashMinor: number;
  readonly reconciliationGapCount: number;
};

/** Canonical X and immutable Z snapshot payload as produced by the finance RPC. */
export type FinanceDayReport = {
  readonly ok: true;
  readonly reportKind: 'X' | 'Z';
  readonly shopId: string;
  readonly businessDayId: string;
  readonly businessDayStatus: BusinessDayFinanceStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly orderCount: number;
  readonly grossOrderTotalMinor: number;
  readonly discountMinor: number;
  readonly allocatedPaymentsMinor: number;
  readonly netSalesMinor: number;
  readonly postedRefundsMinor: number;
  readonly cashPaymentsMinor: number;
  readonly cashRefundsMinor: number;
  readonly cashSalesNetMinor: number;
  readonly totalExpensesMinor: number;
  readonly manualExpensesMinor: number;
  readonly staffPaymentsMinor: number;
  readonly bankFeesMinor: number;
  readonly cogsMinor: number | null;
  readonly estimatedOperatingProfitMinor: number | null;
  readonly missingInventoryCostCount: number;
  readonly unattributedPaymentCount: number;
  readonly missingCashierReconciliationCount: number;
  readonly paymentBreakdown: Readonly<Record<string, number>>;
  readonly cashierReconciliations: readonly {
    readonly cashierWorkerId: string;
    readonly expectedMinor: number;
    readonly actualMinor: number;
    readonly varianceMinor: number;
    readonly reason: string | null;
    readonly postedAt: string;
  }[];
  readonly openingFloatMinor: number;
  readonly cashPayInsMinor: number;
  readonly cashPayOutsMinor: number;
  readonly cashExpensesMinor: number;
  readonly bankDepositsMinor: number;
  readonly transfersOutMinor: number;
  readonly transfersInMinor: number;
  readonly closingCashMinor: number | null;
  readonly closingBankMinor: number | null;
  readonly closingWalletMinor: number | null;
  readonly closingPendingSettlementMinor: number | null;
  readonly closingTrackedFundsMinor: number | null;
  readonly financialFinalized: boolean;
};
