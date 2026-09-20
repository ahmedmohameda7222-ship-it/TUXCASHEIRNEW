import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../../server/supabaseAdmin';
import { loadTransferRows } from '../../api/admin/inventory';

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
    const oldIncoming = {
      id: 'old-incoming-sent',
      source_shop_id: 'shop-b',
      destination_shop_id: 'shop-a',
      status: 'SENT' as const,
      sent_at: '2026-01-01T00:00:00.000Z',
      received_at: null,
    };
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table !== 'stock_transfers') throw new Error('unexpected table: ' + table);
      if (query.get('status') === 'eq.SENT') {
        return Number(query.get('offset') ?? '0') === 0 ? [oldIncoming] : [];
      }
      return recent;
    });

    const rows = await loadTransferRows({ select } as unknown as AdminSupabaseClient, 'shop-a');

    expect(rows).toHaveLength(101);
    expect(rows.some((row) => row.id === 'old-incoming-sent')).toBe(true);
    const actionableQueries = select.mock.calls
      .map(([, query]) => query)
      .filter((query) => query.get('status') === 'eq.SENT');
    expect(actionableQueries.map((query) => query.get('offset'))).toEqual(['0', '1']);
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
