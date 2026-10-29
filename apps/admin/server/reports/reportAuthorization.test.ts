import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { AdminAuthorizationError } from '../authorization.js';
import {
  canReadReportFilterOption,
  filterAuthorizedReportTargets,
  filterAuthorizedReportSavedViews,
  requireReportArea,
  requireReportContextPermissions,
} from './reportAuthorization.js';

const shopId = 'shop-test';
const staff: AdminSessionPrincipal = {
  businessId: 'business-test',
  employeeId: 'staff-test',
  role: 'STAFF',
  permissions: ['reports.view'],
  shopIds: [shopId],
};

describe('Plan 7 report domain permissions', () => {
  it('keeps authorized sales targets but strips finance and inventory targets for STAFF', () => {
    const targets = [
      { metric: 'NET_SALES', targetValue: 500 },
      { metric: 'FOOD_COST_PERCENT', targetValue: 2700 },
      { metric: 'WASTE', targetValue: 15 },
    ];
    expect(filterAuthorizedReportTargets(staff, targets)).toEqual([targets[0]]);
    expect(
      filterAuthorizedReportTargets(
        { ...staff, role: 'MANAGER', permissions: ['reports.view', 'inventory.view'] },
        targets,
      ),
    ).toEqual([targets[0], targets[2]]);
    expect(filterAuthorizedReportTargets(staff, [{ metric: 'UNKNOWN' }])).toEqual([]);
  });

  it('cannot use reports.view to read protected financial areas', () => {
    expect(() => requireReportArea(staff, 'sales', shopId)).not.toThrow();
    for (const area of ['profit', 'payments', 'bank-cash', 'expenses', 'end-day'] as const) {
      expect(() => requireReportArea(staff, area, shopId)).toThrow(AdminAuthorizationError);
    }
    expect(canReadReportFilterOption(staff, 'paymentMethods')).toBe(false);
    expect(canReadReportFilterOption(staff, 'customers')).toBe(false);
  });

  it('enforces staff, inventory, purchasing, delivery and customer boundaries', () => {
    for (const area of [
      'staff',
      'attendance',
      'inventory-consumption',
      'purchasing',
      'delivery',
      'customers',
      'loyalty',
      'promotions',
    ] as const) {
      expect(() => requireReportArea(staff, area, shopId)).toThrow(AdminAuthorizationError);
    }
    expect(canReadReportFilterOption(staff, 'workers')).toBe(false);
    expect(canReadReportFilterOption(staff, 'suppliers')).toBe(false);
    expect(canReadReportFilterOption(staff, 'deliveryZones')).toBe(false);
  });

  it('does not let a sales report use another domain filter as a side channel', () => {
    expect(() => requireReportContextPermissions(staff, {}, shopId)).not.toThrow();
    for (const context of [
      { workerId: 'worker' },
      { customerId: 'customer' },
      { supplierId: 'supplier' },
      { deliveryZoneId: 'zone' },
      { paymentMethodId: 'method' },
    ]) {
      expect(() => requireReportContextPermissions(staff, context, shopId)).toThrow(
        AdminAuthorizationError,
      );
    }
  });

  it('preserves independent manager finance.view permission overrides', () => {
    const manager: AdminSessionPrincipal = {
      ...staff,
      role: 'MANAGER',
      permissions: ['reports.view', 'staff.view', 'delivery.view'],
    };
    expect(() => requireReportArea(manager, 'attendance', shopId)).not.toThrow();
    expect(() => requireReportArea(manager, 'delivery', shopId)).not.toThrow();
    expect(() => requireReportArea(manager, 'profit', shopId)).toThrow(AdminAuthorizationError);
    expect(() => requireReportArea(manager, 'inventory-consumption', shopId)).toThrow(
      AdminAuthorizationError,
    );
  });

  it('validates tenant shop scope even with all relevant report grants', () => {
    const finance: AdminSessionPrincipal = {
      ...staff,
      permissions: ['reports.view', 'finance.view'],
    };
    expect(() => requireReportArea(finance, 'profit', 'other-shop')).toThrow(
      AdminAuthorizationError,
    );
  });

  it('rejects restricted customer and employee filters nested in a saved view payload', () => {
    expect(() =>
      requireReportContextPermissions(
        staff,
        { context: { customerId: 'secret-customer' } },
        shopId,
      ),
    ).toThrow(AdminAuthorizationError);
    expect(() =>
      requireReportContextPermissions(
        staff,
        { context: { employeeId: 'secret-employee' } },
        shopId,
      ),
    ).toThrow(AdminAuthorizationError);
  });

  it('does not expose saved views with inaccessible report domains or filter scopes', () => {
    const safe = {
      id: 'safe',
      shopId,
      reportArea: 'sales',
      filters: { shopIds: [shopId], context: {} },
    };
    const views = [
      safe,
      { ...safe, id: 'customer', filters: { context: { customerId: 'private' } } },
      { ...safe, id: 'finance', reportArea: 'profit' },
      { ...safe, id: 'foreign', shopId: 'other-shop' },
      { ...safe, id: 'foreign-filter', filters: { shopIds: ['other-shop'] } },
    ];
    expect(filterAuthorizedReportSavedViews(staff, views, shopId)).toEqual([safe]);
  });
});
