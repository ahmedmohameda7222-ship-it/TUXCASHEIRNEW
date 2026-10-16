import type {
  AdminApprovalRule,
  AdminPermission,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';
import { z } from 'zod';

import { isAdminPermission } from '../adminContractRuntime.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestSettingsPaymentZoneUpdate,
  SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
  type SettingsPaymentZoneMutationResult,
} from '../approvals/settingsPaymentZoneApproval.js';
import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  clientFingerprint,
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';

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
    requesterPin: z.string().min(1).max(64).optional(),
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

type ApprovalRuleRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  action_type: string;
  requester_permission: string;
  approver_permission: string;
  requires_second_person: boolean;
  requires_requester_repin: boolean;
  threshold_context: unknown;
  active: boolean;
};

function readApprovalRule(row: ApprovalRuleRow): AdminApprovalRule {
  if (
    !isAdminPermission(row.requester_permission) ||
    !isAdminPermission(row.approver_permission)
  ) {
    throw new Error('payment_zone_approval_rule_permission_invalid');
  }
  return {
    id: row.id,
    businessId: row.business_id,
    shopId: row.shop_id,
    actionType: row.action_type,
    requesterPermission: row.requester_permission as AdminPermission,
    approverPermission: row.approver_permission as AdminPermission,
    requiresSecondPerson: row.requires_second_person,
    requiresRequesterRepin: row.requires_requester_repin,
    thresholdContext:
      typeof row.threshold_context === 'object' &&
      row.threshold_context !== null &&
      !Array.isArray(row.threshold_context)
        ? (row.threshold_context as Readonly<Record<string, unknown>>)
        : {},
    active: row.active,
  };
}


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
    const sessionToken = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!sessionToken) throw new AdminAuthError('session_required', 401);
    const context = await loadAdminSession(sessionToken, client);
    const ruleRows = await client.select<ApprovalRuleRow[]>(
      'admin_approval_rules',
      new URLSearchParams({
        select:
          'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
        business_id: `eq.${principal.businessId}`,
        action_type: `eq.${SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION}`,
        active: 'eq.true',
      }),
    );
    const { requesterPin } = parsed.data;
    const payload = {
      shopId: parsed.data.shopId,
      paymentMethodId: parsed.data.paymentMethodId,
      deliveryZoneId: parsed.data.deliveryZoneId,
      allowed: parsed.data.allowed,
      expectedAllowed: parsed.data.expectedAllowed,
      expectedSettingsVersion: parsed.data.expectedSettingsVersion,
    };
    const base = createSupabaseApprovalServiceDependencies(client);
    const limiter = createAdminPinRateLimitRpc(client);
    const value = await executeOrRequestSettingsPaymentZoneUpdate(
      payload,
      { ...principal, sessionId: context.session.id },
      ruleRows.map(readApprovalRule),
      {
        ...base,
        verifyEmployeePin(employeeId, pin) {
          return verifyApprovalPinWithRateLimit(
            {
              employeeId,
              sessionId: context.session.id,
              pin,
              fingerprint: clientFingerprint(request),
              rateLimitSecret: getAdminServerEnv().rateLimitSecret,
            },
            { verifyEmployeePin: base.verifyEmployeePin, limiter },
          );
        },
      },
      requesterPin,
      () =>
        client.rpc<SettingsPaymentZoneMutationResult>('upsert_admin_payment_zone_rule_v1', {
          p_employee_id: principal.employeeId,
          p_shop_id: payload.shopId,
          p_payment_method_id: payload.paymentMethodId,
          p_delivery_zone_id: payload.deliveryZoneId,
          p_allowed: payload.allowed,
          p_expected_allowed: payload.expectedAllowed,
          p_expected_settings_version: payload.expectedSettingsVersion,
        }),
    );
    if (value.ok) {
      sendJson(response, 200, value);
      return;
    }
    sendJson(response, 200, value);
  } catch (error) {
    fail(response, error);
  }
}
