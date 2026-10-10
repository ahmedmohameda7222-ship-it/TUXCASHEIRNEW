import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { maskOwnerSummaryForPrincipal } from './ownerSummaryAuthorization.js';

const shopId = '32000000-0000-4000-8000-000000000001';
const stored = {
  reportKind: 'DAILY_OWNER_SUMMARY',
  shopId,
  businessDayId: '36000000-0000-4000-8000-000000000001',
  generatedFromSnapshotId: '40000000-0000-4000-8000-000000000001',
  snapshotFinalizedAt: '2026-10-09T09:00:00Z',
  netSalesMinor: 400000,
  orderCount: 12,
  estimatedOperatingProfitMinor: 110000,
  cashSalesNetMinor: 200000,
  cashVarianceMinor: -1000,
  cashVarianceCount: 1,
  lowStockCount: 4,
  wasteCostMinor: 5000,
  majorPostedRefundCount: 2,
  failedOnlineOrderCount: 3,
  pendingApprovalCount: 6,
  sections: ['Sales', 'Profit', 'Cash', 'Inventory', 'Refunds', 'Operations'],
  secretFutureBusinessMetric: 900000,
  nestedSecrets: { privateForecast: 9000 },
};
const principal = (permissions: AdminSessionPrincipal['permissions']): AdminSessionPrincipal => ({
  employeeId: 'person',
  businessId: 'business',
  shopIds: [shopId],
  role: 'STAFF',
  permissions,
});

describe('Owner Summary trusted BFF domain filtering', () => {
  it('exposes only finance fields to a finance-only principal', () => {
    const result = maskOwnerSummaryForPrincipal(principal(['finance.view']), stored);
    expect(result['estimatedOperatingProfitMinor']).toBe(110000);
    expect(result['cashSalesNetMinor']).toBe(200000);
    expect(result['cashVarianceCount']).toBe(1);
    for (const denied of [
      'netSalesMinor',
      'orderCount',
      'lowStockCount',
      'wasteCostMinor',
      'pendingApprovalCount',
      'majorPostedRefundCount',
      'failedOnlineOrderCount',
      'sections',
      'secretFutureBusinessMetric',
      'nestedSecrets',
    ]) {
      expect(result).not.toHaveProperty(denied);
    }
    expect(stored.lowStockCount).toBe(4);
  });

  it('allows inventory but still denies approvals and orders', () => {
    const result = maskOwnerSummaryForPrincipal(
      principal(['finance.view', 'inventory.view']),
      stored,
    );
    expect(result['lowStockCount']).toBe(4);
    expect(result['wasteCostMinor']).toBe(5000);
    expect(result).not.toHaveProperty('pendingApprovalCount');
    expect(result).not.toHaveProperty('majorPostedRefundCount');
  });

  it('allows order exceptions but not inventory without its own grant', () => {
    const result = maskOwnerSummaryForPrincipal(
      principal(['finance.view', 'orders.view']),
      stored,
    );
    expect(result['orderCount']).toBe(12);
    expect(result['majorPostedRefundCount']).toBe(2);
    expect(result['failedOnlineOrderCount']).toBe(3);
    expect(result).not.toHaveProperty('lowStockCount');
    expect(result).not.toHaveProperty('netSalesMinor');
  });

  it('aligns sales with reports.view and returns the full authorized known fields', () => {
    const result = maskOwnerSummaryForPrincipal(
      principal(['finance.view', 'orders.view', 'reports.view', 'inventory.view', 'approvals.review']),
      stored,
    );
    for (const key of [
      'netSalesMinor', 'orderCount', 'estimatedOperatingProfitMinor',
      'cashSalesNetMinor', 'lowStockCount', 'wasteCostMinor',
      'majorPostedRefundCount', 'failedOnlineOrderCount', 'pendingApprovalCount',
    ]) {
      expect(result[key]).toBe(stored[key as keyof typeof stored]);
    }
    expect(result).not.toHaveProperty('secretFutureBusinessMetric');
    expect(result).not.toHaveProperty('nestedSecrets');
    expect(result).not.toHaveProperty('sections');
  });

  it('never trusts caller-supplied fields, even when the summary is not an object', () => {
    expect(maskOwnerSummaryForPrincipal(principal(['finance.view']), null)).toEqual({});
    expect(maskOwnerSummaryForPrincipal(principal(['finance.view']), ['leak'])).toEqual({});
  });
});
