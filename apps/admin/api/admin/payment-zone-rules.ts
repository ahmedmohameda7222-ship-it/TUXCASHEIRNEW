import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
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

export const paymentZoneRuleCommandSchema = z
  .object({
    type: z.literal('payment-zone.upsert'),
    shopId: uuid,
    paymentMethodId: uuid,
    deliveryZoneId: uuid,
    allowed: z.boolean(),
    expectedAllowed: z.boolean().nullable(),
    expectedSettingsVersion: z.number().int().nonnegative(),
  })
  .strict();

export function assertPaymentZoneScope(principal: AdminSessionPrincipal, shopId: string): void {
  requirePermission(principal, 'settings.manage', shopId);
}

type ZoneRule = {
  payment_method_id: string;
  delivery_zone_id: string;
  allowed: boolean;
};

async function authenticated(
  request: AdminRequest,
  client: AdminSupabaseClient,
  csrfRequired: boolean,
) {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (csrfRequired) {
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  }
  return context.principal;
}

function fail(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
  } else if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
  } else if (error instanceof AdminSupabaseError) {
    console.error('Admin payment zone backend unavailable', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
  } else {
    console.error('Admin payment zone request failed');
    sendJson(response, 500, { error: 'admin_request_failed' });
  }
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
      const target = new URL(request.url ?? '/', 'https://admin.local');
      const parsed = uuid.safeParse(target.searchParams.get('shopId'));
      if (!parsed.success) {
        sendJson(response, 400, { error: 'invalid_shop_id' });
        return;
      }
      const principal = await authenticated(request, client, false);
      assertPaymentZoneScope(principal, parsed.data);
      const rules: ZoneRule[] = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const rows = await client.select<ZoneRule[]>(
          'payment_method_zone_rules',
          new URLSearchParams({
            select: 'payment_method_id,delivery_zone_id,allowed',
            business_id: `eq.${principal.businessId}`,
            shop_id: `eq.${parsed.data}`,
            order: 'payment_method_id.asc,delivery_zone_id.asc',
            offset: String(offset),
            limit: '1000',
          }),
        );
        rules.push(...rows);
        if (rows.length < 1000) {
          sendJson(response, 200, {
            rules: rules.map((rule) => ({
              paymentMethodId: rule.payment_method_id,
              deliveryZoneId: rule.delivery_zone_id,
              allowed: rule.allowed,
            })),
          });
          return;
        }
      }
      sendJson(response, 409, { error: 'too_many_payment_zone_rules' });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const parsed = paymentZoneRuleCommandSchema.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid_payment_zone_rule' });
      return;
    }
    const principal = await authenticated(request, client, true);
    assertPaymentZoneScope(principal, parsed.data.shopId);
    const value = await client.rpc<unknown>('upsert_admin_payment_zone_rule_v1', {
      p_employee_id: principal.employeeId,
      p_shop_id: parsed.data.shopId,
      p_payment_method_id: parsed.data.paymentMethodId,
      p_delivery_zone_id: parsed.data.deliveryZoneId,
      p_allowed: parsed.data.allowed,
      p_expected_allowed: parsed.data.expectedAllowed,
      p_expected_settings_version: parsed.data.expectedSettingsVersion,
    });
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('ok' in value) ||
      typeof value.ok !== 'boolean'
    ) {
      sendJson(response, 502, { error: 'backend_contract_invalid' });
      return;
    }
    if (value.ok) {
      sendJson(response, 200, { ok: true });
      return;
    }
    const code =
      'code' in value && typeof value.code === 'string' ? value.code : 'backend_contract_invalid';
    sendJson(response, 200, { ok: false, code });
  } catch (error) {
    fail(response, error);
  }
}
