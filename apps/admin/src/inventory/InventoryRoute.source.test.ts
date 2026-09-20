import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../../server/supabaseAdmin';
import { loadInventoryItemRows, loadTransferRows } from '../../api/admin/inventory';

describe('Admin inventory route', () => {
  it('mounts the real InventoryPage instead of the generic placeholder', async () => {
    const source = await readFile(resolve('apps/admin/src/app/routes.tsx'), 'utf8');
    expect(source).toContain("import { InventoryPage } from '../inventory/InventoryPage';");
    expect(source).toContain("if (route.path === '/inventory') return <InventoryPage />;");
  });

  it('keeps every incoming SENT transfer reachable beyond the 100-row history window', async () => {
    const recent = Array.from({ length: 100 }, (_, index) => ({
      id: `recent-${index}`,
      source_shop_id: 'shop-a',
      destination_shop_id: 'shop-b',
      status: 'RECEIVED' as const,
      sent_at: `2026-09-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      received_at: '2026-09-20T01:00:00.000Z',
    }));
    const incomingSent = Array.from({ length: 625 }, (_, index) => ({
      id: `incoming-${index}`,
      source_shop_id: 'shop-b',
      destination_shop_id: 'shop-a',
      status: 'SENT' as const,
      sent_at: `2026-01-01T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      received_at: null,
    }));
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table !== 'stock_transfers') throw new Error('unexpected table: ' + table);
      if (query.get('status') === 'eq.SENT') {
        const offset = Number(query.get('offset') ?? '0');
        const requested = Number(query.get('limit') ?? '500');
        return incomingSent.slice(offset, offset + Math.min(requested, 500));
      }
      return recent;
    });

    const rows = await loadTransferRows({ select } as unknown as AdminSupabaseClient, 'shop-a');

    expect(rows).toHaveLength(725);
    expect(rows.some((row) => row.id === 'incoming-624')).toBe(true);
    const actionableQueries = select.mock.calls
      .map(([, query]) => query)
      .filter((query) => query.get('status') === 'eq.SENT');
    expect(actionableQueries.map((query) => query.get('offset'))).toEqual(['0', '500', '625']);
  });

  it('pages the complete inventory item catalog under PostgREST caps', async () => {
    const inventoryItems = Array.from({ length: 1_250 }, (_, index) => ({
      id: `item-${index}`,
      shop_id: 'shop-a',
      name: `Item ${String(index).padStart(4, '0')}`,
      unit_label: 'unit',
      tracking_mode: 'RECIPE_TRACKED',
      active: true,
    }));
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table !== 'inventory_items') throw new Error('unexpected table: ' + table);
      const offset = Number(query.get('offset') ?? '0');
      const requested = Number(query.get('limit') ?? '10000');
      return inventoryItems.slice(offset, offset + Math.min(requested, 1_000));
    });

    const rows = await loadInventoryItemRows(
      { select } as unknown as AdminSupabaseClient,
      'shop-a',
    );

    expect(rows).toHaveLength(1_250);
    expect(
      select.mock.calls.map(([, query]) => (query as URLSearchParams).get('offset')),
    ).toEqual(['0', '1000', '1250']);
  });

  it('offers bounded stocktake batches when the catalog exceeds 500 items', async () => {
    const source = await readFile(
      resolve('apps/admin/src/inventory/InventoryPage.tsx'),
      'utf8',
    );
    expect(source).toContain('STOCKTAKE_BATCH_SIZE = 500');
    expect(source).toContain("'stocktake-select'");
    expect(source).toContain('stocktakeBatches');
    expect(source).toContain("mode === 'stocktake-select'");
  });

  it('retains one command ID for retries of the same inventory or purchasing intent', async () => {
    const inventorySource = await readFile(
      resolve('apps/admin/src/inventory/useInventory.ts'),
      'utf8',
    );
    const purchasingSource = await readFile(
      resolve('apps/admin/src/purchasing/usePurchasing.ts'),
      'utf8',
    );

    for (const source of [inventorySource, purchasingSource]) {
      expect(source).toContain('createRetainedCommandIds');
      expect(source).toContain('.complete(');
      expect(source).not.toMatch(/commandId:\s*commandId\(\)/);
    }
  });
});
