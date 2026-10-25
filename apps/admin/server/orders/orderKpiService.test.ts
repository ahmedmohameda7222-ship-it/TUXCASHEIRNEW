import { describe, expect, it, vi } from 'vitest';
import type { AdminSessionPrincipal } from '@tux/admin-contracts';

import { queryOrdersKpis } from './orderKpiService.js';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const employeeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const businessId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const principal = (permissions: AdminSessionPrincipal['permissions']): AdminSessionPrincipal => ({
  businessId,
  employeeId,
  shopIds: [shopId],
  role: 'OWNER',
  permissions,
});

describe('Orders authoritative KPI service', () => {
  const response = {
    ok: true as const,
    shopId,
    orderCount: 65,
    activeOrderCount: 7,
    netSalesMinor: 471550,
    averageOrderMinor: 7918,
    denominatorPaidOrderCount: 58,
  };

  it('uses a single shop- and actor-scoped aggregate RPC, never paginated search results', async () => {
    const rpc = vi.fn().mockResolvedValue(response);
    const kpis = await queryOrdersKpis(
      { shopId, from: '2026-10-01T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z' },
      principal(['orders.view', 'finance.view']),
      { rpc },
    );
    expect(kpis).toMatchObject({
      shopId,
      orderCount: 65,
      activeOrderCount: 7,
      netSalesMinor: 471550,
      averageOrderMinor: 7918,
      denominatorPaidOrderCount: 58,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_orders_kpis_v1', {
      p_actor_employee_id: employeeId,
      p_shop_id: shopId,
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-26T00:00:00.000Z',
    });
  });

  it('masks revenue, AOV and denominator when finance permission is absent even if RPC leaks values', async () => {
    const rpc = vi.fn().mockResolvedValue(response);
    const kpis = await queryOrdersKpis(
      { shopId, from: null, to: null },
      principal(['orders.view']),
      { rpc },
    );
    expect(kpis).toMatchObject({
      orderCount: 65,
      activeOrderCount: 7,
      netSalesMinor: null,
      averageOrderMinor: null,
      denominatorPaidOrderCount: null,
    });
  });

  it('rejects missing shop access before hitting the database', async () => {
    const rpc = vi.fn();
    await expect(
      queryOrdersKpis(
        { shopId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', from: null, to: null },
        principal(['orders.view', 'finance.view']),
        { rpc },
      ),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid timestamps and reversed range without falling back to a misleading total', async () => {
    const rpc = vi.fn();
    for (const [from, to] of [
      ['not-a-date', null],
      ['2026-10-27T00:00:00.000Z', '2026-10-26T00:00:00.000Z'],
      ['2026-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'],
    ] as const) {
      await expect(
        queryOrdersKpis({ shopId, from, to }, principal(['orders.view']), { rpc }),
      ).rejects.toThrow('invalid_orders_kpi_range');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses malformed, cross-shop or non-integer RPC aggregates', async () => {
    const rpc = vi.fn().mockResolvedValue({ ...response, shopId: 'other-shop' });
    await expect(
      queryOrdersKpis({ shopId, from: null, to: null }, principal(['orders.view']), { rpc }),
    ).rejects.toThrow('orders_kpis_invalid');
    rpc.mockResolvedValue({ ...response, shopId, orderCount: 1.5 });
    await expect(
      queryOrdersKpis({ shopId, from: null, to: null }, principal(['orders.view']), { rpc }),
    ).rejects.toThrow('orders_kpis_invalid');
  });

  it('preserves null average for zero paid order denominator', async () => {
    const rpc = vi.fn().mockResolvedValue({
      ...response,
      orderCount: 8,
      netSalesMinor: 0,
      averageOrderMinor: null,
      denominatorPaidOrderCount: 0,
    });
    const kpis = await queryOrdersKpis(
      { shopId, from: null, to: null },
      principal(['orders.view', 'finance.view']),
      { rpc },
    );
    expect(kpis.averageOrderMinor).toBeNull();
  });
});
