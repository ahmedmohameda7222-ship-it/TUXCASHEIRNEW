import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../../server/supabaseAdmin';
import { createPurchasingStore } from './purchasing';

describe('Admin purchasing workspace pagination', () => {
  it('keeps actionable purchase orders accessible beyond the 500-row history window', async () => {
    const recent = Array.from({ length: 500 }, (_, index) => ({
      id: `recent-${index}`,
      shop_id: 'shop-a',
      supplier_id: 'supplier-1',
      status: 'RECEIVED',
      reference: null,
      expected_delivery_date: null,
      version: 1,
      ordered_at: null,
      created_at: `2026-09-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      updated_at: '2026-09-20T00:00:00.000Z',
    }));
    const oldActionable = {
      id: 'old-actionable',
      shop_id: 'shop-a',
      supplier_id: 'supplier-1',
      status: 'PARTIALLY_RECEIVED',
      reference: 'OLD-OPEN',
      expected_delivery_date: null,
      version: 7,
      ordered_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'suppliers') {
        return [
          {
            id: 'supplier-1',
            business_id: 'business-1',
            name: 'Supplier',
            contact_name: null,
            phone: null,
            email: null,
            active: true,
          },
        ];
      }
      if (table === 'inventory_items') return [];
      if (table === 'purchase_orders') {
        if (query.get('status') === 'in.(DRAFT,ORDERED,PARTIALLY_RECEIVED)') {
          return Number(query.get('offset') ?? '0') === 0 ? [oldActionable] : [];
        }
        return recent;
      }
      if (table === 'purchase_order_lines') return [];
      throw new Error('unexpected table: ' + table);
    });

    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');

    expect(workspace.purchaseOrders.some((order) => order.id === 'old-actionable')).toBe(true);
  });
});
