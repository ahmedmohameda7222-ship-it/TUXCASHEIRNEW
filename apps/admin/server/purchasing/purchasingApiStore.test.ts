import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { createPurchasingStore } from '../../api/admin/purchasing';

describe('Admin purchasing workspace pagination', () => {
  it('paginates active purchase-unit conversions beyond the PostgREST row cap', async () => {
    const conversions = Array.from({ length: 1_205 }, (_, index) => ({
      inventory_item_id: 'item-1',
      purchase_unit_label: `package-${index}`,
      base_micros_per_purchase_unit: 1_000_000 * (index + 1),
    }));
    const offsets: string[] = [];
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'inventory_unit_conversions') {
        offsets.push(query.get('offset') ?? 'missing');
        const offset = Number(query.get('offset') ?? '0');
        const limit = Math.min(Number(query.get('limit') ?? '1000'), 1000);
        return conversions.slice(offset, offset + limit);
      }
      if (table === 'inventory_items') {
        return Number(query.get('offset') ?? '0') === 0
          ? [{ id: 'item-1', name: 'Bread', unit_label: 'piece', active: true }]
          : [];
      }
      if (table === 'suppliers' || table === 'purchase_orders' || table === 'purchase_order_lines')
        return [];
      throw new Error('unexpected table: ' + table);
    });
    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');
    expect(workspace.inventoryItems[0]?.purchaseUnits).toHaveLength(1_206);
    expect(offsets).toEqual(['0', '1000', '1205']);
  });

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
        return Number(query.get('offset') ?? '0') === 0
          ? [
              {
                id: 'supplier-1',
                business_id: 'business-1',
                name: 'Supplier',
                contact_name: null,
                phone: null,
                email: null,
                active: true,
                version: 1,
              },
            ]
          : [];
      }
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'inventory_items') return [];
      if (table === 'purchase_orders') {
        if (query.get('status') === 'in.(DRAFT,ORDERED,PARTIALLY_RECEIVED,RECEIVED)') {
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

  it('keeps older received purchase orders available for returns beyond the history window', async () => {
    const recent = Array.from({ length: 500 }, (_, index) => ({
      id: `recent-${index}`,
      shop_id: 'shop-a',
      supplier_id: 'supplier-1',
      status: 'CANCELLED',
      reference: null,
      expected_delivery_date: null,
      version: 1,
      ordered_at: null,
      created_at: `2026-09-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      updated_at: '2026-09-20T00:00:00.000Z',
    }));
    const oldReceived = {
      id: 'old-received',
      shop_id: 'shop-a',
      supplier_id: 'supplier-1',
      status: 'RECEIVED',
      reference: 'RETURNABLE',
      expected_delivery_date: null,
      version: 8,
      ordered_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'suppliers') return [];
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'inventory_items') return [];
      if (table === 'purchase_orders') {
        const status = query.get('status');
        if (status !== null) {
          if (!status.includes('RECEIVED')) return [];
          return Number(query.get('offset') ?? '0') === 0 ? [oldReceived] : [];
        }
        return recent;
      }
      if (table === 'purchase_order_lines') {
        if (!query.get('purchase_order_id')?.includes('old-received')) return [];
        return Number(query.get('offset') ?? '0') === 0
          ? [
              {
                id: 'line-returnable',
                purchase_order_id: 'old-received',
                inventory_item_id: 'item-1',
                purchase_unit_label: 'unit',
                base_micros_per_purchase_unit: 1_000_000,
                ordered_purchase_units_micros: 2_000_000,
                received_purchase_units_micros: 2_000_000,
                returned_purchase_units_micros: 500_000,
                ordered_base_micros: 2_000_000,
                received_base_micros: 2_000_000,
                returned_base_micros: 500_000,
                expected_purchase_unit_cost_minor: 100,
                expected_unit_cost_minor: 100,
              },
            ]
          : [];
      }
      throw new Error('unexpected table: ' + table);
    });

    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');

    expect(workspace.purchaseOrders.some((order) => order.id === 'old-received')).toBe(true);
  });

  it('pages every supplier under PostgREST caps', async () => {
    const suppliers = Array.from({ length: 1_250 }, (_, index) => ({
      id: `supplier-${index}`,
      business_id: 'business-1',
      name: `Supplier ${String(index).padStart(4, '0')}`,
      contact_name: null,
      phone: null,
      email: null,
      active: true,
      version: 1,
    }));
    const supplierQueries: URLSearchParams[] = [];
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'suppliers') {
        supplierQueries.push(query);
        const offset = Number(query.get('offset') ?? '0');
        const requested = Number(query.get('limit') ?? '10000');
        return suppliers.slice(offset, offset + Math.min(requested, 1_000));
      }
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'purchase_orders') return [];
      if (table === 'purchase_order_lines') return [];
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'inventory_items') return [];
      throw new Error('unexpected table: ' + table);
    });

    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');

    expect(workspace.suppliers).toHaveLength(1_250);
    expect(workspace.suppliers.at(-1)?.id).toBe('supplier-1249');
    expect(supplierQueries.map((query) => query.get('offset'))).toEqual(['0', '1000', '1250']);
  });

  it('preserves inactive item metadata for actionable purchase-order lines without exposing it for creation', async () => {
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'suppliers') return [];
      if (table === 'purchase_orders') {
        if (query.get('status') === 'in.(DRAFT,ORDERED,PARTIALLY_RECEIVED,RECEIVED)') {
          return Number(query.get('offset') ?? '0') === 0
            ? [
                {
                  id: 'po-open',
                  shop_id: 'shop-a',
                  supplier_id: 'supplier-1',
                  status: 'ORDERED',
                  reference: null,
                  expected_delivery_date: null,
                  version: 1,
                  ordered_at: '2026-09-20T00:00:00.000Z',
                  created_at: '2026-09-20T00:00:00.000Z',
                  updated_at: '2026-09-20T00:00:00.000Z',
                },
              ]
            : [];
        }
        return [];
      }
      if (table === 'purchase_order_lines') {
        return Number(query.get('offset') ?? '0') === 0
          ? [
              {
                id: 'line-1',
                purchase_order_id: 'po-open',
                inventory_item_id: 'inactive-item',
                purchase_unit_label: 'case',
                base_micros_per_purchase_unit: 1_000_000,
                ordered_purchase_units_micros: 2_000_000,
                received_purchase_units_micros: 0,
                returned_purchase_units_micros: 0,
                ordered_base_micros: 2_000_000,
                received_base_micros: 0,
                returned_base_micros: 0,
                expected_purchase_unit_cost_minor: 100,
                expected_unit_cost_minor: 100,
              },
            ]
          : [];
      }
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'inventory_items') {
        if (query.get('active') === 'eq.true') return [];
        expect(query.get('shop_id')).toBe('eq.shop-a');
        expect(query.get('id')).toContain('inactive-item');
        return Number(query.get('offset') ?? '0') === 0
          ? [{ id: 'inactive-item', name: 'Archived Beef', unit_label: 'kg', active: false }]
          : [];
      }
      throw new Error('unexpected table: ' + table);
    });

    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');

    expect(workspace.inventoryItems).toEqual([]);
    expect(workspace.purchaseOrders[0]?.lines[0]).toMatchObject({
      inventoryItemId: 'inactive-item',
      itemName: 'Archived Beef',
      unitLabel: 'kg',
    });
  });

  it('pages every active purchasable inventory item under PostgREST caps', async () => {
    const inventoryItems = Array.from({ length: 1_250 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${String(index).padStart(4, '0')}`,
      unit_label: 'unit',
      active: true,
    }));
    const itemQueries: URLSearchParams[] = [];
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'suppliers') return [];
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'purchase_orders') return [];
      if (table === 'purchase_order_lines') return [];
      if (table === 'inventory_unit_conversions') return [];
      if (table === 'inventory_items') {
        itemQueries.push(query);
        const offset = Number(query.get('offset') ?? '0');
        const requested = Number(query.get('limit') ?? '10000');
        return inventoryItems.slice(offset, offset + Math.min(requested, 1_000));
      }
      throw new Error('unexpected table: ' + table);
    });

    const workspace = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadWorkspace('shop-a', 'business-1');

    expect(workspace.inventoryItems).toHaveLength(1_250);
    expect(workspace.inventoryItems.at(-1)?.id).toBe('item-1249');
    expect(itemQueries.map((query) => query.get('offset'))).toEqual(['0', '1000', '1250']);
  });
});

