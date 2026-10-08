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
