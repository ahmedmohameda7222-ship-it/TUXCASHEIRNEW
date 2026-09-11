import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { createCatalogService, type CatalogStore } from './catalogService';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish'],
  shopIds: ['shop-a'],
};

type RecurringStore = CatalogStore & {
  loadRecurringAvailability(shopId: string, businessId: string): Promise<unknown>;
  saveRecurringAvailabilityRule(input: Readonly<Record<string, unknown>>): Promise<unknown>;
};

type RecurringService = ReturnType<typeof createCatalogService> & {
  loadRecurringAvailability(
    shopId: string,
    principal: AdminSessionPrincipal,
  ): Promise<unknown>;
  saveRecurringAvailabilityRule(
    input: Readonly<Record<string, unknown>>,
    principal: AdminSessionPrincipal,
  ): Promise<unknown>;
};

function recurringStore(): RecurringStore {
  return {
    getCurrentPublishVersion: vi.fn().mockResolvedValue(48),
    loadWorkspace: vi.fn(),
    loadPublishing: vi.fn(),
    createDraft: vi.fn(),
    saveDraftChange: vi.fn(),
    publishDraft: vi.fn(),
    setImmediateAvailability: vi.fn(),
    restoreVersion: vi.fn(),
    scheduleDraft: vi.fn(),
    cancelSchedule: vi.fn(),
    loadRecurringAvailability: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      products: [
        {
          masterProductId: 'master-product-1',
          productId: 'product-1',
          name: 'Classic Smash',
          manualSoldOut: false,
        },
      ],
      rules: [
        {
          id: 'rule-1',
          shopId: 'shop-a',
          masterProductId: 'master-product-1',
          timezone: 'Africa/Cairo',
          daysOfWeek: [5],
          startLocal: '22:00:00',
          endLocal: '02:00:00',
          available: true,
          active: true,
          version: 1,
          updatedAt: '2026-09-11T18:00:00.000Z',
        },
      ],
    }),
    saveRecurringAvailabilityRule: vi.fn().mockResolvedValue({
      ok: true,
      ruleId: 'rule-1',
      version: 2,
      timezone: 'Africa/Cairo',
      active: false,
    }),
  } as RecurringStore;
}

function service(catalogStore: RecurringStore): RecurringService {
  return createCatalogService(catalogStore) as RecurringService;
}

describe('Admin recurring availability service', () => {
  it('loads recurring rules only with catalog.view and explicit shop scope', async () => {
    const catalogStore = recurringStore();
    const catalogService = service(catalogStore);

    await expect(catalogService.loadRecurringAvailability('shop-a', owner)).resolves.toMatchObject({
      shopId: 'shop-a',
      rules: [{ id: 'rule-1', timezone: 'Africa/Cairo' }],
    });
    expect(catalogStore.loadRecurringAvailability).toHaveBeenCalledWith('shop-a', 'business-1');

    await expect(catalogService.loadRecurringAvailability('shop-b', owner)).rejects.toThrow(
      /shop_forbidden/,
    );
  });

  it('saves and deactivates a rule with catalog.edit and the authenticated employee identity', async () => {
    const catalogStore = recurringStore();
    const catalogService = service(catalogStore);
    const input = {
      shopId: 'shop-a',
      ruleId: 'rule-1',
      masterProductId: 'master-product-1',
      daysOfWeek: [5],
      startLocal: '22:00',
      endLocal: '02:00',
      available: true,
      active: false,
      expectedVersion: 1,
    };

    await expect(catalogService.saveRecurringAvailabilityRule(input, owner)).resolves.toMatchObject({
      ok: true,
      ruleId: 'rule-1',
      version: 2,
      active: false,
    });
    expect(catalogStore.saveRecurringAvailabilityRule).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-a',
      ruleId: 'rule-1',
      masterProductId: 'master-product-1',
      daysOfWeek: [5],
      startLocal: '22:00',
      endLocal: '02:00',
      available: true,
      active: false,
      expectedVersion: 1,
    });
  });

  it('rejects rule mutation without catalog.edit before the trusted RPC', async () => {
    const catalogStore = recurringStore();
    const catalogService = service(catalogStore);
    const viewer: AdminSessionPrincipal = { ...owner, permissions: ['catalog.view'] };

    await expect(
      catalogService.saveRecurringAvailabilityRule(
        {
          shopId: 'shop-a',
          ruleId: null,
          masterProductId: 'master-product-1',
          daysOfWeek: [1, 2, 3],
          startLocal: '10:00',
          endLocal: '14:00',
          available: true,
          active: true,
          expectedVersion: null,
        },
        viewer,
      ),
    ).rejects.toThrow(/permission_forbidden/);
    expect(catalogStore.saveRecurringAvailabilityRule).not.toHaveBeenCalled();
  });
});
