import { createHash } from 'node:crypto';
import type {
  AdminApprovalActor,
  AdminApprovalRule,
  AdminInventoryCommandResult,
} from '@tux/admin-contracts';
import { z } from 'zod';

import {
  ApprovalTerminalCommandError,
  type ApprovalExecutionRegistryEntry,
} from '../approvals/approvalExecutionService.js';
import {
  evaluateApprovalRequirement,
  createApprovalCommandRegistry,
  requestApproval,
  type ApprovalCommandRegistryEntry,
  type ApprovalServiceDependencies,
} from '../approvals/approvalService.js';

export const INVENTORY_ADJUST_APPROVAL_ACTION = 'INVENTORY_ADJUST';

const uuid = z.string().uuid();
const payloadSchema = z
  .object({
    shopId: uuid,
    inventoryItemId: uuid,
    quantityDeltaMicros: z.number().int().safe().refine((v) => v !== 0),
    reasonCodeId: uuid,
    note: z.string().trim().max(500).nullable(),
    originalCommandId: z.string().trim().min(1).max(160),
    emergencyNegativeOverride: z.boolean(),
    expectedDefinitionVersion: z.number().int().safe().positive(),
  })
  .strict();

export type InventoryAdjustmentApprovalPayload = z.infer<typeof payloadSchema>;

export type ApprovedInventoryAdjustmentExecutionInput = InventoryAdjustmentApprovalPayload & {
  approvalRequestId: string;
  businessId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
};

function parsePayload(input: unknown): InventoryAdjustmentApprovalPayload {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_inventory_payload_invalid');
  }
  return parsed.data;
}

export function createInventoryAdjustmentApprovalCommandEntries(): readonly ApprovalCommandRegistryEntry[] {
  return [
    {
      actionType: INVENTORY_ADJUST_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize(input) {
        return parsePayload(input);
      },
    },
  ];
}

export function createInventoryAdjustmentApprovalExecutionEntries(deps: {
  executeAdjustment(
    input: ApprovedInventoryAdjustmentExecutionInput,
  ): Promise<AdminInventoryCommandResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: INVENTORY_ADJUST_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const input = parsePayload(payload);
        if (claim.shopId === null || claim.shopId !== input.shopId) {
          throw new ApprovalTerminalCommandError('approval_inventory_shop_scope_invalid');
        }
        const result = await deps.executeAdjustment({
          ...input,
          approvalRequestId: claim.approvalRequestId,
          businessId: claim.businessId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}


function stableInventoryApprovalCommandId(
  actor: Pick<AdminApprovalActor, 'businessId' | 'employeeId'>,
  payload: InventoryAdjustmentApprovalPayload,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        INVENTORY_ADJUST_APPROVAL_ACTION,
        actor.businessId,
        actor.employeeId,
        payload.shopId,
        payload.originalCommandId,
      ]),
    )
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export type InventoryApprovalRoutingDecision =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateInventoryAdjustmentRouting(
  input: Pick<InventoryAdjustmentApprovalPayload, 'shopId' | 'quantityDeltaMicros'>,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): InventoryApprovalRoutingDecision {
  // Quantity thresholds are configured in whole base units, not micros.
  // The authoritative impact is derived from the exact signed delta which
  // will be persisted, never a separately submitted browser threshold claim.
  const applicable = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === INVENTORY_ADJUST_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === input.shopId),
  );
  const governing =
    applicable.find((rule) => rule.shopId === input.shopId) ??
    applicable.find((rule) => rule.shopId === null);
  if (!governing) return { kind: 'DIRECT' };

  const keys = Object.keys(governing.thresholdContext);
  if (
    keys.length > 1 ||
    keys.some((key) => key !== 'minimumQuantityImpact') ||
    (keys.length === 1 &&
      (!Number.isSafeInteger(governing.thresholdContext['minimumQuantityImpact']) ||
        Number(governing.thresholdContext['minimumQuantityImpact']) <= 0))
  ) {
    return { kind: 'INVALID', code: 'approval_threshold_context_invalid' };
  }
  if (!Number.isSafeInteger(input.quantityDeltaMicros) || input.quantityDeltaMicros === 0) {
    return { kind: 'INVALID', code: 'approval_quantity_context_required' };
  }

  const requirement = evaluateApprovalRequirement(
    {
      businessId: actor.businessId,
      shopId: input.shopId,
      actionType: INVENTORY_ADJUST_APPROVAL_ACTION,
      quantityImpact: Math.abs(input.quantityDeltaMicros) / 1_000_000,
    },
    rules,
  );
  return requirement.required
    ? { kind: 'APPROVAL_REQUIRED', ruleId: requirement.ruleId }
    : { kind: 'DIRECT' };
}

export async function executeOrRequestInventoryAdjustment(
  payload: InventoryAdjustmentApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  dependencies: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  executeDirect: () => Promise<AdminInventoryCommandResult>,
): Promise<AdminInventoryCommandResult> {
  const decision = evaluateInventoryAdjustmentRouting(payload, actor, rules);
  if (decision.kind === 'INVALID') return { ok: false, code: decision.code };
  if (decision.kind === 'DIRECT') return executeDirect();

  const rule = rules.find((entry) => entry.id === decision.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes(rule.requesterPermission)) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }

  // Approval command IDs are UUIDs; inventory command IDs are arbitrary
  // 160-character strings. Derive a stable UUID using a collision-resistant
  // domain-separated digest, preserving exact command replay identity.
  const commandId = stableInventoryApprovalCommandId(actor, payload);
  const request = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: decision.ruleId,
      actionType: INVENTORY_ADJUST_APPROVAL_ACTION,
      commandId,
      commandInput: payload,
      reason: payload.note,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    dependencies,
    createApprovalCommandRegistry(createInventoryAdjustmentApprovalCommandEntries()),
  );

  if (request['ok'] !== true) {
    return {
      ok: false,
      code:
        typeof request['code'] === 'string'
          ? request['code']
          : 'inventory_approval_request_failed',
    };
  }
  if (typeof request['requestId'] !== 'string') {
    return { ok: false, code: 'inventory_approval_response_invalid' };
  }
  if (request['status'] === 'REJECTED' || request['status'] === 'FAILED') {
    return { ok: false, code: 'inventory_approval_terminal' };
  }
  if (request['status'] === 'EXECUTED') {
    return { ok: true, idempotentReplay: true };
  }
  if (
    request['status'] !== 'PENDING' &&
    request['status'] !== 'APPROVED' &&
    request['status'] !== 'EXECUTING'
  ) {
    return { ok: false, code: 'inventory_approval_response_invalid' };
  }

  return {
    ok: true,
    state: 'PENDING_APPROVAL',
    approvalRequestId: request['requestId'],
    idempotentReplay: request['idempotentReplay'] === true,
  };
}
