import type { AdminDeliveryZone, AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

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
