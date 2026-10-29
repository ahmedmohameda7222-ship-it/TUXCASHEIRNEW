import type { AdminReportArea } from '@tux/admin-contracts';
import type { ReportContext, ReportFilters } from './useReports';

/** A report-area change invalidates area-specific filters and the old page offset. */
export function chooseReportArea(filters: ReportFilters, area: AdminReportArea): ReportFilters {
  if (area === filters.area) return filters;
  return {
    ...filters,
    area,
    source: null,
    context: {},
    offset: 0,
  };
}

const ORDER_CONTEXT_AREAS: readonly AdminReportArea[] = [
  'sales', 'payments', 'products', 'customers', 'delivery', 'tax', 'refunds',
  'shop-comparison', 'loyalty', 'promotions',
];

const ORDER_CONTEXT_FIELDS = [
  'orderTypeId', 'paymentMethodId', 'workerId', 'customerId', 'productId',
  'categoryId', 'promotionId', 'deliveryZoneId', 'status',
];

export function compatibleReportContext(
  area: AdminReportArea,
  context: Readonly<Record<string, unknown>> | undefined,
): ReportContext {
  const allowed =
    area === 'purchasing'
      ? ['supplierId', 'status']
      : area === 'segments'
        ? ['customerId']
        : area === 'staff' || area === 'attendance'
          ? ['workerId', 'employeeId', 'status']
          : ORDER_CONTEXT_AREAS.includes(area)
            ? ORDER_CONTEXT_FIELDS
            : [];
  const keys = new Set(allowed);
  return Object.fromEntries(
    Object.entries(context ?? {}).filter(
      ([key, value]) => keys.has(key) && typeof value === 'string' && value !== '',
    ),
  ) as ReportContext;
}
