import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionContext } from '../adminAuthService.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { loadInventoryWorkspace } from '../../api/admin/inventory.js';

vi.mock('./intelligenceService.js', () => ({
  loadInventoryIntelligence: async () => ({ reorderSuggestions: [] }),
  updateReplenishmentPolicy: vi.fn(),
}));

describe('Inventory canonical shop lookup', () => {
  it('reads public.shops by authorized principal shop IDs, not a nonexistent business_id', async () => {
    const allowed = '32000000-0000-4000-8000-000000000001';
    const queries: Array<{ table: string; params: URLSearchParams }> = [];
    const client = {
      select: vi.fn(async (table: string, params: URLSearchParams) => {
        queries.push({ table, params });
        if (table === 'shops') return [{ id: allowed, name: 'Authorized shop' }];
        return [];
      }),
      rpc: vi.fn(async () => []),
    } as unknown as AdminSupabaseClient;
    const context = {
      principal: {
        employeeId: 'worker',
        businessId: 'business',
        role: 'MANAGER',
        permissions: ['inventory.view'],
        shopIds: [allowed],
      },
    } as unknown as AdminSessionContext;

    const result = await loadInventoryWorkspace(client, context, allowed);
    expect(result.shops).toEqual([{ id: allowed, name: 'Authorized shop' }]);
    const shopQuery = queries.find((query) => query.table === 'shops');
    expect(shopQuery?.params.get('business_id')).toBeNull();
    expect(shopQuery?.params.get('id')).toBe(`in.(${allowed})`);
  });
});
