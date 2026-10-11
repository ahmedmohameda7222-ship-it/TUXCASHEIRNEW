import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_SHOPS,
  resetLocalAdminData,
  requestLocalAdmin,
} from './localAdminFixtureApi';

const shopId = FIXTURE_SHOPS[0]!.id;
const query = (surface: string, suffix = '') =>
  requestLocalAdmin<Record<string, unknown>>(`/api/admin/${surface}?shopId=${shopId}${suffix}`);

describe('local Admin workspaces', () => {
  beforeEach(() => resetLocalAdminData());

  it.each([
    ['catalog', 'products'],
    ['inventory', 'items'],
    ['purchasing', 'purchaseOrders'],
    ['orders', 'rows'],
    ['customers', 'customers'],
    ['delivery', 'orders'],
    ['staff', 'employees'],
    ['finance', 'accounts'],
    ['approvals', 'approvals'],
    ['audit', 'events'],
  ])('provides populated %s workspace', async (surface, field) => {
    const result = await query(surface, surface === 'customers' ? '&view=customers' : '');
    const value = result[field];
    if (surface === 'staff') {
      expect((value as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    } else {
      expect(Array.isArray(value)).toBe(true);
      expect((value as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('serves realistic reporting, settings and expense views', async () => {
    const dashboard = await query('reports', '&view=dashboard');
    expect(Number(dashboard.netSalesMinor)).toBeGreaterThan(0);
    const settings = await query('settings', '&view=workspace');
    expect((settings.orderTypes as unknown[]).length).toBeGreaterThan(0);
    const expenses = await query('finance', '&view=expenses');
    expect((expenses.expenses as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps write results and readback consistent without network', async () => {
    const before = await query('delivery');
    const first = (before.orders as Array<{ orderId: string }>)[0]!;
    await requestLocalAdmin('/api/admin/delivery', {
      method: 'POST',
      body: JSON.stringify({
        type: 'delivery.transition',
        shopId,
        orderId: first.orderId,
        toState: 'DELIVERED',
        expectedVersion: 4,
        commandId: 'delivery-1',
      }),
    });
    const after = await query('delivery');
    expect((after.orders as Array<{ orderId: string; state: string }>).find(
      (order) => order.orderId === first.orderId,
    )?.state).toBe('DELIVERED');
    expect(FIXTURE_SHOPS[0]?.id).toBe(shopId);
  });

  it('rejects invalid scope, unsupported routes and mutations instead of silently succeeding', async () => {
    await expect(query('inventory', '&inventoryItemId=not-real')).rejects.toThrow();
    await expect(requestLocalAdmin('/api/admin/not-a-surface')).rejects.toThrow();
    await expect(requestLocalAdmin('/api/admin/finance', {
      method: 'POST',
      body: JSON.stringify({ type: 'unknown', shopId }),
    })).rejects.toThrow();
    await expect(requestLocalAdmin('/api/admin/orders?shopId=ffffffff-ffff-4fff-8fff-ffffffffffff')).rejects.toThrow();
  });

  it('allows session and logout only within the fixture request boundary', async () => {
    const session = await requestLocalAdmin<{ principal: { shopIds: string[] } }>('/api/admin/session');
    expect(session.principal.shopIds).toContain(shopId);
    await requestLocalAdmin('/api/admin/logout', { method: 'POST' });
    await expect(requestLocalAdmin('/api/admin/session')).rejects.toMatchObject({ status: 401 });
    await requestLocalAdmin('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '1234' }) });
    const restored = await requestLocalAdmin<{ principal: { shopIds: string[] } }>('/api/admin/session');
    expect(restored.principal.shopIds).toContain(shopId);
  });
});
