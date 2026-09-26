import type { AdminDeliveryZone, AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createDeliveryStore } from './deliveryApi.js';
import {
  allowedDeliveryTransition,
  createDeliveryService,
  riderCanBeAssigned,
  type DeliveryStore,
} from './deliveryService.js';

const shopId = '10000000-0000-4000-8000-000000000001';
const fallbackShopId = '10000000-0000-4000-8000-000000000002';

const principal: AdminSessionPrincipal = {
  employeeId: '20000000-0000-4000-8000-000000000001',
  businessId: '30000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['delivery.view', 'delivery.manage'],
  shopIds: [shopId, fallbackShopId],
};

function zone(
  id: string,
  shop: string,
  priority: number,
  overrides: Partial<AdminDeliveryZone> = {},
): AdminDeliveryZone {
  return {
    id,
    shopId: shop,
    name: `Zone ${id}`,
    feeMinor: 1500,
    minimumOrderMinor: 5000,
    priority,
    active: true,
    boundary: {
      kind: 'RADIUS',
      latitude: 30,
      longitude: 31,
      radiusMeters: 1000,
    },
    fallbackShopId: null,
    fallbackEnabled: false,
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

function storeWith(
  input: {
    available?: boolean;
    zones?: readonly AdminDeliveryZone[];
    fallback?: boolean;
    open?: boolean;
  } = {},
): DeliveryStore {
  const fallbackZone = zone('f', fallbackShopId, 5);
  return {
    loadWorkspace: vi.fn(),
    loadRoutingContext: vi.fn().mockResolvedValue({
      requestedShopAvailable: input.available ?? true,
      requestedShopHours: [
        {
          dayOfWeek: 3,
          opensLocal: '00:00',
          closesLocal: '23:59',
          active: input.open ?? true,
        },
      ],
      zones: input.zones ?? [zone('a', shopId, 1)],
      fallbackShops: input.fallback
        ? {
            [fallbackShopId]: {
              available: true,
              hours: [
                {
                  dayOfWeek: 3,
                  opensLocal: '00:00',
                  closesLocal: '23:59',
                  active: true,
                },
              ],
              zones: [fallbackZone],
            },
          }
        : {},
    }),
    upsertZone: vi.fn(),
    upsertRider: vi.fn(),
    transitionOrder: vi.fn(),
  };
}

const at = '2026-09-23T10:00:00.000Z';

describe('Plan 5 delivery authority', () => {
  it('surfaces a newly placed delivery order before its first dispatch transition', async () => {
    const newOrderId = '88000000-0000-4000-8000-000000000099';
    const updatedAt = '2026-09-24T06:45:00.000Z';
    const select = vi.fn(async (table: string) => {
      if (
        table === 'delivery_zones' ||
        table === 'delivery_riders' ||
        table === 'delivery_order_states'
      ) {
        return [];
      }
      if (table === 'orders') {
        return [
          {
            id: newOrderId,
            shop_id: shopId,
            updated_at: updatedAt,
          },
        ];
      }
      throw new Error(`unexpected table ${table}`);
    });
    const store = createDeliveryStore({ select } as unknown as AdminSupabaseClient);

    await expect(
      store.loadWorkspace({ businessId: principal.businessId, shopId }),
    ).resolves.toMatchObject({
      orders: [
        {
          orderId: newOrderId,
          shopId,
          riderId: null,
          state: 'UNASSIGNED',
          version: 1,
          updatedAt,
        },
      ],
    });
  });

  it('keeps actionable delivery state visible beyond recent terminal history', async () => {
    const actionableOrderId = '88000000-0000-4000-8000-000000000098';
    const terminalRows = Array.from({ length: 500 }, (_, index) => ({
      order_id: `87000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      shop_id: shopId,
      rider_id: null,
      state: 'DELIVERED' as const,
      version: 2,
      updated_at: `2026-09-24T${String(23 - (index % 20)).padStart(2, '0')}:00:00.000Z`,
    }));
    const actionableRow = {
      order_id: actionableOrderId,
      shop_id: shopId,
      rider_id: null,
      state: 'ASSIGNED' as const,
      version: 3,
      updated_at: '2026-09-20T06:00:00.000Z',
    };
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'delivery_zones' || table === 'delivery_riders') return [];
      if (table === 'delivery_order_states') {
        if (query.get('state') === 'in.(UNASSIGNED,ASSIGNED,OUT_FOR_DELIVERY)') {
          return Number(query.get('offset') ?? '0') === 0 ? [actionableRow] : [];
        }
        if (query.get('state') === 'in.(DELIVERED,FAILED,RETURNED)') return terminalRows;
        return terminalRows;
      }
      if (table === 'orders') return [];
      throw new Error(`unexpected table ${table}`);
    });
    const store = createDeliveryStore({ select } as unknown as AdminSupabaseClient);

    const workspace = await store.loadWorkspace({
      businessId: principal.businessId,
      shopId,
    });

    expect(workspace.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: actionableOrderId, state: 'ASSIGNED' }),
      ]),
    );
  });

  it('pages canonical delivery orders so an older uninitialized order stays dispatchable', async () => {
    const olderOrderId = '88000000-0000-4000-8000-000000000097';
    const recentOrders = Array.from({ length: 500 }, (_, index) => ({
      id: `86000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      shop_id: shopId,
      updated_at: '2026-09-24T08:00:00.000Z',
    }));
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (
        table === 'delivery_zones' ||
        table === 'delivery_riders' ||
        table === 'delivery_order_states'
      ) {
        return [];
      }
      if (table === 'orders') {
        const offset = Number(query.get('offset') ?? '0');
        if (offset === 0) return recentOrders;
        if (offset === 500) {
          return [
            {
              id: olderOrderId,
              shop_id: shopId,
              updated_at: '2026-09-20T08:00:00.000Z',
            },
          ];
        }
        return [];
      }
      throw new Error(`unexpected table ${table}`);
    });
    const store = createDeliveryStore({ select } as unknown as AdminSupabaseClient);

    const workspace = await store.loadWorkspace({
      businessId: principal.businessId,
      shopId,
    });

    expect(workspace.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: olderOrderId, state: 'UNASSIGNED' }),
      ]),
    );
  });

  it('uses priority when delivery zones overlap', async () => {
    const service = createDeliveryService(
      storeWith({
        zones: [
          zone('low', shopId, 1, { feeMinor: 1000 }),
          zone('high', shopId, 10, { feeMinor: 2000 }),
        ],
      }),
    );
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 10000,
          at,
        },
        principal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      zoneId: 'high',
      feeMinor: 2000,
      fallbackUsed: false,
    });
  });

  it('never falls back unless the primary zone explicitly enables it', async () => {
    const service = createDeliveryService(storeWith({ available: false, fallback: true }));
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 10000,
          at,
        },
        principal,
      ),
    ).resolves.toEqual({ ok: false, code: 'delivery_unavailable' });
  });

  it('uses only the explicitly configured fallback shop', async () => {
    const primary = zone('primary', shopId, 1, {
      fallbackEnabled: true,
      fallbackShopId,
    });
    const service = createDeliveryService(
      storeWith({ available: false, fallback: true, zones: [primary] }),
    );
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 10000,
          at,
        },
        principal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      shopId: fallbackShopId,
      fallbackUsed: true,
    });
  });

  it('rejects delivery while the requested shop delivery hours are closed', async () => {
    const service = createDeliveryService(storeWith({ open: false }));
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 10000,
          at,
        },
        principal,
      ),
    ).resolves.toEqual({ ok: false, code: 'delivery_closed' });
  });

  it('rejects routing outside the principal shop scope', async () => {
    const service = createDeliveryService(storeWith());
    const scopedPrincipal = { ...principal, shopIds: [fallbackShopId] };
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 10000,
          at,
        },
        scopedPrincipal,
      ),
    ).rejects.toThrow();
  });

  it('recomputes minimum order from the matched canonical zone', async () => {
    const service = createDeliveryService(storeWith());
    await expect(
      service.routeAddress(
        {
          requestedShopId: shopId,
          latitude: 30,
          longitude: 31,
          subtotalMinor: 4999,
          at,
        },
        principal,
      ),
    ).resolves.toEqual({ ok: false, code: 'minimum_order_not_met' });
  });

  it('validates the rider lifecycle', () => {
    expect(allowedDeliveryTransition('UNASSIGNED', 'ASSIGNED')).toBe(true);
    expect(allowedDeliveryTransition('ASSIGNED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(allowedDeliveryTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(allowedDeliveryTransition('OUT_FOR_DELIVERY', 'FAILED')).toBe(true);
    expect(allowedDeliveryTransition('OUT_FOR_DELIVERY', 'RETURNED')).toBe(true);
    expect(allowedDeliveryTransition('DELIVERED', 'ASSIGNED')).toBe(false);
    expect(riderCanBeAssigned({ active: true, state: 'AVAILABLE' })).toBe(true);
    expect(riderCanBeAssigned({ active: false, state: 'AVAILABLE' })).toBe(false);
  });
});
