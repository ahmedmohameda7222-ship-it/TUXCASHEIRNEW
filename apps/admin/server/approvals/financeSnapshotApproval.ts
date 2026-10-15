import { createHash } from 'node:crypto';

import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { z } from 'zod';

import { ApprovalTerminalCommandError, type ApprovalExecutionRegistryEntry } from './approvalExecutionService.js';
import {
  createApprovalCommandRegistry,
  requestApproval,
  type ApprovalCommandRegistryEntry,
  type ApprovalServiceDependencies,
} from './approvalService.js';

export const FINANCE_SNAPSHOT_APPROVAL_ACTION = 'FINANCE_SNAPSHOT_ADJUST';

const payloadSchema = z
  .object({
    shopId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    amountMinor: z.number().int().safe().refine((amount) => amount !== 0),
    reason: z.string().trim().min(1).max(500),
    commandId: z.string().uuid(),
    expectedAdjustmentCount: z.number().int().safe().nonnegative(),
  })
  .strict();

export type FinanceSnapshotApprovalPayload = z.infer<typeof payloadSchema>;
export type ApprovedFinanceSnapshotExecutionInput = FinanceSnapshotApprovalPayload & {
  approvalRequestId: string;
  businessId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};
export type FinanceSnapshotApprovalResult =
  | { ok: true; adjustmentId?: string; replayed?: boolean; idempotentReplay?: boolean }
  | {
      ok: true;
      state: 'PENDING_APPROVAL';
      approvalRequestId: string;
      idempotentReplay?: boolean;
    }
  | { ok: false; code: string };

export type ApprovedFinanceSnapshotMutationResult =
  | { ok: true; adjustmentId: string; replayed?: boolean; idempotentReplay?: boolean }
  | { ok: false; code: string };

function parsePayload(input: unknown): FinanceSnapshotApprovalPayload {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_finance_snapshot_payload_invalid');
  }
  return parsed.data;
}

export function createFinanceSnapshotApprovalCommandEntries(): readonly ApprovalCommandRegistryEntry[] {
  return [
    {
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize(input) {
        return parsePayload(input);
      },
    },
  ];
}

export function createFinanceSnapshotApprovalExecutionEntries(deps: {
  executeAdjustment(
    input: ApprovedFinanceSnapshotExecutionInput,
  ): Promise<ApprovedFinanceSnapshotMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const input = parsePayload(payload);
        if (claim.shopId !== input.shopId) {
          throw new ApprovalTerminalCommandError('approval_finance_snapshot_scope_invalid');
        }
        const result = await deps.executeAdjustment({
          ...input,
          approvalRequestId: claim.approvalRequestId,
          businessId: claim.businessId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (!z.string().uuid().safeParse(result.adjustmentId).success) {
          throw new Error('approval_finance_snapshot_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

export type FinanceSnapshotApprovalRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateFinanceSnapshotApprovalRouting(
  payload: FinanceSnapshotApprovalPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): FinanceSnapshotApprovalRouting {
  if (!payloadSchema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'finance_adjustment_invalid' };
  }
  const matches = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === FINANCE_SNAPSHOT_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === payload.shopId),
  );
  const rule =
    matches.find((item) => item.shopId === payload.shopId) ??
    matches.find((item) => item.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  const threshold = rule.thresholdContext['minimumMinor'];
  if (
    rule.requesterPermission !== 'finance.adjust' ||
    rule.approverPermission !== 'approvals.review' ||
    !rule.requiresSecondPerson ||
    Object.keys(rule.thresholdContext).some((key) => key !== 'minimumMinor') ||
    (threshold !== undefined &&
      (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold <= 0))
  ) {
    return { kind: 'INVALID', code: 'finance_snapshot_approval_rule_invalid' };
  }
  return threshold === undefined || Math.abs(payload.amountMinor) >= threshold
    ? { kind: 'APPROVAL_REQUIRED', ruleId: rule.id }
    : { kind: 'DIRECT' };
}

function stableApprovalCommandId(
  actor: Pick<AdminApprovalActor, 'businessId' | 'employeeId'>,
  payload: FinanceSnapshotApprovalPayload,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        FINANCE_SNAPSHOT_APPROVAL_ACTION,
        actor.businessId,
        actor.employeeId,
        payload.shopId,
        payload.snapshotId,
        payload.amountMinor,
        payload.reason,
        payload.commandId,
        payload.expectedAdjustmentCount,
      ]),
    )
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export async function executeOrRequestFinanceSnapshotAdjustment(
  payload: FinanceSnapshotApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  executeDirect: () => Promise<FinanceSnapshotApprovalResult>,
): Promise<FinanceSnapshotApprovalResult> {
  const route = evaluateFinanceSnapshotApprovalRouting(payload, actor, rules);
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return executeDirect();
  const rule = rules.find((item) => item.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes('finance.adjust')) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: rule.id,
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      commandId: stableApprovalCommandId(actor, payload),
      commandInput: payload,
      reason: payload.reason,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry(createFinanceSnapshotApprovalCommandEntries()),
  );
  if (result['ok'] !== true) {
    return {
      ok: false,
      code: typeof result['code'] === 'string' ? result['code'] : 'approval_request_failed',
    };
  }
  if (typeof result['requestId'] !== 'string') {
    return { ok: false, code: 'approval_response_invalid' };
  }
  if (result['status'] === 'REJECTED' || result['status'] === 'FAILED') {
    return { ok: false, code: 'approval_request_terminal' };
  }
  if (result['status'] === 'EXECUTED') {
    return { ok: true, idempotentReplay: true };
  }
  if (
    result['status'] !== 'PENDING' &&
    result['status'] !== 'APPROVED' &&
    result['status'] !== 'EXECUTING'
  ) {
    return { ok: false, code: 'approval_response_invalid' };
  }
  return {
    ok: true,
    state: 'PENDING_APPROVAL',
    approvalRequestId: result['requestId'],
    idempotentReplay: result['idempotentReplay'] === true,
  };
}
