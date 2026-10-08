export const FINANCE_ACCOUNT_TYPES = ['CASH', 'BANK', 'WALLET', 'PENDING_SETTLEMENT'] as const;
export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];
export type FinanceSetupState = 'SETUP_REQUIRED' | 'READY' | 'NEEDS_ATTENTION';

export type FinanceAccountBalance = {
  readonly id: string;
  readonly name: string;
  readonly accountType: FinanceAccountType;
  readonly shopId: string | null;
  readonly active: boolean;
  readonly openingBalanceMinor: number;
  readonly balanceMinor: number;
  readonly version: number;
};

export type MoneyPosition = {
  readonly totalTrackedMoneyMinor: number;
  readonly cashMinor: number;
  readonly bankMinor: number;
  readonly walletMinor: number;
  readonly pendingSettlementMinor: number;
};

export type ProfitSummary = {
  readonly netSalesMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly estimatedOperatingProfitMinor: number;
};

export type FinanceMovement = {
  readonly id: string;
  readonly accountId: string;
  readonly movementType: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
  readonly displayDescription: string;
};

export type PaymentSettlement = {
  readonly id: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly grossMinor: number;
  readonly feeMinor: number;
  readonly netMinor: number;
  readonly settledOn: string;
  readonly reference: string | null;
};

export type FinancePaymentMethod = {
  readonly id: string;
  readonly displayName: string;
  readonly logicType: string;
  readonly financeAccountId: string | null;
  readonly mappingVersion: number;
};

export type FinanceAccountActivity = {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: number;
  readonly occurredAt: string;
};

export type FinanceWorkspace = {
  readonly setupState: FinanceSetupState;
  readonly accounts: readonly FinanceAccountBalance[];
  readonly paymentMethods: readonly FinancePaymentMethod[];
  readonly moneyPosition: MoneyPosition | null;
  readonly profitSummary: ProfitSummary | null;
  readonly unmappedPaymentMethodCount: number;
};
