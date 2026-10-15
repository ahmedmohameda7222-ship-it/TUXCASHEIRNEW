import type {
  AdminApprovalRule,
  AdminPermission,
  ShopLifecycleUpdateInput,
  ShopManagementWriteResult,
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
  executeOrRequestShopLifecycle,
  SHOP_LIFECYCLE_APPROVAL_ACTION,
} from '../approvals/shopLifecycleApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { updateShopLifecycle } from './settingsShopManagement.js';

type LifecycleRuleRow = {
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

async function loadLifecycleRules(
  client: AdminSupabaseClient,
  businessId: string,
): Promise<readonly AdminApprovalRule[]> {
  const rows = await client.select<LifecycleRuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${businessId}`,
      action_type: `eq.${SHOP_LIFECYCLE_APPROVAL_ACTION}`,
      active: 'eq.true',
    }),
  );
  return rows.map((row) => {
    if (
      !isAdminPermission(row.requester_permission) ||
      !isAdminPermission(row.approver_permission)
    ) {
      throw new Error('shop_lifecycle_approval_rule_permission_invalid');
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
}

/**
 * Every Settings lifecycle command goes through the same policy gate as the
 * trusted SQL mutator. No browser-provided approval assertion is accepted.
 */
export async function executeShopLifecycleSettingsCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: ShopLifecycleUpdateInput,
  request: AdminRequest,
): Promise<ShopManagementWriteResult> {
  requirePermission(context.principal, 'shops.manage', command.shopId);
  const rules = await loadLifecycleRules(client, context.principal.businessId);
  const actor = {
    ...context.principal,
    sessionId: context.session.id,
  };
  const payload = {
    shopId: command.shopId,
    expectedLifecycleRevision: command.expectedLifecycleRevision,
    expectedState: command.expectedState,
    targetState: command.targetState,
  };
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestShopLifecycle(
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
    () => updateShopLifecycle(client, command, context.principal),
  );
}
