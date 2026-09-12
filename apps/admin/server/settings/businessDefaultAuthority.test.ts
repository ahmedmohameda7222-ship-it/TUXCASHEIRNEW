import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createSettingsService, type SettingsStore } from './settingsService';

const owner: AdminSessionPrincipal = {
  employeeId: 'owner-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['settings.manage'],
  shopIds: ['shop-1'],
};

const admin: AdminSessionPrincipal = {
  ...owner,
  employeeId: 'admin-1',
  role: 'ADMIN',
};

const managerWithExplicitOverride: AdminSessionPrincipal = {
  ...owner,
  employeeId: 'manager-1',
  role: 'MANAGER',
};

function settingsStore(upsertBusinessDefault: SettingsStore['upsertBusinessDefault']): SettingsStore {
  return {
    getSettingLayers: vi.fn(async () => ({ businessDefault: null, shopOverride: null })),
    loadWorkspace: vi.fn(),
    publish: vi.fn(),
    deleteOrArchiveShop: vi.fn(),
    upsertBusinessDefault,
    upsertShopOverride: vi.fn(),
    upsertReasonCode: vi.fn(),
    updateOrderType: vi.fn(),
    updatePaymentMethod: vi.fn(),
  } as SettingsStore;
}

const input = {
  shopId: 'shop-1',
  settingKey: 'checkout.taxBps',
  value: 1400,
  expectedVersion: null,
};

describe('business-wide setting default authority', () => {
  it.each([owner, admin])('allows the $role business-wide role', async (principal) => {
    const write = vi.fn(async () => ({ ok: true as const, version: 1 }));
    const service = createSettingsService(settingsStore(write));

    await expect(service.upsertBusinessDefault(input, principal)).resolves.toEqual({
      ok: true,
      version: 1,
    });
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects a shop-scoped manager even when settings.manage was explicitly granted', async () => {
    const write = vi.fn(async () => ({ ok: true as const, version: 1 }));
    const service = createSettingsService(settingsStore(write));

    await expect(service.upsertBusinessDefault(input, managerWithExplicitOverride)).rejects.toThrow(
      /business|owner|admin|forbidden/i,
    );
    expect(write).not.toHaveBeenCalled();
  });
});