describe('Admin persisted purchase history read boundaries', () => {
  it('does not read event tables for an order outside its authorized business and shop', async () => {
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      expect(table).toBe('purchase_orders');
      expect(query.get('shop_id')).toBe('eq.shop-a');
      expect(query.get('business_id')).toBe('eq.business-1');
      expect(query.get('id')).toBe('eq.po-outside');
      return [];
    });
    const result = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadHistory('shop-a', 'business-1', 'po-outside');
    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('shows genuine receipt costs and aggregated return allocations with exact PO scoping', async () => {
    const headers = [
      { id: 'receipt-a', supplier_reference: 'INV-42', received_at: '2026-10-25T10:00:00Z' },
    ];
    const returns = [
      { id: 'return-a', supplier_reference: 'RET-3', returned_at: '2026-10-25T11:00:00Z' },
    ];
    const receiptLines = [
      {
        id: 'receipt-line-a',
        purchase_receipt_id: 'receipt-a',
        purchase_order_line_id: 'po-line-a',
        received_purchase_units_micros: '500000',
        purchase_unit_cost_minor: '12500.000000',
      },
    ];
    const returnLines = [
      {
        id: 'return-line-a',
        purchase_return_id: 'return-a',
        purchase_order_line_id: 'po-line-a',
        returned_purchase_units_micros: '100000',
      },
      {
        id: 'return-line-b',
        purchase_return_id: 'return-a',
        purchase_order_line_id: 'po-line-a',
        returned_purchase_units_micros: '50000',
      },
    ];
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'purchase_orders') {
        expect(query.get('shop_id')).toBe('eq.shop-a');
        expect(query.get('business_id')).toBe('eq.business-1');
        expect(query.get('id')).toBe('eq.po-a');
        return [{ id: 'po-a' }];
      }
      if (table === 'purchase_receipts' || table === 'purchase_returns') {
        expect(query.get('shop_id')).toBe('eq.shop-a');
        expect(query.get('purchase_order_id')).toBe('eq.po-a');
        return table === 'purchase_receipts' ? headers : returns;
      }
      if (table === 'purchase_receipt_lines') {
        expect(query.get('purchase_receipt_id')).toBe('in.(receipt-a)');
        return query.get('offset') === '0' ? receiptLines : [];
      }
      if (table === 'purchase_return_lines') {
        expect(query.get('purchase_return_id')).toBe('in.(return-a)');
        return query.get('offset') === '0' ? returnLines : [];
      }
      throw new Error('unexpected history table: ' + table);
    });
    const result = await createPurchasingStore({
      select,
    } as unknown as AdminSupabaseClient).loadHistory('shop-a', 'business-1', 'po-a');
    expect(result).toMatchObject({ shopId: 'shop-a', purchaseOrderId: 'po-a', truncated: false });
    expect(result?.events).toHaveLength(2);
    expect(result?.events[0]).toMatchObject({
      type: 'RETURN',
      occurredAt: '2026-10-25T11:00:00Z',
      supplierReference: 'RET-3',
      lines: [
        {
          purchaseOrderLineId: 'po-line-a',
          quantityPurchaseUnitsMicros: 150000,
          purchaseUnitCostMinor: null,
        },
      ],
    });
    expect(result?.events[1]).toMatchObject({
      type: 'RECEIPT',
      supplierReference: 'INV-42',
      lines: [
        {
          purchaseOrderLineId: 'po-line-a',
          quantityPurchaseUnitsMicros: 500000,
          purchaseUnitCostMinor: 12500,
        },
      ],
    });
  });
});
