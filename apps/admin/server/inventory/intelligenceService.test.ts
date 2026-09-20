import { describe, expect, it, vi } from 'vitest';

import type { AdminInventoryItem } from '@tux/admin-contracts';
import type { AdminSupabaseClient } from '../supabaseAdmin';
import { loadInventoryIntelligence, updateReplenishmentPolicy } from './intelligenceService';

const item: AdminInventoryItem = {
  id: 'item-1',
  name: 'Beef',
  unitLabel: 'kg',
  trackingMode: 'RECIPE_TRACKED',
  active: true,
  onHandMicros: 6_000,
  reservedMicros: 0,
  availableMicros: 6_000,
  weightedUnitCostMinor: 100,
  history: [],
};

describe('inventory intelligence purchasing integration', () => {
  it('counts only the unreceived remainder of open purchase orders as incoming stock', async () => {
    const select = vi.fn(async (table: string) => {
      if (table === 'inventory_replenishment_settings') {
        return [
          {
            inventory_item_id: 'item-1',
            par_level_base: 15_000,
            reorder_point_base: 7_000,
            preferred_supplier_id: 'supplier-1',
            preferred_purchase_unit: 'case',
            lead_time_days: 3,
            minimum_order_quantity_base: null,
            order_multiple_base: null,
            version: 4,
          },
        ];
      }
      if (table === 'purchase_orders') {
        return [
          { id: 'po-open', status: 'PARTIALLY_RECEIVED' },
          { id: 'po-draft', status: 'DRAFT' },
          { id: 'po-closed', status: 'RECEIVED' },
        ];
      }
      if (table === 'purchase_order_lines') {
        return [
          {
            purchase_order_id: 'po-open',
            inventory_item_id: 'item-1',
            ordered_base_micros: 5_000,
            received_base_micros: 2_000,
          },
          {
            purchase_order_id: 'po-draft',
            inventory_item_id: 'item-1',
            ordered_base_micros: 9_000,
            received_base_micros: 0,
          },
          {
            purchase_order_id: 'po-closed',
            inventory_item_id: 'item-1',
            ordered_base_micros: 8_000,
            received_base_micros: 8_000,
          },
        ];
      }
      if (table === 'inventory_movements') return [];
      if (table === 'products') return [];
      if (table === 'recipe_lines') return [];
      if (table === 'inventory_margin_settings') return [];
      if (table === 'orders') return [];
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await loadInventoryIntelligence(
      { select } as unknown as AdminSupabaseClient,
      'shop-a',
      [item],
      Date.parse('2026-09-19T06:00:00.000Z'),
    );

    expect(result.reorderSuggestions).toHaveLength(1);
    expect(result.reorderSuggestions[0]).toMatchObject({
      inventoryItemId: 'item-1',
      incomingMicros: 3_000,
      suggestedOrderMicros: 6_000,
    });
  });

  it('never changes on-hand or available stock when a PO is merely ordered', async () => {
    const select = vi.fn(async (table: string) => {
      if (table === 'inventory_replenishment_settings') return [];
      if (table === 'purchase_orders') return [{ id: 'po-open', status: 'ORDERED' }];
      if (table === 'purchase_order_lines') {
        return [
          {
            purchase_order_id: 'po-open',
            inventory_item_id: 'item-1',
            ordered_base_micros: 20_000,
            received_base_micros: 0,
          },
        ];
      }
      if (table === 'inventory_movements') return [];
      if (table === 'products') return [];
      if (table === 'recipe_lines') return [];
      if (table === 'inventory_margin_settings') return [];
      if (table === 'orders') return [];
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await loadInventoryIntelligence(
      { select } as unknown as AdminSupabaseClient,
      'shop-a',
      [item],
    );

    expect(result.reorderSuggestions[0]).toMatchObject({
      availableMicros: 6_000,
      incomingMicros: 20_000,
    });
    expect(item).toMatchObject({
      onHandMicros: 6_000,
      availableMicros: 6_000,
    });
  });

  it('aggregates every movement in the reporting window beyond the first 10,000 rows', async () => {
    const firstPage = Array.from({ length: 10_000 }, () => ({
      inventory_item_id: 'item-1',
      movement_type: 'WASTE',
      quantity_delta_micros: -1,
      order_id: null,
    }));
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      if (table === 'inventory_movements') {
        const offset = Number(query?.get('offset') ?? '0');
        return offset === 0
          ? firstPage
          : offset === 10_000
            ? [
                {
                  inventory_item_id: 'item-1',
                  movement_type: 'WASTE',
                  quantity_delta_micros: -100,
                  order_id: null,
                },
              ]
            : [];
      }
      if (table === 'inventory_replenishment_settings') return [];
      if (table === 'purchase_orders') return [];
      if (table === 'products') return [];
      if (table === 'recipe_lines') return [];
      if (table === 'inventory_margin_settings') return [];
      if (table === 'orders') return [];
      throw new Error('unexpected table: ' + table);
    });

    const result = await loadInventoryIntelligence(
      { select } as unknown as AdminSupabaseClient,
      'shop-a',
      [item],
      Date.parse('2026-09-19T06:00:00.000Z'),
    );

    expect(result.variances[0]).toMatchObject({
      inventoryItemId: 'item-1',
      actualUsageMicros: 10_100,
    });
    const movementOffsets = select.mock.calls
      .filter(([table]) => table === 'inventory_movements')
      .map(([, query]) => query?.get('offset'));
    expect(movementOffsets).toEqual(['0', '10000', '10001']);
  });
  it('continues paging when PostgREST returns fewer rows than the requested limit', async () => {
    const allMovements = Array.from({ length: 1_250 }, (_, index) => ({
      inventory_item_id: 'item-1',
      movement_type: 'WASTE',
      quantity_delta_micros: -1,
      order_id: null,
      index,
    }));
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      if (table === 'inventory_movements') {
        const offset = Number(query?.get('offset') ?? '0');
        const requested = Number(query?.get('limit') ?? '10000');
        const effectiveCap = Math.min(requested, 1_000);
        return allMovements.slice(offset, offset + effectiveCap);
      }
      if (table === 'inventory_replenishment_settings') return [];
      if (table === 'purchase_orders') return [];
      if (table === 'products') return [];
      if (table === 'recipe_lines') return [];
      if (table === 'inventory_margin_settings') return [];
      if (table === 'orders') return [];
      throw new Error('unexpected table: ' + table);
    });

    const result = await loadInventoryIntelligence(
      { select } as unknown as AdminSupabaseClient,
      'shop-a',
      [item],
      Date.parse('2026-09-19T06:00:00.000Z'),
    );

    expect(result.variances[0]).toMatchObject({
      inventoryItemId: 'item-1',
      actualUsageMicros: 1_250,
    });
  });

  it('batches order-status lookups instead of creating one unbounded in-list request', async () => {
    const movements = Array.from({ length: 250 }, (_, index) => ({
      inventory_item_id: 'item-1',
      movement_type: 'ORDER_CONSUMPTION',
      quantity_delta_micros: -1,
      order_id: `order-${index.toString().padStart(3, '0')}`,
    }));
    const orderQueries: URLSearchParams[] = [];
    const select = vi.fn(async (table: string, query?: URLSearchParams) => {
      if (table === 'inventory_movements') {
        return Number(query?.get('offset') ?? '0') === 0 ? movements : [];
      }
      if (table === 'orders') {
        const ids = (query?.get('id') ?? '')
          .replace(/^in\.\(/, '')
          .replace(/\)$/, '')
          .split(',');
        if (ids.length > 100) throw new Error('order status request too large');
        orderQueries.push(query!);
        return ids.filter(Boolean).map((id) => ({ id, status: 'DONE' }));
      }
      if (table === 'inventory_replenishment_settings') return [];
      if (table === 'purchase_orders') return [];
      if (table === 'products') return [];
      if (table === 'recipe_lines') return [];
      if (table === 'inventory_margin_settings') return [];
      throw new Error('unexpected table: ' + table);
    });

    await expect(
      loadInventoryIntelligence(
        { select } as unknown as AdminSupabaseClient,
        'shop-a',
        [item],
        Date.parse('2026-09-19T06:00:00.000Z'),
      ),
    ).resolves.toBeDefined();

    expect(orderQueries.length).toBeGreaterThan(1);
  });

  it('uses the observed replenishment version as an atomic compare-and-swap guard', async () => {
    const update = vi.fn(async (_table: string, _query: URLSearchParams) => []);
    const client = {
      select: vi.fn(async () => [{ version: 4 }]),
      update,
      insert: vi.fn(),
    } as unknown as AdminSupabaseClient;

    await expect(
      updateReplenishmentPolicy(client, {
        employeeId: 'employee-1',
        shopId: 'shop-a',
        inventoryItemId: 'item-1',
        parLevelMicros: 10_000,
        reorderPointMicros: 5_000,
        preferredPurchaseUnit: 'case',
        leadTimeDays: 2,
        minimumOrderMicros: null,
        orderMultipleMicros: null,
      }),
    ).rejects.toThrow(/inventory_replenishment_conflict/);

    const query = update.mock.calls[0]?.[1];
    expect(query?.get('version')).toBe('eq.4');
  });
});
