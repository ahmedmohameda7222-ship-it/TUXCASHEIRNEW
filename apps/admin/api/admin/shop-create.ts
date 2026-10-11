import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService.js';
import {
  AdminAuthorizationError,
  requireBusinessWidePermission,
} from '../../server/authorization.js';
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

export const shopCreateCommandSchema = z
  .object({
    contextShopId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(500).nullable(),
    contactPhone: z.string().trim().max(80).nullable(),
    commandId: z.string().trim().min(1).max(160),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCreateResult(value: unknown):
  | { ok: true; shopId: string; idempotentReplay: boolean }
  | { ok: false; code: string } {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new Error('backend_contract_invalid');
  }
  if (value['ok'] === false) {
    if (typeof value['code'] !== 'string') throw new Error('backend_contract_invalid');
    return { ok: false, code: value['code'] };
  }
  if (typeof value['shopId'] !== 'string' || !z.string().uuid().safeParse(value['shopId']).success) {
    throw new Error('backend_contract_invalid');
  }
  return {
    ok: true,
    shopId: value['shopId'],
    idempotentReplay: value['idempotentReplay'] === true,
  };
}

async function requirePrincipal(
  request: AdminRequest,
  client: AdminSupabaseClient,
): Promise<AdminSessionPrincipal> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const session = await loadAdminSession(token, client);
  requireSessionCsrf(session, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  return session.principal;
}

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
    const principal = await requirePrincipal(request, client);
    let command: unknown;
    try {
      command = await readJsonObject(request);
    } catch {
      sendJson(response, 400, { error: 'invalid_shop_create_request' });
      return;
    }
    const parsed = shopCreateCommandSchema.safeParse(command);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_shop_create_request' });
      return;
    }
    requireBusinessWidePermission(principal, 'shops.manage', parsed.data.contextShopId);
    const result = parseCreateResult(
      await client.rpc<unknown>('create_admin_shop_v1', {
        p_employee_id: principal.employeeId,
        p_context_shop_id: parsed.data.contextShopId,
        p_name: parsed.data.name,
        p_address_text: parsed.data.address,
        p_contact_phone: parsed.data.contactPhone,
        p_command_id: parsed.data.commandId,
      }),
    );
    sendJson(response, 200, { ...result });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      sendJson(response, error.status, { error: error.code });
    } else if (error instanceof AdminAuthorizationError) {
      sendJson(response, 403, { error: error.code });
    } else if (
      error instanceof AdminSupabaseError &&
      /TUX_ADMIN_PERMISSION_DENIED|TUX_ADMIN_BUSINESS_WIDE_PERMISSION_REQUIRED|TUX_ADMIN_SETTINGS_FORBIDDEN/.test(
        error.responseBody,
      )
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
    } else if (error instanceof AdminSupabaseError) {
      console.error('Admin shop creation database request failed', { status: error.status });
      sendJson(response, 502, { error: 'admin_backend_unavailable' });
    } else {
      console.error('Admin shop creation request failed');
      sendJson(response, 502, { error: 'admin_backend_unavailable' });
    }
  }
}
