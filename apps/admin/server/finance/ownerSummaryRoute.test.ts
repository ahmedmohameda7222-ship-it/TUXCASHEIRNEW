import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAdvancedFinance } from './financeOperationsApi.js';
import type { AdminRequest, AdminResponse } from '../http.js';

const shopId = '32000000-0000-4000-8000-000000000001';
const otherShopId = '32000000-0000-4000-8000-000000000002';
const state = vi.hoisted(() => ({
  permissions: ['finance.view'],
  shops: ['32000000-0000-4000-8000-000000000001'],
}));
vi.mock('../env.js', () => ({
  getAdminServerEnv: () => ({
    supabaseUrl: 'https://mock.supabase.test',
    serviceRoleKey: 'mock-service-role-key',
  }),
}));
vi.mock('../adminAuthService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../adminAuthService.js')>()),
  loadAdminSession: async () => ({
    principal: {
      employeeId: 'employee',
      businessId: 'business',
      role: 'STAFF',
      permissions: state.permissions,
      shopIds: state.shops,
    },
  }),
}));

function captureResponse() {
  let status = 200;
  let body = '';
  const response = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader() {
      return response;
    },
    end(value?: unknown) {
      body = String(value ?? '');
      return response;
    },
  } as unknown as AdminResponse;
  return {
    response,
    status: () => status,
    json: () => JSON.parse(body) as Record<string, unknown>,
    raw: () => body,
  };
}
function request(shop: string): AdminRequest {
  return {
    method: 'GET',
    url: `/api/admin/finance?view=owner-summary&shopId=${shop}`,
    headers: { cookie: `tux_admin_session=${'ab'.repeat(32)}` },
  } as unknown as AdminRequest;
}

const calls: string[] = [];
beforeEach(() => {
  state.permissions = ['finance.view'];
  state.shops = [shopId];
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(url.toString());
      if (url.pathname.endsWith('/rest/v1/daily_owner_summaries')) {
        return Response.json([
          {
            id: 'summary-one',
            business_day_id: 'day-one',
            generated_at: '2026-10-09T12:00:00Z',
            summary: {
              netSalesMinor: 20000,
              estimatedOperatingProfitMinor: 9000,
              orderCount: 10,
              lowStockCount: 8,
              wasteCostMinor: 700,
              pendingApprovalCount: 2,
              majorPostedRefundCount: 1,
              failedOnlineOrderCount: 3,
              sections: ['Inventory', 'Operations', 'Profit'],
              futureSecret: { staffNames: ['hidden'] },
            },
          },
        ]);
      }
      return Response.json({ error: 'unexpected query' }, { status: 500 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Owner Summary direct HTTP authorization', () => {
  it('masks protected domains even when the browser calls Finance BFF directly', async () => {
    const response = captureResponse();
    await handleAdvancedFinance(request(shopId), response.response);
    expect(response.status()).toBe(200);
    expect(response.raw()).toContain('estimatedOperatingProfitMinor');
    for (const field of [
      'netSalesMinor', 'orderCount', 'lowStockCount', 'wasteCostMinor',
      'pendingApprovalCount', 'majorPostedRefundCount',
      'failedOnlineOrderCount', 'sections', 'futureSecret', 'staffNames',
    ]) {
      expect(response.raw()).not.toContain(field);
    }
    expect(calls.length).toBe(1);
    const query = new URL(calls[0]!);
    expect(query.searchParams.get('business_id')).toBe('eq.business');
    expect(query.searchParams.get('shop_id')).toBe(`eq.${shopId}`);
  });

  it('never reads or returns another shop\'s summaries', async () => {
    const response = captureResponse();
    await handleAdvancedFinance(request(otherShopId), response.response);
    expect(response.status()).toBe(403);
    expect(response.json()).toEqual({ error: 'shop_forbidden' });
    expect(calls).toEqual([]);
  });

  it('preserves full authorized domains for a fully-permitted principal', async () => {
    state.permissions = [
      'finance.view', 'reports.view', 'orders.view', 'inventory.view', 'approvals.review',
    ];
    const response = captureResponse();
    await handleAdvancedFinance(request(shopId), response.response);
    expect(response.status()).toBe(200);
    const rows = response.json()['summaries'] as Array<Record<string, unknown>>;
    const summary = rows[0]!['summary'] as Record<string, unknown>;
    expect(summary['netSalesMinor']).toBe(20000);
    expect(summary['orderCount']).toBe(10);
    expect(summary['lowStockCount']).toBe(8);
    expect(summary['pendingApprovalCount']).toBe(2);
    expect(summary).not.toHaveProperty('sections');
  });
});
