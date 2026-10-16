import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { z } from 'zod';

import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../adminAuthService.js';
import {
  AdminAuthorizationError,
  requireBusinessWidePermission,
  requirePermission,
} from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { APPROVAL_RULE_PERMISSION_KEYS } from './approvalRulePermissions.js';
import { APPROVAL_RULE_ACTIONS, configurableApprovalAction } from './approvalRuleActions.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const none = z.object({ kind: z.literal('none') }).strict();
const minimumMinor = z
  .object({
    kind: z.literal('minimumMinor'),
    value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const minimumQuantityImpact = z
  .object({
    kind: z.literal('minimumQuantityImpact'),
    value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const approvalThresholdSchema = z.discriminatedUnion('kind', [
  none,
  minimumMinor,
  minimumQuantityImpact,
]);
export type ApprovalThresholdDraft = z.infer<typeof approvalThresholdSchema>;

export const approvalRuleWriteSchema = z
  .object({
    type: z.literal('rule.upsert'),
    ruleId: uuidSchema.nullable(),
    shopId: uuidSchema.nullable(),
    actionType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
    requesterPermission: z.enum(APPROVAL_RULE_PERMISSION_KEYS),
    approverPermission: z.literal('approvals.review'),
    requiresSecondPerson: z.boolean(),
    requiresRequesterRepin: z.boolean(),
    expiresAfterSeconds: z.number().int().min(60).max(604_800),
    threshold: approvalThresholdSchema,
    active: z.boolean(),
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.ruleId === null) !== (value.expectedVersion === null)) {
      context.addIssue({
        code: 'custom',
        path: ['expectedVersion'],
        message: 'Create requires null revision and update requires a current revision',
      });
    }
    const action = configurableApprovalAction(value.actionType);
    if (!action) {
      context.addIssue({
        code: 'custom',
        path: ['actionType'],
        message: 'unsupported_approval_action',
      });
      return;
    }
    if (
      [
        'SETTINGS_PAYMENT_ZONE_CHANGE',
        'SETTINGS_PAYMENT_METHOD_CHANGE',
        'SHOP_LIFECYCLE_CHANGE',
        'FINANCE_SNAPSHOT_ADJUST',
        'FINANCE_OWNER_WITHDRAWAL',
        'FINANCE_CASHIER_RECONCILIATION',
      ].includes(value.actionType) &&
      !value.requiresSecondPerson
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requiresSecondPerson'],
        message:
          value.actionType === 'SHOP_LIFECYCLE_CHANGE'
            ? 'shop_lifecycle_second_person_required'
            : value.actionType === 'FINANCE_SNAPSHOT_ADJUST'
              ? 'finance_snapshot_second_person_required'
              : value.actionType === 'SETTINGS_PAYMENT_ZONE_CHANGE'
                ? 'payment_zone_second_person_required'
                : value.actionType === 'SETTINGS_PAYMENT_METHOD_CHANGE'
                ? 'payment_method_second_person_required'
                : 'finance_owner_withdrawal_second_person_required',
      });
    }
    if (value.requesterPermission !== action.requesterPermission) {
      context.addIssue({
        code: 'custom',
        path: ['requesterPermission'],
        message: 'approval_action_permission_mismatch',
      });
    }
    if (value.threshold.kind !== 'none' && value.threshold.kind !== action.thresholdKind) {
      context.addIssue({
        code: 'custom',
        path: ['threshold'],
        message: 'approval_action_threshold_mismatch',
      });
    }
  });

export function thresholdContextFromDraft(
  draft: ApprovalThresholdDraft,
): Readonly<Record<string, number>> {
  if (draft.kind === 'none') return {};
  return { [draft.kind]: draft.value };
}

export function requireApprovalRuleManagement(
  principal: AdminSessionPrincipal,
  shopId: string | null,
): void {
  if (shopId === null) {
    requireBusinessWidePermission(principal, 'settings.manage');
    return;
  }
  requirePermission(principal, 'settings.manage', shopId);
}

type ApprovalRuleRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  action_type: string;
  requester_permission: string;
  approver_permission: string;
  requires_second_person: boolean;
  requires_requester_repin: boolean;
  expires_after_seconds: number;
  threshold_context: unknown;
  active: boolean;
  edit_version: number;
};

function mapRule(row: ApprovalRuleRow) {
  const threshold = row.threshold_context;
  const context =
    typeof threshold === 'object' && threshold !== null && !Array.isArray(threshold)
      ? (threshold as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    shopId: row.shop_id,
    actionType: row.action_type,
    requesterPermission: row.requester_permission,
    approverPermission: row.approver_permission,
    requiresSecondPerson: row.requires_second_person,
    requiresRequesterRepin: row.requires_requester_repin,
    expiresAfterSeconds: row.expires_after_seconds,
    thresholdContext: context,
    active: row.active,
    editVersion: row.edit_version,
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
  return context;
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
  } else if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
  } else if (error instanceof AdminSupabaseError) {
    console.error('Admin approval-rule database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
  } else {
    console.error('Admin approval-rule request failed');
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
      const context = await authenticated(request, client, false);
      requirePermission(context.principal, 'settings.manage');
      if (
        context.principal.role !== 'OWNER' &&
        context.principal.role !== 'ADMIN' &&
        context.principal.shopIds.length === 0
      ) {
        sendJson(response, 200, { rules: [], availableActions: APPROVAL_RULE_ACTIONS });
        return;
      }
      const query = new URLSearchParams({
        select:
          'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,expires_after_seconds,threshold_context,active,edit_version',
        business_id: `eq.${context.principal.businessId}`,
        order: 'action_type.asc',
        limit: '500',
      });
      if (context.principal.role !== 'OWNER' && context.principal.role !== 'ADMIN') {
        query.set('shop_id', `in.(${context.principal.shopIds.join(',')})`);
      }
      const rows = await client.select<ApprovalRuleRow[]>('admin_approval_rules', query);
      sendJson(response, 200, {
        rules: rows.map(mapRule),
        availableActions: APPROVAL_RULE_ACTIONS,
      });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = approvalRuleWriteSchema.safeParse(await readJsonObject(request));
    if (!command.success) {
      sendJson(response, 400, { error: 'invalid_approval_rule' });
      return;
    }
    const context = await authenticated(request, client, true);
    requireApprovalRuleManagement(context.principal, command.data.shopId);
    const referenceShopId = command.data.shopId ?? context.principal.shopIds[0];
    if (!referenceShopId) {
      sendJson(response, 403, { error: 'concrete_shop_required' });
      return;
    }
    const result = await client.rpc<unknown>('upsert_admin_approval_rule_v1', {
      p_employee_id: context.principal.employeeId,
      p_reference_shop_id: referenceShopId,
      p_rule_id: command.data.ruleId,
      p_rule_shop_id: command.data.shopId,
      p_action_type: command.data.actionType,
      p_requester_permission: command.data.requesterPermission,
      p_approver_permission: command.data.approverPermission,
      p_requires_second_person: command.data.requiresSecondPerson,
      p_requires_requester_repin: command.data.requiresRequesterRepin,
      p_expires_after_seconds: command.data.expiresAfterSeconds,
      p_threshold_context: thresholdContextFromDraft(command.data.threshold),
      p_active: command.data.active,
      p_expected_edit_version: command.data.expectedVersion,
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
    sendJson(response, 200, result);
  } catch (error) {
    handleFailure(response, error);
  }
}
