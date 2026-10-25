import { describe, expect, it, vi } from 'vitest';

import { createOrderStore } from '../../api/admin/orders';
import type { AdminSupabaseClient } from '../supabaseAdmin';

const shopId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';

function onlineRow(number: number) {
  const id = `33333333-3333-4333-8333-${String(number).padStart(12, '0')}`;
  return {
    id,
    shop_id: shopId,
    status: 'REJECTED',
    customer_name: 'Test customer',
    normalized_phone: null,
    fulfillment_preference: 'PICKUP',
    payment_preference: 'CASH',
    trusted_items: [],
    items_subtotal_minor: 100,
    created_at: '2026-10-25T12:00:00.000Z',
    resolved_at: '2026-10-25T12:05:00.000Z',
    accepted_order_id: null,
    rejection_reason: 'Closed',
    source_fingerprint: null,
    catalog_revision: '1',
  };
}

describe('read-only online request cursor pagination', () => {
  it('returns bounded pages, deterministic next cursor, and preserves tenant and date filters', async () => {
    const select = vi.fn(async (table: string) =>
      table === 'business_shops'
        ? [{ shop_id: shopId }]
        : [onlineRow(3), onlineRow(2), onlineRow(1)],
    );
    const store = createOrderStore({ select } as unknown as AdminSupabaseClient);
    const first = await store.listOnlineOrderRequests({
      shopId,
      businessId,
      status: 'REJECTED',
      from: '2026-10-24T21:00:00.000Z',
      to: '2026-10-25T20:59:59.999Z',
      cursor: null,
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await store.listOnlineOrderRequests({
      shopId,
      businessId,
      status: 'REJECTED',
      from: null,
      to: null,
      cursor: first.nextCursor,
      limit: 2,
    });
    const selects = select.mock.calls as unknown as Array<[string, URLSearchParams]>;
    const firstQuery = selects.find(([table]) => table === 'online_order_requests')?.[1];
    const secondQuery = selects.filter(([table]) => table === 'online_order_requests')[1]?.[1];
    expect(firstQuery?.get('limit')).toBe('3');
    expect(firstQuery?.get('shop_id')).toBe(`eq.${shopId}`);
    expect(firstQuery?.get('resolved_at')).toBe('gte.2026-10-24T21:00:00.000Z');
    expect(firstQuery?.getAll('resolved_at')[1]).toBe('lte.2026-10-25T20:59:59.999Z');
    expect(secondQuery?.get('or')).toContain('created_at.lt.');
    expect(second.rows).toHaveLength(2);
  });

  it('rejects malformed cursors before database selection', async () => {
    const select = vi.fn(async () => [{ shop_id: shopId }]);
    const store = createOrderStore({ select } as unknown as AdminSupabaseClient);
    await expect(
      store.listOnlineOrderRequests({
        shopId,
        businessId,
        status: null,
        from: null,
        to: null,
        cursor: 'not-a-valid-cursor',
        limit: 50,
      }),
    ).rejects.toThrow('invalid_online_request_cursor');
    expect(select).toHaveBeenCalledTimes(1);
  });
});
