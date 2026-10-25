import type { ReportFilters } from './useReports';

export type SelectedReportScope =
  | { kind: 'shop'; shopId: string }
  | { kind: 'all-shops' };

/**
 * Rebind report query filters synchronously to the authorized shop selector.
 * A scope change clears shop-specific drilldown context and pagination before
 * React effects run, so no previous-shop query can fire during that render.
 */
export function scopeReportFilters(
  filters: ReportFilters,
  scope: SelectedReportScope,
  authorizedShopIds: readonly string[],
  scopeChanged: boolean,
  allowMultiShop = false,
): ReportFilters {
  const authorized = new Set(authorizedShopIds);
  const shopIds =
    scope.kind === 'shop'
      ? !scopeChanged && allowMultiShop
        ? filters.shopIds.filter((id) => authorized.has(id))
        : authorized.has(scope.shopId)
          ? [scope.shopId]
          : []
      : scopeChanged
        ? [...authorized]
        : filters.shopIds.filter((id) => authorized.has(id));

  return {
    ...filters,
    shopIds,
    offset: scopeChanged ? 0 : filters.offset,
    context: scopeChanged ? {} : filters.context,
  };
}
