import { z } from 'zod';
import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { buildSettingsCopyPreview, COPYABLE_SETTING_DOMAINS } from './shopCopyPreview.js';
import { createSettingsService, createSupabaseSettingsStore } from './settingsService.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';

export const shopCopyPreviewSchema = z
  .object({
    sourceShopId: z.string().uuid(),
    targetShopId: z.string().uuid(),
    selectedDomains: z
      .array(z.enum(['checkout', 'receipts']))
      .min(1)
      .max(2),
    expectedTargetSettingsVersion: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.sourceShopId !== value.targetShopId, {
    message: 'source_and_target_must_differ',
  })
  .refine((value) => new Set(value.selectedDomains).size === value.selectedDomains.length, {
    message: 'duplicate_copy_domain',
  });

const validCopyKeys = z.enum([
  ...COPYABLE_SETTING_DOMAINS.checkout,
  ...COPYABLE_SETTING_DOMAINS.receipts,
]);

export const shopSettingsCopyApplySchema = z
  .object({
    type: z.literal('settings-copy.apply'),
    sourceShopId: z.string().uuid(),
    targetShopId: z.string().uuid(),
    selectedDomains: z.array(z.enum(['checkout', 'receipts'])).min(1).max(2),
    expectedSourceSettingsVersion: z.number().int().nonnegative(),
    expectedTargetSettingsVersion: z.number().int().nonnegative(),
    expectedChanges: z
      .array(
        z
          .object({
            settingKey: validCopyKeys,
            sourceValue: z.unknown(),
            source: z.enum(['shop', 'business']),
            sourceExpectedVersion: z.number().int().positive(),
            targetValue: z.unknown(),
            targetSource: z.enum(['shop', 'business', 'unset']),
            targetExpectedVersion: z.number().int().positive().nullable(),
            wouldChange: z.boolean(),
          })
          .strict(),
      )
      .max(9),
  })
  .strict()
  .refine((value) => value.sourceShopId !== value.targetShopId, {
    message: 'source_and_target_must_differ',
  })
  .refine((value) => new Set(value.selectedDomains).size === value.selectedDomains.length, {
    message: 'duplicate_copy_domain',
  })
  .refine(
    (value) =>
      new Set(value.expectedChanges.map((change) => change.settingKey)).size ===
      value.expectedChanges.length,
    { message: 'duplicate_copy_key' },
  );

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!requireSameOrigin(request, response)) return;
  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const session = await loadAdminSession(token, client);
    requireSessionCsrf(session, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    let rawCommand: unknown;
    try {
      rawCommand = await readJsonObject(request);
    } catch {
      sendJson(response, 400, { error: 'invalid_copy_preview_request' });
      return;
    }
    if (
      typeof rawCommand === 'object' &&
      rawCommand !== null &&
      'type' in rawCommand &&
      rawCommand.type === 'settings-copy.apply'
    ) {
      const command = shopSettingsCopyApplySchema.safeParse(rawCommand);
      if (!command.success) {
        sendJson(response, 400, { error: 'invalid_settings_copy_request' });
        return;
      }
      requirePermission(session.principal, 'settings.manage', command.data.sourceShopId);
      requirePermission(session.principal, 'settings.manage', command.data.targetShopId);
      const result = await client.rpc<unknown>('apply_admin_shop_settings_copy_v1', {
        p_employee_id: session.principal.employeeId,
        p_source_shop_id: command.data.sourceShopId,
        p_target_shop_id: command.data.targetShopId,
        p_selected_domains: command.data.selectedDomains,
        p_expected_source_settings_version: command.data.expectedSourceSettingsVersion,
        p_expected_target_settings_version: command.data.expectedTargetSettingsVersion,
        p_expected_changes: command.data.expectedChanges,
      });
      if (
        typeof result !== 'object' ||
        result === null ||
        Array.isArray(result) ||
        !('ok' in result) ||
        typeof result.ok !== 'boolean'
      ) {
        sendJson(response, 502, { error: 'backend_contract_invalid' });
        return;
      }
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }
    const parsed = shopCopyPreviewSchema.safeParse(rawCommand);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_copy_preview_request' });
      return;
    }
    const service = createSettingsService(createSupabaseSettingsStore(client));
    const source = await service.loadSettingsWorkspace(parsed.data.sourceShopId, session.principal);
    const target = await service.loadSettingsWorkspace(parsed.data.targetShopId, session.principal);
    const result = buildSettingsCopyPreview(
      source,
      target,
      parsed.data.selectedDomains,
      parsed.data.expectedTargetSettingsVersion,
    );
    sendJson(response, result.ok ? 200 : 409, { ...result });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      sendJson(response, error.status, { error: error.code });
    } else if (error instanceof AdminAuthorizationError) {
      sendJson(response, 403, { error: error.code });
    } else if (
      error instanceof AdminSupabaseError &&
      /TUX_ADMIN_SETTINGS_FORBIDDEN|TUX_ADMIN_SETTINGS_SHOP_FORBIDDEN/.test(error.responseBody)
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
    } else {
      console.error('Admin shop copy preview failed');
      sendJson(response, 502, { error: 'admin_backend_unavailable' });
    }
  }
}
