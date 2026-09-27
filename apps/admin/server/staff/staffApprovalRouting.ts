import type {
  AdminApprovalActor,
  AdminApprovalRule,
  AdminPermission,
  StaffCommandResult,
} from '@tux/admin-contracts';

import { isAdminPermission } from '../adminContractRuntime.js';
import {
  createApprovalCommandRegistry,
  evaluateApprovalRequirement,
  requestApproval,
  type ApprovalServiceDependencies,
} from '../approvals/approvalService.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createStaffApprovalCommandEntries } from './staffApproval.js';

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

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function permission(value: string): AdminPermission {
  if (!isAdminPermission(value)) throw new Error('staff_approval_rule_permission_invalid');
  return value;
}

function mapRule(row: ApprovalRuleRow): AdminApprovalRule {
  return {
    id: row.id,
    businessId: row.business_id,
    shopId: row.shop_id,
    actionType: row.action_type,
    requesterPermission: permission(row.requester_permission),
    approverPermission: permission(row.approver_permission),
    requiresSecondPerson: row.requires_second_person,
    requiresRequesterRepin: row.requires_requester_repin,
    thresholdContext: objectValue(row.threshold_context),
    active: row.active,
  };
}

async function loadRules(
  client: AdminSupabaseClient,
  businessId: string,
  actionType: string,
): Promise<readonly AdminApprovalRule[]> {
  const rows = await client.select<ApprovalRuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${businessId}`,
      action_type: `eq.${actionType}`,
      active: 'eq.true',
    }),
  );
  return rows.map(mapRule);
}

export type StaffApprovalRoutingInput = {
  readonly actionType: string;
  readonly shopId: string | null;
  readonly commandId: string;
  readonly commandInput: unknown;
  readonly reason?: string | null;
  readonly requesterPin?: string;
  readonly amountMinor?: number;
};

export async function executeOrRequestStaffApproval(
  input: StaffApprovalRoutingInput,
  actor: AdminApprovalActor,
  client: AdminSupabaseClient,
  deps: ApprovalServiceDependencies,
  executeDirect: () => Promise<StaffCommandResult>,
): Promise<StaffCommandResult> {
  const rules = await loadRules(client, actor.businessId, input.actionType);
  const requirement = evaluateApprovalRequirement(
    {
      businessId: actor.businessId,
      shopId: input.shopId,
      actionType: input.actionType,
      ...(input.amountMinor === undefined ? {} : { amountMinor: input.amountMinor }),
    },
    rules,
  );

  if (!requirement.required) {
    return executeDirect();
  }

  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: input.shopId,
      ruleId: requirement.ruleId,
      actionType: input.actionType,
      commandId: input.commandId,
      commandInput: input.commandInput,
      reason: input.reason ?? null,
      requesterPin: input.requesterPin,
    },
    actor,
    deps,
    createApprovalCommandRegistry(createStaffApprovalCommandEntries()),
  );

  if (result['ok'] !== true) {
    return {
      ok: false,
      code:
        typeof result['code'] === 'string'
          ? result['code']
          : 'staff_approval_request_failed',
    };
  }
  if (typeof result['requestId'] !== 'string') {
    throw new Error('staff_approval_request_contract_invalid');
  }

  return {
    ok: true,
    state: 'PENDING_APPROVAL',
    approvalRequestId: result['requestId'],
    replayed: result['idempotentReplay'] === true,
  };
}
