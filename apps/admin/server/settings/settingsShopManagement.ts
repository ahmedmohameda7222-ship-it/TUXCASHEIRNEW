import type {
  AdminSessionPrincipal,
  ShopIdentityUpdateInput,
  ShopManagementWriteResult,
  ShopSpecialHoursUpsertInput,
  ShopWeeklyHoursUpsertInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import type { AdminSupabaseClient } from '../supabaseAdmin';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResult(value: unknown): ShopManagementWriteResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    return { ok: false, code: 'backend_contract_invalid' };
  }
  if (value['ok'] === true) {
    return {
      ok: true,
      ...(typeof value['hoursId'] === 'string' ? { hoursId: value['hoursId'] } : {}),
      ...(value['deactivated'] === true ? { deactivated: true } : {}),
    };
  }
  if (typeof value['code'] !== 'string') return { ok: false, code: 'backend_contract_invalid' };
  if (value['code'] === 'stale_settings_version' && typeof value['currentVersion'] === 'number') {
    return { ok: false, code: 'stale_settings_version', currentVersion: value['currentVersion'] };
  }
  return { ok: false, code: value['code'] };
}

export async function updateShopIdentity(
  client: AdminSupabaseClient,
  input: ShopIdentityUpdateInput,
  principal: AdminSessionPrincipal,
): Promise<ShopManagementWriteResult> {
  requirePermission(principal, 'settings.manage', input.shopId);
  return parseResult(
    await client.rpc<unknown>('update_admin_shop_identity_v1', {
      p_employee_id: principal.employeeId,
      p_shop_id: input.shopId,
      p_name: input.name,
      p_address_text: input.address,
      p_contact_phone: input.contactPhone,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_expected_settings_version: input.expectedSettingsVersion,
      p_expected_name: input.expectedIdentity.name,
      p_expected_address_text: input.expectedIdentity.address,
      p_expected_contact_phone: input.expectedIdentity.contactPhone,
      p_expected_latitude: input.expectedIdentity.latitude,
      p_expected_longitude: input.expectedIdentity.longitude,
    }),
  );
}

export async function upsertShopWeeklyHours(
  client: AdminSupabaseClient,
  input: ShopWeeklyHoursUpsertInput,
  principal: AdminSessionPrincipal,
): Promise<ShopManagementWriteResult> {
  requirePermission(principal, 'settings.manage', input.shopId);
  return parseResult(
    await client.rpc<unknown>('upsert_admin_shop_weekly_hours_v1', {
      p_employee_id: principal.employeeId,
      p_shop_id: input.shopId,
      p_hours_id: input.hoursId,
      p_service_kind: input.serviceKind,
      p_day_of_week: input.dayOfWeek,
      p_opens_local: input.opensLocal,
      p_closes_local: input.closesLocal,
      p_active: input.active,
      p_expected_settings_version: input.expectedSettingsVersion,
      p_expected_row: input.expectedRow,
    }),
  );
}

export async function upsertShopSpecialHours(
  client: AdminSupabaseClient,
  input: ShopSpecialHoursUpsertInput,
  principal: AdminSessionPrincipal,
): Promise<ShopManagementWriteResult> {
  requirePermission(principal, 'settings.manage', input.shopId);
  return parseResult(
    await client.rpc<unknown>('upsert_admin_shop_special_hours_v1', {
      p_employee_id: principal.employeeId,
      p_shop_id: input.shopId,
      p_hours_id: input.hoursId,
      p_service_date: input.serviceDate,
      p_service_kind: input.serviceKind,
      p_closed: input.closed,
      p_opens_local: input.opensLocal,
      p_closes_local: input.closesLocal,
      p_note: input.note,
      p_active: input.active,
      p_expected_settings_version: input.expectedSettingsVersion,
      p_expected_row: input.expectedRow,
    }),
  );
}
