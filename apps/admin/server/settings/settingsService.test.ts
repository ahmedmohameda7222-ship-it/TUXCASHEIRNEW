import type { AdminSessionPrincipal } from '@tux/admin-contracts';
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

function store(overrides: Partial<SettingsStore> = {}): SettingsStore {
  return {
    getSettingLayers: vi.fn(async () => ({ businessDefault: null, shopOverride: null })),
    shopHasBusinessHistory: vi.fn(async () => false),
    archiveShop: vi.fn(async () => ({ ok: true as const, action: 'ARCHIVED' as const })),
    deleteUnusedShop: vi.fn(async () => ({ ok: true as const, action: 'DELETED' as const })),
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

  it('archives a used shop instead of deleting it', async () => {
    const archiveShop = vi.fn(async () => ({ ok: true as const, action: 'ARCHIVED' as const }));
    const deleteUnusedShop = vi.fn(async () => ({ ok: true as const, action: 'DELETED' as const }));
    const settingsStore = store({
      shopHasBusinessHistory: vi.fn(async () => true),
      archiveShop,
      deleteUnusedShop,
    });
    const service = createSettingsService(settingsStore);

    await expect(service.deleteOrArchiveShop('used-shop', owner)).resolves.toMatchObject({
      ok: true,
      action: 'ARCHIVED',
    });
    expect(archiveShop).toHaveBeenCalledWith({
      businessId: 'business-1',
      shopId: 'used-shop',
      employeeId: 'employee-1',
    });
    expect(deleteUnusedShop).not.toHaveBeenCalled();
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
