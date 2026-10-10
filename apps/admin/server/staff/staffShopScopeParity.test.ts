import { describe, expect, it } from 'vitest';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createSupabaseStaffStore } from './staffStore.js';

describe('Staff canonical business/shop read contract', () => {
  it('reads names only through principal-authorized shop IDs, never shops.business_id', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001';
    const businessId = '20000000-0000-4000-8000-000000000002';
    const calls: Array<{ table: string; query: URLSearchParams }> = [];
    const client = {
      select: async (table: string, query: URLSearchParams) => {
        calls.push({ table, query });
        return [];
      },
    } as unknown as AdminSupabaseClient;
    await createSupabaseStaffStore(client).loadWorkspace(shopId, businessId, [shopId]);
    const names = calls.find(({ table }) => table === 'shops');
    expect(names).toBeDefined();
    expect(names?.query.has('business_id')).toBe(false);
    expect(names?.query.get('id')).toBe(`in.(${shopId})`);
    expect(
      calls.find(({ table }) => table === 'employee_shop_assignments')?.query.get('business_id'),
    ).toBe(`eq.${businessId}`);
  });
});
