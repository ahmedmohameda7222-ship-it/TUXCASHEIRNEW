import type { AdminSessionPrincipal, AdminSettingsWorkspace } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createSettingsService,
  resolveAllowedPaymentMethods,
  type SettingsStore,
} from './settingsService';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['settings.manage', 'shops.manage'],
  shopIds: ['shop-1', 'used-shop'],
};

const workspace: AdminSettingsWorkspace = {
  shop: {
    id: 'shop-1',
    name: 'TUX',
    lifecycleState: 'ACTIVE',
    active: true,
    address: null,
    contactPhone: null,
    latitude: null,
    longitude: null,
    timezone: 'Africa/Cairo',
    temporaryClosed: false,
    onlineOrdersPaused: false,
  },
  settingsVersion: 0,
  businessDefaults: [],
  shopOverrides: [],
  orderTypes: [],
  paymentMethods: [],
  deliveryZones: [],
  reasonCodes: [],
  weeklyHours: [],
  specialHours: [],
};

function store(overrides: Partial<SettingsStore> = {}): SettingsStore {
  return {
    getSettingLayers: vi.fn(async () => ({ businessDefault: null, shopOverride: null })),
    loadWorkspace: vi.fn(async () => workspace),
    publish: vi.fn(async () => ({
      ok: true as const,
      settingsVersion: 1,
      operationsConfigurationVersion: 7,
    })),
    deleteOrArchiveShop: vi.fn(async () => ({ ok: true as const, action: 'ARCHIVED' as const })),
    upsertBusinessDefault: vi.fn(async () => ({ ok: true as const, version: 1 })),
    upsertShopOverride: vi.fn(async () => ({ ok: true as const, version: 1 })),
    updateOrderType: vi.fn(async () => ({ ok: true as const, editVersion: 2 })),
    updatePaymentMethod: vi.fn(async () => ({ ok: true as const, editVersion: 2 })),
    ...overrides,
  };
}

describe('Admin settings service', () => {
  it('resolves shop override before business default', async () => {
    const settingsStore = store({
      getSettingLayers: vi.fn(async () => ({
        businessDefault: 500,
        shopOverride: 700,
      })),
    });
    const service = createSettingsService(settingsStore);

    await expect(
      service.resolveSetting('serviceChargeBps', {
        businessId: 'business-1',
        shopId: 'shop-1',
      }),
    ).resolves.toEqual({ source: 'shop', value: 700 });
  });

  it('uses the atomic trusted shop archive/delete boundary', async () => {
    const deleteOrArchiveShop = vi.fn(async () => ({
      ok: true as const,
      action: 'ARCHIVED' as const,
    }));
    const service = createSettingsService(store({ deleteOrArchiveShop }));

    await expect(service.deleteOrArchiveShop('used-shop', owner)).resolves.toMatchObject({
      ok: true,
      action: 'ARCHIVED',
    });
    expect(deleteOrArchiveShop).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'used-shop',
    });
  });

  it('publishes and writes settings through version-fenced trusted store commands', async () => {
    const publish = vi.fn(async () => ({
      ok: true as const,
      settingsVersion: 5,
      operationsConfigurationVersion: 9,
    }));
    const upsertShopOverride = vi.fn(async () => ({ ok: true as const, version: 3 }));
    const service = createSettingsService(store({ publish, upsertShopOverride }));

    await expect(service.publishSettings('shop-1', 4, owner)).resolves.toMatchObject({
      ok: true,
      settingsVersion: 5,
    });
    await expect(
      service.upsertShopOverride(
        {
          shopId: 'shop-1',
          settingKey: 'receipt.orderPrefix',
          value: 'MD-',
          expectedVersion: 2,
        },
        owner,
      ),
    ).resolves.toEqual({ ok: true, version: 3 });
    expect(publish).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-1',
      expectedSettingsVersion: 4,
    });
    expect(upsertShopOverride).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-1',
      settingKey: 'receipt.orderPrefix',
      value: 'MD-',
      expectedVersion: 2,
    });
  });

  it('updates a canonical order type through a shop and row version-fenced trusted command', async () => {
    const updateOrderType = vi.fn(async () => ({ ok: true as const, editVersion: 3 }));
    const service = createSettingsService(store({ updateOrderType }));
    const input = {
      shopId: 'shop-1',
      orderTypeId: 'order-type-1',
      name: 'Pick up',
      behavior: 'TAKE_AWAY' as const,
      active: true,
      sortOrder: 1,
      expectedSettingsVersion: 4,
      expectedEditVersion: 2,
    };

    await expect(service.updateOrderType(input, owner)).resolves.toEqual({
      ok: true,
      editVersion: 3,
    });
    expect(updateOrderType).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      ...input,
    });
  });

  it('updates only approved payment configuration fields through the trusted command', async () => {
    const updatePaymentMethod = vi.fn(async () => ({ ok: true as const, editVersion: 8 }));
    const service = createSettingsService(store({ updatePaymentMethod }));
    const input = {
      shopId: 'shop-1',
      paymentMethodId: 'payment-method-1',
      displayName: 'InstaPay',
      active: true,
      sortOrder: 2,
      channel: 'ONLINE' as const,
      requiresReference: true,
      manualConfirmationRequired: true,
      refundAllowed: false,
      expectedSettingsVersion: 4,
      expectedEditVersion: 7,
    };

    await expect(service.updatePaymentMethod(input, owner)).resolves.toEqual({
      ok: true,
      editVersion: 8,
    });
    expect(updatePaymentMethod).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      ...input,
    });
    expect(updatePaymentMethod).not.toHaveBeenCalledWith(
      expect.objectContaining({ logicType: expect.anything() }),
    );
    expect(updatePaymentMethod).not.toHaveBeenCalledWith(
      expect.objectContaining({ requiresReconciliation: expect.anything() }),
    );
  });

  it('rejects an ONLINE checkout method configured for POS only', () => {
    const methods = [
      {
        id: 'cash',
        displayName: 'Cash',
        active: true,
        channel: 'POS' as const,
      },
    ];

    expect(resolveAllowedPaymentMethods(methods, { channel: 'ONLINE' })).toEqual([]);
    expect(resolveAllowedPaymentMethods(methods, { channel: 'POS' })).toEqual(methods);
  });
});
