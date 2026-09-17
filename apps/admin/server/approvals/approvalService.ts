import {
  ADMIN_APPROVAL_STATUSES,
  type AdminApprovalActor,
  type AdminApprovalRule,
  type AdminApprovalStatus,
  type AdminPermission,
  type ApprovalDecision,
} from '@tux/admin-contracts';

import { verifyPin } from '../pin';
import type { AdminSupabaseClient } from '../supabaseAdmin';

export type ApprovalActor = AdminApprovalActor;

export type ApprovalRequestRecord = {
  id: string;
  businessId: string;
  shopId: string | null;
  requesterEmployeeId: string;
  actionType: string;
  requiredApproverPermission: AdminPermission;
  requiresSecondPerson: boolean;
  status: AdminApprovalStatus;
};

export type ApprovalCommandRegistryEntry = {
  actionType: string;
  containsSecretInput: boolean;
  serialize?: (input: unknown) => Readonly<Record<string, unknown>>;
};

export type ApprovalCommandRegistry = ReadonlyMap<string, ApprovalCommandRegistryEntry>;

export type CreateApprovalRequestInput = {
  businessId: string;
  shopId: string | null;
  requesterEmployeeId: string;
  requesterSessionId: string;
  ruleId: string;
  actionType: string;
  commandId: string;
  commandPayload: Readonly<Record<string, unknown>>;
  reason: string | null;
};

export type ApprovalDecisionInput = {
  requestId: string;
  approverEmployeeId: string;
  approverSessionId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string | null;
};

export type ApprovalDecisionResult =
  { ok: true; status: 'APPROVED' | 'REJECTED' } | { ok: false; code: string };

export type ApprovalRequestCreationResult = {
  ok: boolean;
  requestId?: string;
  status?: AdminApprovalStatus;
  code?: string;
  idempotentReplay?: boolean;
  persistedPayload?: Readonly<Record<string, unknown>>;
};

export type ApprovalServiceDependencies = {
  loadRequest(requestId: string): Promise<ApprovalRequestRecord | null>;
  loadRule(ruleId: string): Promise<AdminApprovalRule | null>;
  verifyEmployeePin(employeeId: string, pin: string): Promise<boolean>;
  decideRequest(input: ApprovalDecisionInput): Promise<ApprovalDecisionResult>;
  createRequest(input: CreateApprovalRequestInput): Promise<ApprovalRequestCreationResult>;
  now(): Date;
};

export type ApprovalRequirementContext = {
  businessId: string;
  shopId: string | null;
  actionType: string;
  amountMinor?: number;
  quantityImpact?: number;
};

export type RequestApprovalInput = {
  businessId: string;
  shopId: string | null;
  ruleId: string;
  actionType: string;
  commandId: string;
  commandInput: unknown;
  reason?: string | null;
  requesterPin?: string;
};

export type DecideApprovalInput = {
  requestId: string;
  pin: string;
  reason?: string | null;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizeJson(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!isRecord(normalized)) throw new Error('approval_command_payload_invalid');
  return normalized;
}

function actorCanAccessShop(actor: ApprovalActor, shopId: string | null): boolean {
  if (shopId === null) return actor.role === 'OWNER' || actor.role === 'ADMIN';
  return actor.shopIds.includes(shopId);
}

function actorHasPermission(actor: ApprovalActor, permission: AdminPermission): boolean {
  return actor.role === 'OWNER' || actor.permissions.includes(permission);
}

function ruleThresholdMatches(
  rule: AdminApprovalRule,
  context: ApprovalRequirementContext,
): boolean {
  const minimumMinor = rule.thresholdContext['minimumMinor'];
  if (typeof minimumMinor === 'number' && Number.isFinite(minimumMinor)) {
    return context.amountMinor === undefined || context.amountMinor >= minimumMinor;
  }

  const minimumQuantityImpact = rule.thresholdContext['minimumQuantityImpact'];
  if (typeof minimumQuantityImpact === 'number' && Number.isFinite(minimumQuantityImpact)) {
    return (
      context.quantityImpact === undefined ||
      Math.abs(context.quantityImpact) >= Math.abs(minimumQuantityImpact)
    );
  }

  return true;
}

function ruleMatchesRequest(rule: AdminApprovalRule, input: RequestApprovalInput): boolean {
  return (
    rule.active &&
    rule.businessId === input.businessId &&
    rule.actionType === input.actionType &&
    (rule.shopId === null || rule.shopId === input.shopId)
  );
}

function isAdminApprovalStatus(value: unknown): value is AdminApprovalStatus {
  return (
    typeof value === 'string' &&
    (ADMIN_APPROVAL_STATUSES as readonly string[]).includes(value)
  );
}

