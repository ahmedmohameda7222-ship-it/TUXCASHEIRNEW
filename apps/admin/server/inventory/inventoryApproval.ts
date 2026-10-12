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
  type ApprovalCommandRegistryEntry,
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
