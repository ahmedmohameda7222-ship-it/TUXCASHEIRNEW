import type { AdminPermission, AdminReportArea, AdminSessionPrincipal } from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';

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
  for (const [key, permission] of Object.entries(CONTEXT_PERMISSIONS)) {
    if (context[key] !== undefined && context[key] !== null && context[key] !== '') {
      requirePermission(principal, permission, shopId);
    }
  }
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
