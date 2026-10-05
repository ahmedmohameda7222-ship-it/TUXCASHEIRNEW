import { AdminAuthError, loadAdminSession } from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

type ShopRow = { id: string; name: string };

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    console.error('Admin staff shop-label request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin staff shop-label request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(request: AdminRequest, response: AdminResponse): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const context = await loadAdminSession(token, client);
    requirePermission(context.principal, 'staff.view');

    if (context.principal.shopIds.length === 0) {
      sendJson(response, 200, { shops: [] });
      return;
    }

    const shops = await client.select<ShopRow[]>(
      'shops',
      new URLSearchParams({
        select: 'id,name',
        business_id: `eq.${context.principal.businessId}`,
        id: `in.(${context.principal.shopIds.join(',')})`,
        order: 'name.asc,id.asc',
      }),
    );
    sendJson(response, 200, { shops });
  } catch (error) {
    handleFailure(response, error);
  }
}
