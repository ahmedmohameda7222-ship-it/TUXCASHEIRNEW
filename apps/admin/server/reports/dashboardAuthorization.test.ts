import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { maskDashboardMetrics } from './dashboardAuthorization.js';

const response = {
  ok: true,
  periodStart: '2026-10-09',
  periodEnd: '2026-10-09',
  netSalesMinor: 2500,
  estimatedOperatingProfitMinor: 1500,
  financeAccountBalances: [{ accountId: 'secret-account', amountMinor: 90000 }],
  orderCount: 2,
  averageOrderMinor: 1250,
  cashVarianceMinor: 250,
  staffOnShiftCount: 3,
  deliveryOpenCount: 1,
  lowStockCount: 5,
  outOfStockCount: 1,
  pendingApprovalCount: 4,
  topProducts: [{ name: 'Latte', quantity: 2 }],
  salesTrend: [],
  sourceMix: [],
  shopComparison: [],
  failedOnlineOrderCount: 0,
};

const principal: AdminSessionPrincipal = {
  employeeId: 'person',
  businessId: 'business',
  shopIds: ['shop'],
  role: 'STAFF',
  permissions: ['reports.view'],
};

describe('Dashboard HTTP response authorization', () => {
  it('does not include finance, inventory, staff, delivery or approvals facts with only reports.view', () => {
    const sanitized = maskDashboardMetrics(principal, response);
    expect(sanitized['netSalesMinor']).toBe(2500);
    for (const key of [
      'estimatedOperatingProfitMinor',
      'lowStockCount',
      'outOfStockCount',
      'staffOnShiftCount',
      'deliveryOpenCount',
      'pendingApprovalCount',
    ]) {
      expect(sanitized[key]).toBeNull();
    }
    expect(sanitized['topProducts']).toEqual([]);
    expect(JSON.stringify(sanitized)).not.toContain('financeAccountBalances');
    expect(JSON.stringify(sanitized)).not.toContain('cashVarianceMinor');
    expect(JSON.stringify(sanitized)).not.toContain('secret-account');
  });

  it('allows only independently granted manager domains even if finance is denied', () => {
    const manager = {
      ...principal,
      role: 'MANAGER' as const,
      permissions: [
        'reports.view',
        'staff.view',
        'inventory.view',
      ] as AdminSessionPrincipal['permissions'],
    };
    const sanitized = maskDashboardMetrics(manager, response);
    expect(sanitized['staffOnShiftCount']).toBe(3);
    expect(sanitized['lowStockCount']).toBe(5);
    expect(sanitized['estimatedOperatingProfitMinor']).toBeNull();
    expect(sanitized['deliveryOpenCount']).toBeNull();
  });

  it('allows finance profit only with finance.view and never returns unknown RPC fields', () => {
    const withFinance = {
      ...principal,
      permissions: ['reports.view', 'finance.view'] as AdminSessionPrincipal['permissions'],
    };
    const sanitized = maskDashboardMetrics(withFinance, response);
    expect(sanitized['estimatedOperatingProfitMinor']).toBe(1500);
    expect(sanitized).not.toHaveProperty('financeAccountBalances');
    expect(sanitized).not.toHaveProperty('cashVarianceMinor');
  });
});
