import type { AdminSessionPrincipal } from '@tux/admin-contracts';

/**
 * Deny by default. Even if a future RPC returns an extra finance/staff field,
 * the Reports BFF must not serialize it into a dashboard HTTP response.
 */
export function maskDashboardMetrics(
  principal: AdminSessionPrincipal,
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const grants = new Set(principal.permissions);
  const can = (permission: string) => grants.has(permission as never);
  return {
    ok: data['ok'],
    periodStart: data['periodStart'],
    periodEnd: data['periodEnd'],
    orderCount: data['orderCount'],
    netSalesMinor: data['netSalesMinor'],
    averageOrderMinor: data['averageOrderMinor'],
    salesTrend: data['salesTrend'],
    sourceMix: data['sourceMix'],
    shopComparison: data['shopComparison'],
    failedOnlineOrderCount: data['failedOnlineOrderCount'],
    estimatedOperatingProfitMinor: can('finance.view') ? data['estimatedOperatingProfitMinor'] : null,
    lowStockCount: can('inventory.view') ? data['lowStockCount'] : null,
    outOfStockCount: can('inventory.view') ? data['outOfStockCount'] : null,
    staffOnShiftCount: can('staff.view') ? data['staffOnShiftCount'] : null,
    deliveryOpenCount: can('delivery.view') ? data['deliveryOpenCount'] : null,
    pendingApprovalCount: can('approvals.review') ? data['pendingApprovalCount'] : null,
    topProducts: can('catalog.view') ? data['topProducts'] : [],
  };
}