export function evaluateApprovalRequirement(
  context: ApprovalRequirementContext,
  rules: readonly AdminApprovalRule[],
): ApprovalDecision {
  const candidates = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === context.businessId &&
      rule.actionType === context.actionType &&
      (rule.shopId === null || rule.shopId === context.shopId),
  );
  const rule =
    candidates.find((candidate) => candidate.shopId === context.shopId) ??
    candidates.find((candidate) => candidate.shopId === null);
  if (!rule || !ruleThresholdMatches(rule, context)) return { required: false };
  return {
    required: true,
    ruleId: rule.id,
    approverPermission: rule.approverPermission,
    requiresSecondPerson: rule.requiresSecondPerson,
    requiresRequesterRepin: rule.requiresRequesterRepin,
  };
}

export function createApprovalCommandRegistry(
  entries: readonly ApprovalCommandRegistryEntry[],
): ApprovalCommandRegistry {
  const registry = new Map<string, ApprovalCommandRegistryEntry>();
  for (const entry of entries) {
    const actionType = entry.actionType.trim();
    if (actionType === '') throw new Error('approval_command_action_type_required');
    if (registry.has(actionType)) throw new Error('approval_command_duplicate_registration');
    registry.set(actionType, { ...entry, actionType });
  }
  return registry;
}

export function serializeApprovalCommand(
  registry: ApprovalCommandRegistry,
  actionType: string,
  input: unknown,
): Readonly<Record<string, unknown>> {
  const entry = registry.get(actionType);
  if (!entry) throw new Error('approval_command_not_registered');
  if (!entry.serialize) {
    throw new Error(
      entry.containsSecretInput
        ? 'approval_secret_safe_serializer_required'
        : 'approval_command_serializer_required',
    );
  }
  return canonicalizeJson(entry.serialize(input));
}

export async function requestApproval(
  input: RequestApprovalInput,
  actor: ApprovalActor,
  deps: ApprovalServiceDependencies,
  registry: ApprovalCommandRegistry,
): Promise<Readonly<Record<string, unknown>>> {
  if (actor.businessId !== input.businessId) {
    return { ok: false, code: 'approval_business_scope_forbidden' };
  }
  if (!actorCanAccessShop(actor, input.shopId)) {
    return { ok: false, code: 'approval_shop_scope_forbidden' };
  }

  const rule = await deps.loadRule(input.ruleId);
  if (!rule || !ruleMatchesRequest(rule, input)) {
    return { ok: false, code: 'approval_rule_missing_or_mismatched' };
  }

  if (rule.requiresRequesterRepin) {
    const pin = input.requesterPin?.trim() ?? '';
    if (pin === '' || !(await deps.verifyEmployeePin(actor.employeeId, pin))) {
      return { ok: false, code: 'invalid_pin' };
    }
  }

  let commandPayload: Readonly<Record<string, unknown>>;
  try {
    commandPayload = serializeApprovalCommand(registry, input.actionType, input.commandInput);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error ? error.message : 'approval_command_serialization_failed',
    };
  }

  return deps.createRequest({
    businessId: input.businessId,
    shopId: input.shopId,
    requesterEmployeeId: actor.employeeId,
    requesterSessionId: actor.sessionId,
    ruleId: rule.id,
    actionType: input.actionType,
    commandId: input.commandId,
    commandPayload,
    reason: input.reason?.trim() || null,
  });
}

async function decideApproval(
  input: DecideApprovalInput,
  actor: ApprovalActor,
  deps: ApprovalServiceDependencies,
  decision: 'APPROVE' | 'REJECT',
): Promise<ApprovalDecisionResult> {
  const request = await deps.loadRequest(input.requestId);
  if (!request) return { ok: false, code: 'approval_request_not_found' };
  if (request.status !== 'PENDING') return { ok: false, code: 'approval_already_decided' };
  if (request.businessId !== actor.businessId) {
    return { ok: false, code: 'approval_business_scope_forbidden' };
  }
  if (!actorCanAccessShop(actor, request.shopId)) {
    return { ok: false, code: 'approval_shop_scope_forbidden' };
  }
  if (request.requiresSecondPerson && request.requesterEmployeeId === actor.employeeId) {
    return { ok: false, code: 'self_approval_forbidden' };
  }
  if (!actorHasPermission(actor, request.requiredApproverPermission)) {
    return { ok: false, code: 'approver_not_authorized' };
  }
  if (!(await deps.verifyEmployeePin(actor.employeeId, input.pin))) {
    return { ok: false, code: 'invalid_pin' };
  }

  return deps.decideRequest({
    requestId: request.id,
    approverEmployeeId: actor.employeeId,
    approverSessionId: actor.sessionId,
    decision,
    reason: input.reason?.trim() || null,
  });
}

