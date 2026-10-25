import { describe, expect, it, vi } from 'vitest';
import { createOrderStore } from '../../api/admin/orders';
import type { AdminSupabaseClient } from '../supabaseAdmin';

const shopId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

function setup() {
  const select = vi.fn(async (table: string, query: URLSearchParams) => {
    if (table === 'business_shops') return [{ shop_id: shopId }];
    if (table === 'orders') return [];
    throw new Error(`Unexpected table: ${table} ${query.toString()}`);
  });
  return { store: createOrderStore({ select } as unknown as AdminSupabaseClient), select };
}

describe('Orders cursor/search query composition', () => {
  it('ANDs cursor boundary with text search rather than duplicating PostgREST or parameters', async () => {
    const { store, select } = setup();
    const cursor = Buffer.from(
      JSON.stringify(['2026-10-24T14:30:00.000Z', '44444444-4444-4444-8444-444444444444']),
      'utf8',
    ).toString('base64url');
    await store.searchOrders({
      businessId,
      shopId,
      employeeId,
      cursor,
      query: 'Mona',
      statuses: ['DONE'],
      source: 'POS',
      limit: 25,
    });

    const calls = select.mock.calls as unknown as Array<[string, URLSearchParams]>;
    const query = calls.find(([table]) => table === 'orders')?.[1];
    expect(query).toBeDefined();
    expect(query!.getAll('or')).toEqual([]);
    expect(query!.get('and')).toContain('or(created_at.lt.');
    expect(query!.get('and')).toContain('or(customer_name_snapshot.ilike.*Mona*');
    expect(query!.get('status')).toBe('in.(DONE)');
    expect(query!.get('source')).toBe('eq.POS');
  });

  it('recognizes #42 as a display number without losing cursor isolation', async () => {
    const { store, select } = setup();
    const cursor = Buffer.from(
      JSON.stringify(['2026-10-24T14:30:00.000Z', '44444444-4444-4444-8444-444444444444']),
    ).toString('base64url');
    await store.searchOrders({ businessId, shopId, employeeId, cursor, query: '#42' });
    const calls = select.mock.calls as unknown as Array<[string, URLSearchParams]>;
    const query = calls.find(([table]) => table === 'orders')?.[1];
    expect(query?.get('and')).toContain('display_order_no.eq.42');
  });
  it('matches an exact immutable order UUID without searching customer names', async () => {
    const { store, select } = setup();
    const orderId = '44444444-4444-4444-8444-444444444444';
    await store.searchOrders({ businessId, shopId, employeeId, query: orderId });
    const calls = select.mock.calls as unknown as Array<[string, URLSearchParams]>;
    const query = calls.find(([table]) => table === 'orders')?.[1];
    expect(query?.get('id')).toBe(`eq.${orderId}`);
    expect(query?.getAll('or')).toEqual([]);
  });

});
