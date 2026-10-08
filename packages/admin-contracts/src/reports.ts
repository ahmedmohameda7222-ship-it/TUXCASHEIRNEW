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
