import type {
  AdminApprovalRule,
  AdminPermission,
  PaymentMethodCreateInput,
} from '@tux/admin-contracts';

import type { AdminSessionContext } from '../adminAuthService.js';
import { isAdminPermission } from '../adminContractRuntime.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestPaymentMethodCreate,
  SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
  type PaymentMethodCreateApprovalResult,
  type PaymentMethodCreateMutationResult,
} from '../approvals/settingsPaymentMethodCreateApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type RuleRow = {
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

export async function executeSettingsPaymentMethodCreate(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: PaymentMethodCreateInput & { requesterPin?: string },
  request: AdminRequest,
): Promise<PaymentMethodCreateApprovalResult> {
  requirePermission(context.principal, 'settings.manage', command.shopId);
  const rules = await client.select<RuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${context.principal.businessId}`,
      action_type: `eq.${SETTINGS_PAYMENT_METHOD_CREATE_ACTION}`,
      active: 'eq.true',
    }),
  );
  const mapped: AdminApprovalRule[] = rules.map((rule) => {
    if (
      !isAdminPermission(rule.requester_permission) ||
      !isAdminPermission(rule.approver_permission)
    ) {
      throw new Error('payment_create_rule_permission_invalid');
    }
    return {
      id: rule.id,
      businessId: rule.business_id,
      shopId: rule.shop_id,
      actionType: rule.action_type,
      requesterPermission: rule.requester_permission as AdminPermission,
      approverPermission: rule.approver_permission as AdminPermission,
      requiresSecondPerson: rule.requires_second_person,
      requiresRequesterRepin: rule.requires_requester_repin,
      thresholdContext:
        typeof rule.threshold_context === 'object' &&
        rule.threshold_context !== null &&
        !Array.isArray(rule.threshold_context)
          ? (rule.threshold_context as Readonly<Record<string, unknown>>)
          : {},
      active: rule.active,
    };
  });
  const payload = {
    shopId: command.shopId,
    commandId: command.commandId,
    displayName: command.displayName,
    logicType: command.logicType,
    active: command.active,
    sortOrder: command.sortOrder,
    channel: command.channel,
    requiresReference: command.requiresReference,
    manualConfirmationRequired: command.manualConfirmationRequired,
    refundAllowed: command.refundAllowed,
    expectedSettingsVersion: command.expectedSettingsVersion,
  };
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestPaymentMethodCreate(
    payload,
    { ...context.principal, sessionId: context.session.id },
    mapped,
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
    command.requesterPin,
    () =>
      client.rpc<PaymentMethodCreateMutationResult>('create_admin_payment_method_v2', {
        p_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_display_name: command.displayName,
        p_logic_type: command.logicType,
        p_active: command.active,
        p_sort_order: command.sortOrder,
        p_channel: command.channel,
        p_requires_reference: command.requiresReference,
        p_manual_confirmation_required: command.manualConfirmationRequired,
        p_refund_allowed: command.refundAllowed,
        p_expected_settings_version: command.expectedSettingsVersion,
        p_command_id: command.commandId,
      }),
  );
}
