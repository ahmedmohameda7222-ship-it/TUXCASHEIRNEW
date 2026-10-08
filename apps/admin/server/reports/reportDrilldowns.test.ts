import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { enrichReportDrilldowns } from './reportDrilldowns.js';

const shopId = '00000000-0000-4000-8000-000000000001';
const source = (id: string, sourceKind: string) => ({ id, shopId, sourceKind });
const principal: AdminSessionPrincipal = {
  employeeId: 'employee-a',
  businessId: 'business-a',
  shopIds: [shopId],
  role: 'OWNER',
  permissions: [
    'reports.view',
    'orders.view',
    'staff.view',
    'inventory.view',
    'purchasing.view',
    'finance.view',
  ],
};

describe('typed report drilldowns', () => {
  it('resolves canonical parent records without rendering generic landing routes', async () => {
    const client = {
      select: vi.fn(async (table: string) => {
        switch (table) {
          case 'admin_order_refunds':
            return [{ id: 'refund-1', shop_id: shopId, order_id: 'order-1' }];
          case 'finance_movements':
            return [{ id: 'movement-1', shop_id: shopId, finance_account_id: 'account-1' }];
          case 'attendance_events':
            return [{ id: 'attendance-1', shop_id: shopId, employee_id: 'worker-1' }];
          case 'inventory_movements':
            return [{ id: 'inventory-1', shop_id: shopId, inventory_item_id: 'item-1' }];
          default:
            return [];
        }
      }),
    } as unknown as AdminSupabaseClient;
    const resolved = await enrichReportDrilldowns(
      [
        source('refund-1', 'refund'),
        source('movement-1', 'finance-movement'),
        source('attendance-1', 'attendance-event'),
        source('inventory-1', 'inventory-movement'),
        source('purchase-1', 'purchase-order'),
      ],
      principal,
      client,
    );
    expect(resolved.map((row) => row.drilldown)).toEqual([
      { type: 'ORDER', orderId: 'order-1' },
      { type: 'FINANCE_ACCOUNT', accountId: 'account-1', movementId: 'movement-1' },
      { type: 'STAFF', employeeId: 'worker-1', section: 'attendance' },
      { type: 'INVENTORY_ITEM', inventoryItemId: 'item-1' },
      { type: 'PURCHASE_ORDER', purchaseOrderId: 'purchase-1' },
    ]);
  });

  it('never resolves parents for unauthorized shop or domain', async () => {
    const client = {
      select: vi.fn(async () => {
        throw new Error('untrusted query should not execute');
      }),
    } as unknown as AdminSupabaseClient;
    const result = await enrichReportDrilldowns(
      [source('movement-1', 'finance-movement'), { ...source('order-1', 'customer-order'), shopId: 'other-shop' }],
      { ...principal, permissions: ['reports.view'] },
      client,
    );
    expect(result.every((row) => row.drilldown === null)).toBe(true);
  });
});
