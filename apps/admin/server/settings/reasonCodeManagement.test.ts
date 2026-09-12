import type { AdminSessionPrincipal, ReasonCodeWriteInput } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import {
  createSettingsService,
  createSupabaseSettingsStore,
  type SettingsStore,
} from './settingsService';

const owner: AdminSessionPrincipal = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  role: 'OWNER',
  permissions: ['settings.manage'],
  shopIds: ['33333333-3333-4333-8333-333333333333'],
};

const edit: ReasonCodeWriteInput = {
  shopId: '33333333-3333-4333-8333-333333333333',
  reasonCodeId: '44444444-4444-4444-8444-444444444444',
  key: 'customer_changed_mind',
  family: 'CANCELLATION',
  label: 'Customer changed mind',
  active: false,
  expectedVersion: 4,
};

describe('Admin reason-code management', () => {
  it('authorizes and forwards the acting employee through the trusted settings service', async () => {
    const upsertReasonCode = vi.fn(async () => ({
      ok: true as const,
      reasonCodeId: edit.reasonCodeId!,
      version: 5,
    }));
    const service = createSettingsService({ upsertReasonCode } as unknown as SettingsStore);

    await expect(service.upsertReasonCode(edit, owner)).resolves.toEqual({
      ok: true,
      reasonCodeId: edit.reasonCodeId,
      version: 5,
    });
    expect(upsertReasonCode).toHaveBeenCalledWith({ employeeId: owner.employeeId, ...edit });
  });

  it('maps the service-role RPC result without exposing a browser database credential', async () => {
    const rpc = vi.fn(async () => ({
      ok: true,
      reasonCodeId: edit.reasonCodeId,
      version: 5,
    }));
    const store = createSupabaseSettingsStore({ rpc } as unknown as AdminSupabaseClient);

    await expect(
      store.upsertReasonCode({ employeeId: owner.employeeId, ...edit }),
    ).resolves.toEqual({
      ok: true,
      reasonCodeId: edit.reasonCodeId,
      version: 5,
    });
    expect(rpc).toHaveBeenCalledWith('upsert_admin_reason_code_v1', {
      p_employee_id: owner.employeeId,
      p_shop_id: edit.shopId,
      p_reason_code_id: edit.reasonCodeId,
      p_reason_key: edit.key,
      p_family: edit.family,
      p_label: edit.label,
      p_active: edit.active,
      p_expected_version: edit.expectedVersion,
    });
  });
});
