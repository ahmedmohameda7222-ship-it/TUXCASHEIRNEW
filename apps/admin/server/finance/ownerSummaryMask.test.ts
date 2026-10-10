import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { loadAdminSession } from '../adminAuthService.js';
import type { AdminRequest, AdminResponse } from '../http.js';
import { handleAdvancedFinance } from './financeOperationsApi.js';
import { maskOwnerSummaryForPrincipal } from './ownerSummaryMask.js';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../adminAuthService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../adminAuthService.js')>()),
  loadAdminSession: vi.fn(),
}));
vi.mock('../env.js', () => ({ getAdminServerEnv: () => ({}) }));
vi.mock('../session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session.js')>()),
  readAdminSessionToken: () => 'test-token',
}));
vi.mock('../supabaseAdmin.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabaseAdmin.js')>()),
  AdminSupabaseClient: class {
    select = mocks.select;
  },
}));

const shopId = '11000000-0000-4000-8000-000000000001';
const otherShopId = '11000000-0000-4000-8000-000000000002';

const canonicalSummary: Record<string, unknown> = {
  reportKind: 'DAILY_OWNER_SUMMARY',
  businessDayId: 'day-1',
  shopId,
  generatedFromSnapshotId: 'snapshot-1',
  snapshotFinalizedAt: '2026-10-09T10:00:00Z',
  netSalesMinor: 90000,
  estimatedOperatingProfitMinor: 19000,
  cashSalesNetMinor: 50000,
  cashVarianceMinor: -100,
  cashVarianceCount: 1,
  orderCount: 20,
  majorPostedRefundCount: 2,
  failedOnlineOrderCount: 3,
  lowStockCount: 4,
  wasteCostMinor: 500,
  pendingApprovalCount: 6,
  sections: ['Sales', 'Profit', 'Cash', 'Inventory', 'Refunds', 'Operations'],
  newUnknownPrivateField: { secret: 123 },
};

function principal(permissions: AdminSessionPrincipal['permissions']): AdminSessionPrincipal {
  return {
    employeeId: 'employee-1',
    businessId: 'business-1',
    role: 'MANAGER',
    permissions,
    shopIds: [shopId],
  };
}

function capture() {
  let status = 200;
  let body = '';
  const response = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader: () => response,
    end: (value: unknown) => {
      body = String(value);
      return response;
    },
  } as unknown as AdminResponse;
  return { response, status: () => status, body: () => JSON.parse(body) as Record<string, unknown> };
}

async function requestSummary(viewer: AdminSessionPrincipal, requestedShopId = shopId) {
  vi.mocked(loadAdminSession).mockResolvedValue({ principal: viewer } as never);
  const result = capture();
  await handleAdvancedFinance(
    {
      method: 'GET',
      url: `/api/admin/finance?shopId=${requestedShopId}&view=owner-summary`,
      headers: { cookie: 'tux_admin_session=fake' },
    } as unknown as AdminRequest,
    result.response,
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue([
    { id: 'summary-1', business_day_id: 'day-1', summary: canonicalSummary, generated_at: '2026-10-09T10:00:00Z' },
  ]);
});

describe('Owner Summary trusted BFF domain masking', () => {
  it('denies inventory, approvals, orders, sales and unknown fields to finance-only staff', () => {
    const masked = maskOwnerSummaryForPrincipal(canonicalSummary, principal(['finance.view']));
    expect(masked).toMatchObject({ estimatedOperatingProfitMinor: 19000, cashVarianceCount: 1 });
    for (const field of [
      'netSalesMinor', 'orderCount', 'majorPostedRefundCount', 'failedOnlineOrderCount',
      'lowStockCount', 'wasteCostMinor', 'pendingApprovalCount', 'sections', 'newUnknownPrivateField',
    ]) {
      expect(masked).not.toHaveProperty(field);
    }
  });

  it('shows inventory only with inventory.view and excludes approvals', () => {
    const masked = maskOwnerSummaryForPrincipal(canonicalSummary, principal(['finance.view', 'inventory.view']));
    expect(masked).toHaveProperty('lowStockCount', 4);
    expect(masked).toHaveProperty('wasteCostMinor', 500);
    expect(masked).not.toHaveProperty('pendingApprovalCount');
    expect(masked).not.toHaveProperty('orderCount');
  });

  it('shows operational orders only with orders.view', () => {
    const masked = maskOwnerSummaryForPrincipal(canonicalSummary, principal(['finance.view', 'orders.view']));
    expect(masked).toHaveProperty('orderCount', 20);
    expect(masked).toHaveProperty('majorPostedRefundCount', 2);
    expect(masked).toHaveProperty('failedOnlineOrderCount', 3);
    expect(masked).not.toHaveProperty('lowStockCount');
  });

  it('shows all known fields for fully authorized owner and omits unsafe sections/future fields', () => {
    const masked = maskOwnerSummaryForPrincipal(canonicalSummary, {
      ...principal(['finance.view', 'inventory.view', 'orders.view', 'approvals.review', 'reports.view']),
      role: 'OWNER',
    });
    for (const key of Object.keys(canonicalSummary).filter((key) => !['sections', 'newUnknownPrivateField'].includes(key))) {
      expect(masked).toHaveProperty(key, canonicalSummary[key]);
    }
    expect(masked).not.toHaveProperty('sections');
    expect(masked).not.toHaveProperty('newUnknownPrivateField');
  });

  it('masks the actual owner-summary HTTP response, not only React', async () => {
    const result = await requestSummary(principal(['finance.view']));
    expect(result.status()).toBe(200);
    const summaries = result.body()['summaries'] as Array<{ summary: Record<string, unknown> }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.summary).toHaveProperty('cashSalesNetMinor', 50000);
    expect(summaries[0]?.summary).not.toHaveProperty('lowStockCount');
    expect(summaries[0]?.summary).not.toHaveProperty('pendingApprovalCount');
    expect(summaries[0]?.summary).not.toHaveProperty('majorPostedRefundCount');
    expect(summaries[0]?.summary).not.toHaveProperty('sections');
    expect(canonicalSummary).toHaveProperty('lowStockCount', 4);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it('denies cross-shop direct HTTP reads without querying the data layer', async () => {
    const result = await requestSummary(principal(['finance.view']), otherShopId);
    expect(result.status()).toBe(403);
    expect(result.body()).toEqual({ error: 'shop_forbidden' });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
