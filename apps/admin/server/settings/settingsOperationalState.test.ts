import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { updateShopOperationalState } from './settingsOperationalState';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['settings.manage'],
  shopIds: ['shop-1'],
};

describe('Admin shop operational-state service', () => {
  it('sends the immediate CAS-fenced state change through the trusted RPC', async () => {
    const rpc = vi.fn(async () => ({
      ok: true,
      settingsVersion: 4,
      operationsConfigurationVersion: 9,
    }));
    const client = { rpc } as unknown as AdminSupabaseClient;

    await expect(
      updateShopOperationalState(
        client,
        {
          shopId: 'shop-1',
          temporaryClosed: true,
          onlineOrdersPaused: true,
          expectedSettingsVersion: 3,
        },
        owner,
      ),
    ).resolves.toEqual({
      ok: true,
      settingsVersion: 4,
      operationsConfigurationVersion: 9,
    });

    expect(rpc).toHaveBeenCalledWith('update_admin_shop_operational_state_v1', {
      p_employee_id: 'employee-1',
      p_shop_id: 'shop-1',
      p_temporary_closed: true,
      p_online_orders_paused: true,
      p_expected_settings_version: 3,
    });
  });

  it('enforces settings.manage before reaching the trusted RPC', async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as AdminSupabaseClient;
    const principal = { ...owner, permissions: [] };

    await expect(
      updateShopOperationalState(
        client,
        {
          shopId: 'shop-1',
          temporaryClosed: true,
          onlineOrdersPaused: false,
          expectedSettingsVersion: 3,
        },
        principal,
      ),
    ).rejects.toMatchObject({ code: 'permission_forbidden' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
