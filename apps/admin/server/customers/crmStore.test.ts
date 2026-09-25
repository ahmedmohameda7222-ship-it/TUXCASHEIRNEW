import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createCrmStore } from './crmStore.js';

const businessId = '10000000-0000-4000-8000-000000000001';
const shopId = '20000000-0000-4000-8000-000000000001';
const survivorId = '30000000-0000-4000-8000-000000000001';
const retiredId = '30000000-0000-4000-8000-000000000002';

function ledgerEvent(id: string, points: number, createdAt: string) {
  return {
    id,
    shop_id: shopId,
    order_id: null,
    event_type: 'MANUAL_ADJUSTMENT' as const,
    points_delta: points,
    monetary_value_minor: 0,
    earn_expires_at: null,
    reason_code_id: null,
    reason_code_key: null,
    reason_label_snapshot: null,
    reason_family_snapshot: null,
    reason_config_version: null,
    reason_note: null,
    source_event_id: null,
    created_at: createdAt,
  };
}

describe('CRM store canonical customer lineage', () => {
  it('shows retired loyalty history while using an unpaginated canonical balance', async () => {
    const survivorEvent = ledgerEvent(
      '40000000-0000-4000-8000-000000000001',
      5,
      '2026-09-24T00:02:00.000Z',
    );
    const retiredEvent = ledgerEvent(
      '40000000-0000-4000-8000-000000000002',
      7,
      '2026-09-24T00:01:00.000Z',
    );

    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'customer_shop_links') {
        return [
          {
            shop_id: shopId,
            canonical_customer_id: survivorId,
            legacy_customer_contact_id: null,
          },
        ];
      }
      if (table === 'business_customers') {
        if (query.get('or')) {
          return [
            { id: survivorId, normalized_phone: '+201000000001', display_name: 'Survivor' },
            { id: retiredId, normalized_phone: '+201000000002', display_name: 'Retired' },
          ];
        }
        return [
          {
            id: survivorId,
            normalized_phone: '+201000000001',
            display_name: 'Survivor',
          },
        ];
      }
      if (table === 'customer_addresses') return [];
      if (table === 'loyalty_ledger') {
        return query.get('customer_id') === `in.(${survivorId},${retiredId})`
          ? [survivorEvent, retiredEvent]
          : [survivorEvent];
      }
      if (table === 'shops') return [{ id: shopId, name: 'Maadi' }];
      if (table === 'orders') return [];
      throw new Error(`unexpected_select:${table}:${query.toString()}`);
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === 'get_admin_customer_loyalty_balance_v1') return 300;
      throw new Error(`unexpected_rpc:${name}`);
    });
    const client = { select, rpc } as unknown as AdminSupabaseClient;
    const store = createCrmStore(client);

    const facts = await store.getCustomerFacts({
      businessId,
      shopId,
      customerId: survivorId,
    });

    expect(facts?.loyaltyHistory.map((entry) => entry.id)).toEqual([
      survivorEvent.id,
      retiredEvent.id,
    ]);
    expect(facts?.loyaltyBalance).toBe(300);

    const ledgerCall = select.mock.calls.find(([table]) => table === 'loyalty_ledger');
    expect(ledgerCall?.[1].get('customer_id')).toBe(`in.(${survivorId},${retiredId})`);
    expect(ledgerCall?.[1].get('limit')).toBe('250');
    expect(rpc).toHaveBeenCalledWith('get_admin_customer_loyalty_balance_v1', {
      p_business_id: businessId,
      p_customer_id: survivorId,
    });
  });

  it('pages all shop links before applying an exact customer search', async () => {
    const linkedIds = Array.from(
      { length: 101 },
      (_, index) =>
        `31000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const targetId = linkedIds[100]!;
    const links = linkedIds.map((canonicalCustomerId) => ({
      shop_id: shopId,
      canonical_customer_id: canonicalCustomerId,
      legacy_customer_contact_id: null,
    }));

    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'customer_shop_links') {
        if (query.get('canonical_customer_id')) {
          return [links[100]];
        }
        const offset = Number(query.get('offset') ?? '0');
        if (offset === 0) return links.slice(0, 100);
        if (offset === 100) return links.slice(100);
        return [];
      }
      if (table === 'business_customers') {
        if (query.get('select') === 'id') {
          return [{ id: targetId }];
        }
        const ids = query.get('id') ?? '';
        const search = query.get('or') ?? '';
        return ids.includes(targetId) && search.includes('Hidden exact customer')
          ? [
              {
                id: targetId,
                normalized_phone: '+201099999999',
                display_name: 'Hidden exact customer',
              },
            ]
          : [];
      }
      if (
        table === 'customer_addresses' ||
        table === 'loyalty_ledger' ||
        table === 'orders'
      ) {
        return [];
      }
      if (table === 'shops') return [{ id: shopId, name: 'Maadi' }];
      throw new Error(`unexpected_select:${table}:${query.toString()}`);
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === 'get_admin_customer_loyalty_balance_v1') return 0;
      throw new Error(`unexpected_rpc:${name}`);
    });
    const store = createCrmStore({ select, rpc } as unknown as AdminSupabaseClient);

    const facts = await store.listCustomerFacts({
      businessId,
      shopId,
      query: 'Hidden exact customer',
    });

    expect(facts.map((customer) => customer.id)).toEqual([targetId]);
    const listLinkCalls = select.mock.calls.filter(
      ([table, query]) =>
        table === 'customer_shop_links' && !query.get('canonical_customer_id'),
    );
    expect(listLinkCalls.map(([, query]) => query.get('offset'))).toEqual(['0', '100']);
  });
});
