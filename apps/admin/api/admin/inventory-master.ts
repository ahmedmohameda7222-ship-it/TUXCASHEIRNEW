import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requireBusinessWidePermission } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuid = z.string().uuid();
const bindSchema = z
  .object({
    type: z.literal('master.bind'),
    shopId: uuid,
    inventoryItemId: uuid,
    masterInventoryItemId: uuid.nullable(),
    canonicalName: z.string().trim().min(1).max(160).nullable(),
    commandId: z.string().trim().min(1).max(160),
  })
  .strict()
  .refine(
    (input) =>
      (input.masterInventoryItemId === null && input.canonicalName !== null) ||
      (input.masterInventoryItemId !== null && input.canonicalName === null),
  );

export { bindSchema as inventoryMasterBindSchema };

type BindingResult = {
  ok: boolean;
  code?: string;
  masterInventoryItemId?: string;
  replayed?: boolean;
};
type BindingMaster = {
  id: string;
  canonicalName: string;
  baseUnitLabel: string;
  trackingMode: 'RECIPE_TRACKED';
  inventoryItemId: string | null;
  inventoryItemName: string | null;
};
export type InventoryMasterList = {
  ok: true;
  shopId: string;
  masters: BindingMaster[];
};

async function authorized(
  request: AdminRequest,
  client: AdminSupabaseClient,
  shopId: string,
  mutation: boolean,
) {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (mutation) {
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  }
  for (const permission of ['inventory.view', 'inventory.adjust', 'catalog.edit'] as const) {
    requireBusinessWidePermission(context.principal, permission, shopId);
  }
  return context;
}

function respondFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_inventory_master_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (
      error.responseBody.includes('TUX_ADMIN_CATALOG_FORBIDDEN') ||
      error.responseBody.includes('inventory_master_owner_required')
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    console.error('Inventory master backend failure', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Inventory master request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuid.parse(url.searchParams.get('shopId'));
      const context = await authorized(request, client, shopId, false);
      const result = await client.rpc<InventoryMasterList>('list_admin_inventory_masters_v1', {
        p_employee_id: context.principal.employeeId,
        p_shop_id: shopId,
      });
      sendJson(response, 200, result);
      return;
    }
    if (!requireSameOrigin(request, response)) return;
    const input = bindSchema.parse(await readJsonObject(request));
    const context = await authorized(request, client, input.shopId, true);
    const result = await client.rpc<BindingResult>('bind_admin_inventory_master_v1', {
      p_employee_id: context.principal.employeeId,
      p_shop_id: input.shopId,
      p_inventory_item_id: input.inventoryItemId,
      p_master_inventory_item_id: input.masterInventoryItemId,
      p_canonical_name: input.canonicalName,
      p_command_id: input.commandId,
    });
    const code = result.code ?? '';
    const status = result.ok
      ? 200
      : code.includes('conflict') || code.includes('bound')
        ? 409
        : code.includes('not_found')
          ? 404
          : 400;
    sendJson(response, status, result);
  } catch (error) {
    respondFailure(response, error);
  }
}
