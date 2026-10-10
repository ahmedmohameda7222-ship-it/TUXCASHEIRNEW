import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';

// Explicit allowlist: new stored summary keys cannot leak merely because a
// principal has finance.view. Sales uses Reports authorization; operational
// orders, Inventory, and Approvals each retain their own domain permissions.
const OWNER_SUMMARY_FIELDS: Readonly<Record<string, AdminPermission>> = {
  reportKind: 'finance.view',
  businessDayId: 'finance.view',
  shopId: 'finance.view',
  generatedFromSnapshotId: 'finance.view',
  snapshotFinalizedAt: 'finance.view',
  netSalesMinor: 'reports.view',
  orderCount: 'orders.view',
  estimatedOperatingProfitMinor: 'finance.view',
  cashSalesNetMinor: 'finance.view',
  cashVarianceMinor: 'finance.view',
  cashVarianceCount: 'finance.view',
  lowStockCount: 'inventory.view',
  wasteCostMinor: 'inventory.view',
  majorPostedRefundCount: 'orders.view',
  failedOnlineOrderCount: 'orders.view',
  pendingApprovalCount: 'approvals.review',
};
const SUMMARY_STRING_FIELDS = new Set([
  'reportKind',
  'businessDayId',
  'shopId',
  'generatedFromSnapshotId',
  'snapshotFinalizedAt',
]);

/**
 * Filter immutable, server-generated Owner Summary JSON before HTTP serialization.
 * No unknown keys, nested objects, or raw sections metadata reach the browser.
 * Shop/business isolation is enforced by the enclosing trusted BFF route.
 */
export function maskOwnerSummaryForPrincipal(
  principal: AdminSessionPrincipal,
  stored: unknown,
): Readonly<Record<string, unknown>> {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const summary = stored as Readonly<Record<string, unknown>>;
  const grants = new Set(principal.permissions);
  const result: Record<string, unknown> = {};
  for (const [field, permission] of Object.entries(OWNER_SUMMARY_FIELDS)) {
    if (!grants.has(permission)) continue;
    const value = summary[field];
    if (SUMMARY_STRING_FIELDS.has(field)) {
      if (typeof value === 'string') result[field] = value;
    } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
      result[field] = value;
    }
  }
  return result;
}
