export const ADMIN_REPORT_AREAS = [
  'sales',
  'profit',
  'products',
  'inventory-consumption',
  'waste',
  'theoretical-variance',
  'margin-variance',
  'purchasing',
  'customers',
  'payments',
  'expenses',
  'staff',
  'delivery',
  'refunds',
  'tax',
  'end-day',
  'bank-cash',
  'shop-comparison',
  'loyalty',
  'promotions',
  'segments',
  'attendance',
] as const;
export type AdminReportArea = (typeof ADMIN_REPORT_AREAS)[number];

export type ReportDateRange = {
  readonly startDate: string;
  readonly endDate: string;
};

export type ReportRequest = {
  readonly area: AdminReportArea;
  readonly shopIds: readonly string[];
  readonly dateRange: ReportDateRange;
  readonly pageSize: number;
  readonly cursor: string | null;
};

export type SavedReportView = {
  readonly id: string;
  readonly name: string;
  readonly reportArea: AdminReportArea;
  readonly ownerEmployeeId: string;
  readonly shopId: string | null;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly layout: Readonly<Record<string, unknown>>;
};

export type ReportTarget = {
  readonly id: string;
  readonly shopId: string;
  readonly metric: 'NET_SALES' | 'ORDER_COUNT' | 'FOOD_COST_PERCENT' | 'WASTE';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly targetValue: number;
};

/** Canonical record target supplied by the trusted reporting server, not inferred in React. */
export type ReportDrilldown =
  | { readonly type: 'ORDER'; readonly orderId: string }
  | { readonly type: 'PURCHASE_ORDER'; readonly purchaseOrderId: string }
  | { readonly type: 'CUSTOMER'; readonly customerId: string }
  | { readonly type: 'STAFF'; readonly employeeId: string; readonly section?: 'attendance' | 'pay' }
  | { readonly type: 'INVENTORY_ITEM'; readonly inventoryItemId: string }
  | { readonly type: 'FINANCE_ACCOUNT'; readonly accountId: string; readonly movementId?: string }
  | { readonly type: 'FINANCIAL_DAY'; readonly businessDayId: string }
  | { readonly type: 'EXPENSE'; readonly expenseId: string };
