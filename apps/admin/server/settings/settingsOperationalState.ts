import type {
  AdminSessionPrincipal,
  SettingsPublishResult,
  ShopOperationalStateUpdateInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import type { AdminSupabaseClient } from '../supabaseAdmin';
import { SettingsServiceError } from './settingsService';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  return numeric;
}

function parsePublishResult(value: unknown): SettingsPublishResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  if (value['ok'] === true) {
    return {
      ok: true,
      settingsVersion: safeInteger(value['settingsVersion'], 1),
      operationsConfigurationVersion: safeInteger(value['operationsConfigurationVersion'], 1),
    };
  }
  if (typeof value['code'] !== 'string') throw new SettingsServiceError('backend_contract_invalid');
  if (value['code'] === 'stale_settings_version') {
    return {
      ok: false,
      code: 'stale_settings_version',
      currentVersion: safeInteger(value['currentVersion']),
    };
  }
  return { ok: false, code: value['code'] };
}

export async function updateShopOperationalState(
  client: AdminSupabaseClient,
  input: ShopOperationalStateUpdateInput,
  principal: AdminSessionPrincipal,
): Promise<SettingsPublishResult> {
  requirePermission(principal, 'settings.manage', input.shopId);
  const result = await client.rpc<unknown>('update_admin_shop_operational_state_v1', {
    p_employee_id: principal.employeeId,
    p_shop_id: input.shopId,
    p_temporary_closed: input.temporaryClosed,
    p_online_orders_paused: input.onlineOrdersPaused,
    p_expected_settings_version: input.expectedSettingsVersion,
  });
  return parsePublishResult(result);
}
