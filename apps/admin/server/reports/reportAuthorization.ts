import type { AdminPermission, AdminReportArea, AdminSessionPrincipal } from '@tux/admin-contracts';

import { AdminAuthorizationError, requirePermission } from '../authorization.js';

// An additional domain grant is required even when reports.view is allowed.
// Custom role overrides are respected: neither role names nor UI visibility grant access.
export const REPORT_AREA_PERMISSION: Readonly<Record<AdminReportArea, AdminPermission>> = {
  sales: 'reports.view',
  profit: 'finance.view',
  products: 'catalog.view',
  'inventory-consumption': 'inventory.view',
  waste: 'inventory.view',
  'theoretical-variance': 'inventory.view',
  'margin-variance': 'finance.view',
  purchasing: 'purchasing.view',
  customers: 'customers.view',
  payments: 'finance.view',
  expenses: 'finance.view',
  staff: 'staff.view',
  delivery: 'delivery.view',
  refunds: 'finance.view',
  tax: 'finance.view',
  'end-day': 'finance.view',
  'bank-cash': 'finance.view',
  'shop-comparison': 'reports.view',
  loyalty: 'loyalty.manage',
  promotions: 'promotions.manage',
  segments: 'customers.view',
  attendance: 'staff.view',
};

const FILTER_OPTION_PERMISSIONS: Readonly<Record<string, AdminPermission>> = {
  orderTypes: 'reports.view',
  paymentMethods: 'finance.view',
  workers: 'staff.view',
  employees: 'staff.view',
  customers: 'customers.view',
  products: 'catalog.view',
  categories: 'catalog.view',
  promotions: 'promotions.manage',
  suppliers: 'purchasing.view',
  deliveryZones: 'delivery.view',
};

const CONTEXT_PERMISSIONS: Readonly<Record<string, AdminPermission>> = {
  paymentMethodId: 'finance.view',
  workerId: 'staff.view',
  employeeId: 'staff.view',
  customerId: 'customers.view',
  productId: 'catalog.view',
  categoryId: 'catalog.view',
  promotionId: 'promotions.manage',
  supplierId: 'purchasing.view',
  deliveryZoneId: 'delivery.view',
};

export function requireReportArea(
  principal: AdminSessionPrincipal,
  reportArea: AdminReportArea,
  shopId: string,
): void {
  requirePermission(principal, 'reports.view', shopId);
  requirePermission(principal, REPORT_AREA_PERMISSION[reportArea], shopId);
}

export function canReadReportFilterOption(
  principal: AdminSessionPrincipal,
  optionKey: string,
): boolean {
  const required = FILTER_OPTION_PERMISSIONS[optionKey];
  return Boolean(required && principal.permissions.includes(required));
}

export function requireReportContextPermissions(
  principal: AdminSessionPrincipal,
  context: Readonly<Record<string, unknown>>,
  shopId: string,
): void {
  // Saved report views put protected context IDs under filters.context.
  // Never authorize only the outer filters object.
  const nested = context['context'];
  if (
    nested !== undefined &&
    (nested === null || typeof nested !== 'object' || Array.isArray(nested))
  ) {
    throw new AdminAuthorizationError('permission_forbidden');
  }
  const candidates: Readonly<Record<string, unknown>>[] = [context];
  if (nested) candidates.push(nested as Readonly<Record<string, unknown>>);
  for (const candidate of candidates) {
    for (const [key, permission] of Object.entries(CONTEXT_PERMISSIONS)) {
      if (candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== '') {
        requirePermission(principal, permission, shopId);
      }
    }
  }
}

/** Hide saved views with stale grants, restricted filter contexts or foreign-shop scopes. */
export function filterAuthorizedReportSavedViews(
  principal: AdminSessionPrincipal,
  savedViews: unknown,
  shopId: string,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(savedViews)) return [];
  return savedViews.filter((view): view is Record<string, unknown> => {
    if (!view || typeof view !== 'object' || Array.isArray(view)) return false;
    const row = view as Record<string, unknown>;
    const area = row['reportArea'];
    const viewShop = row['shopId'];
    const filters = row['filters'];
    if (
      typeof area !== 'string' ||
      !(area in REPORT_AREA_PERMISSION) ||
      (viewShop != null && viewShop !== shopId) ||
      !filters ||
      typeof filters !== 'object' ||
      Array.isArray(filters)
    ) {
      return false;
    }
    const filterData = filters as Record<string, unknown>;
    const selected = filterData['shopIds'];
    if (
      selected !== undefined &&
      (!Array.isArray(selected) ||
        selected.length === 0 ||
        selected.some((id) => typeof id !== 'string'))
    ) {
      return false;
    }
    try {
      const reportArea = area as AdminReportArea;
      requireReportArea(principal, reportArea, shopId);
      for (const id of (selected as string[] | undefined) ?? []) {
        requireReportArea(principal, reportArea, id);
        requireReportContextPermissions(principal, filterData, id);
      }
      requireReportContextPermissions(principal, filterData, shopId);
      return true;
    } catch (error) {
      if (error instanceof AdminAuthorizationError) return false;
      throw error;
    }
  });
}

/** BFF defense in depth for read models already filtered by the trusted RPC. */
export function filterAuthorizedReportTargets(
  principal: AdminSessionPrincipal,
  targets: unknown,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(targets)) return [];
  const requiredByMetric: Readonly<Record<string, AdminPermission>> = {
    NET_SALES: 'reports.view',
    ORDER_COUNT: 'reports.view',
    FOOD_COST_PERCENT: 'finance.view',
    WASTE: 'inventory.view',
  };
  return targets.filter((target): target is Record<string, unknown> => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
    const metric = (target as Record<string, unknown>)['metric'];
    const required = typeof metric === 'string' ? requiredByMetric[metric] : undefined;
    return Boolean(required && principal.permissions.includes(required));
  });
}
