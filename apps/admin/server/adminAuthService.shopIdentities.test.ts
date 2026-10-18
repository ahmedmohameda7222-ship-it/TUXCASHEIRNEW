import { describe, expect, it } from 'vitest';

import { loadAdminSession } from './adminAuthService';
import type { AdminSupabaseClient } from './supabaseAdmin';

const token = 'a'.repeat(64);

function sessionClient(role: 'OWNER' | 'MANAGER', failNames = false) {
  const calls: Array<{ table: string; query: string }> = [];
  const client = {
    async select(table: string, query: URLSearchParams) {
      calls.push({ table, query: query.toString() });
      if (table === 'admin_sessions') {
        return [{
          id: 'session-1', business_id: 'biz-1', employee_id: 'emp-1',
          csrf_token_hash: 'b'.repeat(64), expires_at: '2099-01-01T00:00:00.000Z',
          revoked_at: null, reauthenticated_at: null,
        }];
      }
      if (table === 'business_employees') {
        return [{
          id: 'emp-1', business_id: 'biz-1', display_name: 'Manager',
          role, pin_hash: 'hash', active: true,
        }];
      }
      if (table === 'business_shops') {
        return [{ shop_id: 'shop-a' }, { shop_id: 'shop-b' }];
      }
      if (table === 'employee_shop_assignments') {
        return [{ shop_id: 'shop-b' }, { shop_id: 'shop-a' }];
      }
      if (table === 'admin_role_permissions') return [{ permission_key: 'orders.view' }];
      if (table === 'admin_employee_permissions') return [];
      if (table === 'shops') {
        if (failNames) throw new Error('shop_metadata_unavailable');
        return [
          { id: 'shop-a', name: 'TUX Maadi', active: true, temporary_closed: false },
          { id: 'shop-b', name: 'TUX Zamalek', active: false, temporary_closed: true },
          { id: 'shop-secret', name: 'Secret Shop', active: true, temporary_closed: false },
        ];
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as AdminSupabaseClient;
  return { client, calls };
}

describe('authorized shop identity projection', () => {
  for (const role of ['OWNER', 'MANAGER'] as const) {
    it(`returns names for the ${role} scope without granting Settings rights`, async () => {
      const { client, calls } = sessionClient(role);
      const result = await loadAdminSession(token, client, undefined, true);
      const expectedShops = [
        { id: 'shop-a', name: 'TUX Maadi', active: true, temporaryClosed: false },
        { id: 'shop-b', name: 'TUX Zamalek', active: false, temporaryClosed: true },
      ];
      expect(result.principal.shopSummaries).toEqual(
        role === 'OWNER' ? expectedShops : [...expectedShops].reverse(),
      );
      expect(result.principal.shopSummaries).not.toContainEqual(
        expect.objectContaining({ name: 'Secret Shop' }),
      );
      expect(result.principal.shopIds).toEqual(
        role === 'OWNER' ? ['shop-a', 'shop-b'] : ['shop-b', 'shop-a'],
      );
      expect(calls.filter((call) => call.table === 'shops')).toHaveLength(1);
      expect(calls.find((call) => call.table === 'shops')?.query).toContain(
        role === 'OWNER'
          ? 'id=in.%28shop-a%2Cshop-b%29'
          : 'id=in.%28shop-b%2Cshop-a%29',
      );
      if (role === 'MANAGER') {
        expect(result.principal.permissions).not.toContain('settings.manage');
      }
    });
  }

  it('does not query shops for ordinary authorized API session checks', async () => {
    const { client, calls } = sessionClient('MANAGER');
    const result = await loadAdminSession(token, client);
    expect(result.principal.shopIds).toEqual(['shop-b', 'shop-a']);
    expect(calls.some((call) => call.table === 'shops')).toBe(false);
  });

  it('keeps authentication usable when the optional shop-label query fails', async () => {
    const { client } = sessionClient('MANAGER', true);
    const result = await loadAdminSession(token, client);
    expect(result.principal.shopIds).toEqual(['shop-b', 'shop-a']);
    expect(result.principal.shopSummaries).toEqual([]);
  });
});