export function approveRequest(
  input: DecideApprovalInput,
  actor: ApprovalActor,
  deps: ApprovalServiceDependencies,
): Promise<ApprovalDecisionResult> {
  return decideApproval(input, actor, deps, 'APPROVE');
}

export function rejectRequest(
  input: DecideApprovalInput,
  actor: ApprovalActor,
  deps: ApprovalServiceDependencies,
): Promise<ApprovalDecisionResult> {
  return decideApproval(input, actor, deps, 'REJECT');
}

type ApprovalRequestRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  requester_employee_id: string;
  action_type: string;
  required_approver_permission: AdminPermission;
  requires_second_person: boolean;
  status: AdminApprovalStatus;
};

type ApprovalRuleRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  action_type: string;
  requester_permission: AdminPermission;
  approver_permission: AdminPermission;
  requires_second_person: boolean;
  requires_requester_repin: boolean;
  threshold_context: unknown;
  active: boolean;
};

function mapRequestRow(row: ApprovalRequestRow): ApprovalRequestRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    shopId: row.shop_id,
    requesterEmployeeId: row.requester_employee_id,
    actionType: row.action_type,
    requiredApproverPermission: row.required_approver_permission,
    requiresSecondPerson: row.requires_second_person,
    status: row.status,
  };
}

function mapRuleRow(row: ApprovalRuleRow): AdminApprovalRule {
  return {
    id: row.id,
    businessId: row.business_id,
    shopId: row.shop_id,
    actionType: row.action_type,
    requesterPermission: row.requester_permission,
    approverPermission: row.approver_permission,
    requiresSecondPerson: row.requires_second_person,
    requiresRequesterRepin: row.requires_requester_repin,
    thresholdContext: isRecord(row.threshold_context) ? row.threshold_context : {},
    active: row.active,
  };
}

export function createSupabaseApprovalServiceDependencies(
  client: AdminSupabaseClient,
): ApprovalServiceDependencies {
  return {
    async loadRequest(requestId) {
      const rows = await client.select<ApprovalRequestRow[]>(
        'admin_approval_requests',
        new URLSearchParams({
          select:
            'id,business_id,shop_id,requester_employee_id,action_type,required_approver_permission,requires_second_person,status',
          id: `eq.${requestId}`,
          limit: '1',
        }),
      );
      return rows[0] ? mapRequestRow(rows[0]) : null;
    },
    async loadRule(ruleId) {
      const rows = await client.select<ApprovalRuleRow[]>(
        'admin_approval_rules',
        new URLSearchParams({
          select:
            'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
          id: `eq.${ruleId}`,
          limit: '1',
        }),
      );
      return rows[0] ? mapRuleRow(rows[0]) : null;
    },
    async verifyEmployeePin(employeeId, pin) {
      const rows = await client.select<Array<{ pin_hash: string | null; active: boolean }>>(
        'business_employees',
        new URLSearchParams({
          select: 'pin_hash,active',
          id: `eq.${employeeId}`,
          active: 'eq.true',
          limit: '1',
        }),
      );
      const row = rows[0];
      return Boolean(row?.active && row.pin_hash && (await verifyPin(pin, row.pin_hash)));
    },
    async decideRequest(input) {
      const result = await client.rpc<Record<string, unknown>>('decide_admin_approval_request_v1', {
        p_request_id: input.requestId,
        p_approver_employee_id: input.approverEmployeeId,
        p_approver_session_id: input.approverSessionId,
        p_decision: input.decision,
        p_reason: input.reason,
      });
      if (result['ok'] !== true) {
        return {
          ok: false,
          code: typeof result['code'] === 'string' ? result['code'] : 'approval_decision_failed',
        };
      }
      return {
        ok: true,
        status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      };
    },
    async createRequest(input) {
      const result = await client.rpc<Record<string, unknown>>('create_admin_approval_request_v1', {
        p_business_id: input.businessId,
        p_shop_id: input.shopId,
        p_requester_employee_id: input.requesterEmployeeId,
        p_requester_session_id: input.requesterSessionId,
        p_rule_id: input.ruleId,
        p_action_type: input.actionType,
        p_command_id: input.commandId,
        p_command_payload: input.commandPayload,
        p_reason: input.reason,
      });
      const response: ApprovalRequestCreationResult = { ok: result['ok'] === true };
      if (typeof result['requestId'] === 'string') response.requestId = result['requestId'];
      if (isAdminApprovalStatus(result['status'])) response.status = result['status'];
      if (typeof result['code'] === 'string') response.code = result['code'];
      if (typeof result['idempotentReplay'] === 'boolean') {
        response.idempotentReplay = result['idempotentReplay'];
      }
      return response;
    },
    now: () => new Date(),
  };
}
