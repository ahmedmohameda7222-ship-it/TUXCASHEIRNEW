import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { loadInventoryUnitConversionRows } from '../../api/admin/inventory.js';

describe('shop-scoped Inventory conversions pagination', () => {
  it('does not lose authorized conversions at PostgREST 1000-row response cap', async () => {
    const shopId = '32000000-0000-4000-8000-000000000001';
    const rows = Array.from({ length: 1_140 }, (_, index) => ({
      id: `conversion-${String(index).padStart(5, '0')}`,
      inventory_item_id: `item-${String(index).padStart(5, '0')}`,
      purchase_unit_label: 'case',
      base_micros_per_purchase_unit: 6_000_000,
      active: true,
      definition_version: 1,
    }));
    const offsets: number[] = [];
    const select = vi.fn(async (table: string, params: URLSearchParams) => {
      expect(table).toBe('inventory_unit_conversions');
      expect(params.get('shop_id')).toBe(`eq.${shopId}`);
      expect(params.get('order')).toContain('id.asc');
      const offset = Number(params.get('offset') ?? 0);
      offsets.push(offset);
      return rows.slice(offset, offset + 1_000);
    });
    const result = await loadInventoryUnitConversionRows(
      { select } as unknown as AdminSupabaseClient,
      shopId,
    );
    expect(result).toHaveLength(1_140);
    expect(result.at(-1)?.id).toBe('conversion-01139');
    expect(offsets).toEqual([0, 1000, 1140]);
  });
});
