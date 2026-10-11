import { z } from 'zod';
import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../../server/adminAuthService.js';
import { AdminAuthorizationError } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader, readJsonObject, requireSameOrigin, sendJson,
  type AdminRequest, type AdminResponse,
} from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import { buildSettingsCopyPreview } from '../../server/settings/shopCopyPreview.js';
import { createSettingsService, createSupabaseSettingsStore } from '../../server/settings/settingsService.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

export const shopCopyPreviewSchema = z.object({
  sourceShopId: z.string().uuid(),
  targetShopId: z.string().uuid(),
  selectedDomains: z.array(z.enum(['checkout', 'receipts'])).min(1).max(2),
  expectedTargetSettingsVersion: z.number().int().nonnegative(),
}).strict().refine((value) => value.sourceShopId !== value.targetShopId, {
  message: 'source_and_target_must_differ',
}).refine((value) => new Set(value.selectedDomains).size === value.selectedDomains.length, {
  message: 'duplicate_copy_domain',
});

export default async function handler(request: AdminRequest, response: AdminResponse): Promise<void> {
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
    const parsed = shopCopyPreviewSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_copy_preview_request' });
      return;
    }
    const service = createSettingsService(createSupabaseSettingsStore(client));
    const source = await service.loadSettingsWorkspace(parsed.data.sourceShopId, session.principal);
    const target = await service.loadSettingsWorkspace(parsed.data.targetShopId, session.principal);
    const result = buildSettingsCopyPreview(
      source, target, parsed.data.selectedDomains, parsed.data.expectedTargetSettingsVersion,
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
