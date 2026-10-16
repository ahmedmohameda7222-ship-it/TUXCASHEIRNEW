import type {
  AdminApprovalRule,
  AdminPermission,
  PaymentMethodEditInput,
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
  executeOrRequestSettingsPaymentMethodUpdate,
  SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
  type SettingsPaymentMethodApprovalResult,
} from '../approvals/settingsPaymentMethodApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createSettingsService, createSupabaseSettingsStore } from './settingsService.js';

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

export async function executeSettingsPaymentMethodCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: PaymentMethodEditInput & { requesterPin?: string },
  request: AdminRequest,
): Promise<SettingsPaymentMethodApprovalResult> {
  requirePermission(context.principal, 'settings.manage', command.shopId);
  const rows = await client.select<RuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${context.principal.businessId}`,
      action_type: `eq.${SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION}`,
      active: 'eq.true',
    }),
  );
  const rules: AdminApprovalRule[] = rows.map((row) => {
    if (
      !isAdminPermission(row.requester_permission) ||
      !isAdminPermission(row.approver_permission)
    ) {
      throw new Error('payment_approval_rule_permission_invalid');
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
  });
  const actor = { ...context.principal, sessionId: context.session.id };
  const payload = {
    shopId: command.shopId,
    paymentMethodId: command.paymentMethodId,
    displayName: command.displayName,
    active: command.active,
    sortOrder: command.sortOrder,
    channel: command.channel,
    requiresReference: command.requiresReference,
    manualConfirmationRequired: command.manualConfirmationRequired,
    refundAllowed: command.refundAllowed,
    expectedSettingsVersion: command.expectedSettingsVersion,
    expectedEditVersion: command.expectedEditVersion,
  };
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestSettingsPaymentMethodUpdate(
    payload,
    actor,
    rules,
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
    () => createSettingsService(createSupabaseSettingsStore(client)).updatePaymentMethod(command, context.principal),
  );
}
