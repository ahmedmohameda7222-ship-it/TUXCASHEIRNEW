import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import {
  createRecurringAvailabilityService,
  type RecurringAvailabilityStore,
} from './recurringAvailabilityService';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish'],
  shopIds: ['shop-a'],
};

function recurringStore(): RecurringAvailabilityStore {
  return {
    loadWorkspace: vi.fn().mockResolvedValue({
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
    saveRule: vi.fn().mockResolvedValue({
      ok: true,
      ruleId: 'rule-1',
      version: 2,
      timezone: 'Africa/Cairo',
      active: false,
    }),
  };
}

describe('Admin recurring availability service', () => {
  it('loads recurring rules only with catalog.view and explicit shop scope', async () => {
    const store = recurringStore();
    const service = createRecurringAvailabilityService(store);

    await expect(service.loadRecurringAvailability('shop-a', owner)).resolves.toMatchObject({
      shopId: 'shop-a',
      rules: [{ id: 'rule-1', timezone: 'Africa/Cairo' }],
    });
    expect(store.loadWorkspace).toHaveBeenCalledWith('shop-a', 'business-1');

    await expect(service.loadRecurringAvailability('shop-b', owner)).rejects.toThrow(
      /shop_forbidden/,
    );
  });

  it('saves and deactivates a rule with catalog.edit and the authenticated employee identity', async () => {
    const store = recurringStore();
    const service = createRecurringAvailabilityService(store);
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

    await expect(service.saveRecurringAvailabilityRule(input, owner)).resolves.toMatchObject({
      ok: true,
      ruleId: 'rule-1',
      version: 2,
      active: false,
    });
    expect(store.saveRule).toHaveBeenCalledWith({
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
    const store = recurringStore();
    const service = createRecurringAvailabilityService(store);
    const viewer: AdminSessionPrincipal = { ...owner, permissions: ['catalog.view'] };

    await expect(
      service.saveRecurringAvailabilityRule(
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
    expect(store.saveRule).not.toHaveBeenCalled();
  });
});
