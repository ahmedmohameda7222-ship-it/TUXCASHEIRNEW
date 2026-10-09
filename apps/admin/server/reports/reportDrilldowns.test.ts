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
      [
        source('movement-1', 'finance-movement'),
        { ...source('order-1', 'customer-order'), shopId: 'other-shop' },
      ],
      { ...principal, permissions: ['reports.view'] },
      client,
    );
    expect(result.every((row) => row.drilldown === null)).toBe(true);
  });

  it('opens exact loyalty, promotion and segment records through authorized canonical links', async () => {
    const client = {
      select: vi.fn(async (table: string, query: URLSearchParams) => {
        expect(query.get('limit')).toBe('100');
        switch (table) {
          case 'loyalty_ledger':
            return [
              { id: 'loyalty-paid', shop_id: shopId, order_id: 'order-a', customer_id: 'customer-a' },
              { id: 'loyalty-no-order', shop_id: shopId, order_id: null, customer_id: 'customer-a' },
            ];
          case 'promotion_usage_ledger':
            return [{ id: 'promotion-use-a', shop_id: shopId, order_id: 'order-b' }];
          case 'orders':
            return [
              { id: 'order-a', shop_id: shopId },
              { id: 'order-b', shop_id: shopId },
            ];
          case 'customer_segments':
            return [
              { id: 'segment-a', business_id: principal.businessId, canonical_customer_id: 'customer-a' },
            ];
          case 'customer_contacts':
            return [{ id: 'contact-a', shop_id: shopId, canonical_customer_id: 'customer-a' }];
          case 'staff_payment_expense_events':
            return [{ staff_payment_record_id: 'pay-a', shop_id: shopId, employee_id: 'employee-a' }];
          default:
            return [];
        }
      }),
    } as unknown as AdminSupabaseClient;
    const result = await enrichReportDrilldowns(
      [
        source('loyalty-paid', 'loyalty-event'),
        source('loyalty-no-order', 'loyalty-event'),
        source('promotion-use-a', 'promotion-use'),
        source('segment-a', 'customer-segment'),
        source('pay-a', 'staff-payment'),
      ],
      { ...principal, permissions: [...principal.permissions, 'customers.view', 'loyalty.manage', 'promotions.manage'] },
      client,
    );
    expect(result.map(row=>row.drilldown)).toEqual([
      { type: 'ORDER', orderId: 'order-a' },
      { type: 'CUSTOMER', customerId: 'contact-a' },
      { type: 'ORDER', orderId: 'order-b' },
      { type: 'CUSTOMER', customerId: 'contact-a' },
      { type: 'STAFF', employeeId: 'employee-a', section: 'pay' },
    ]);
  });

  it('rejects cross-shop and unauthorized loyalty, promotion and segment relationships', async () => {
    const client = {
      select: vi.fn(async (table: string) => {
        switch (table) {
          case 'loyalty_ledger':
            return [{ id: 'loyalty-a', shop_id: shopId, order_id: 'other-order', customer_id: 'cross-customer' }];
          case 'promotion_usage_ledger':
            return [{ id: 'promotion-a', shop_id: shopId, order_id: 'other-order' }];
          case 'orders':
            return [{ id: 'other-order', shop_id: 'other-shop' }];
          case 'customer_segments':
            return [{ id: 'segment-a', business_id: 'other-business', canonical_customer_id: 'cross-customer' }];
          case 'customer_contacts':
            return [{ id: 'cross-contact', shop_id: 'other-shop', canonical_customer_id: 'cross-customer' }];
          default:
            return [];
        }
      }),
    } as unknown as AdminSupabaseClient;
    const result = await enrichReportDrilldowns(
      [source('loyalty-a','loyalty-event'),source('promotion-a','promotion-use'),source('segment-a','customer-segment')],
      { ...principal, permissions: [...principal.permissions, 'customers.view','loyalty.manage','promotions.manage'] },
      client,
    );
    expect(result.every(row=>row.drilldown===null)).toBe(true);
    const noGrant=await enrichReportDrilldowns(
      [source('loyalty-a','loyalty-event'),source('promotion-a','promotion-use'),source('segment-a','customer-segment')],
      { ...principal, permissions: ['reports.view'] },
      client,
    );
    expect(noGrant.every(row=>row.drilldown===null)).toBe(true);
  });

});
