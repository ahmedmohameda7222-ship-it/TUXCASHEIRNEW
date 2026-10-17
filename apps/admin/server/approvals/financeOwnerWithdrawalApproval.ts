import { createHash } from 'node:crypto';

import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { z } from 'zod';

import {
  ApprovalTerminalCommandError,
  type ApprovalExecutionRegistryEntry,
} from './approvalExecutionService.js';
import {
  createApprovalCommandRegistry,
  requestApproval,
  type ApprovalCommandRegistryEntry,
  type ApprovalServiceDependencies,
} from './approvalService.js';

export const OWNER_WITHDRAWAL_APPROVAL_ACTION = 'FINANCE_OWNER_WITHDRAWAL';

const schema = z
  .object({
    shopId: z.string().uuid(),
    accountId: z.string().uuid(),
    amountMinor: z.number().int().safe().positive().max(900_000_000_000_000),
    reason: z.string().trim().min(1).max(500),
    commandId: z.string().uuid(),
  })
  .strict();

export type OwnerWithdrawalApprovalPayload = z.infer<typeof schema>;

export type ApprovedOwnerWithdrawalInput = OwnerWithdrawalApprovalPayload & {
  approvalRequestId: string;
  businessId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};

export type OwnerWithdrawalResult =
  | { ok: true; commandId?: string; replayed?: boolean; idempotentReplay?: boolean }
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string }
  | { ok: false; code: string };

export type OwnerWithdrawalMutationResult =
  | { ok: true; commandId: string; replayed?: boolean; idempotentReplay?: boolean }
  | { ok: false; code: string };

function readPayload(input: unknown): OwnerWithdrawalApprovalPayload {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_owner_withdrawal_payload_invalid');
  }
  return parsed.data;
}

export function createOwnerWithdrawalApprovalExecutionEntries(deps: {
  executeWithdrawal(input: ApprovedOwnerWithdrawalInput): Promise<OwnerWithdrawalMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const input = readPayload(payload);
        if (claim.shopId !== input.shopId) {
          throw new ApprovalTerminalCommandError('approval_owner_withdrawal_scope_invalid');
        }
        const result = await deps.executeWithdrawal({
          ...input,
          businessId: claim.businessId,
          approvalRequestId: claim.approvalRequestId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (result.commandId !== input.commandId) {
          throw new Error('approval_owner_withdrawal_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

export type OwnerWithdrawalRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateOwnerWithdrawalRouting(
  payload: OwnerWithdrawalApprovalPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): OwnerWithdrawalRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'finance_owner_withdrawal_invalid' };
  }
  const matching = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === OWNER_WITHDRAWAL_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === payload.shopId),
  );
  const selected =
    matching.find((rule) => rule.shopId === payload.shopId) ??
    matching.find((rule) => rule.shopId === null);
  if (!selected) return { kind: 'DIRECT' };
  const threshold = selected.thresholdContext['minimumMinor'];
  if (
    selected.requesterPermission !== 'finance.adjust' ||
    selected.approverPermission !== 'approvals.review' ||
    !selected.requiresSecondPerson ||
    Object.keys(selected.thresholdContext).some((key) => key !== 'minimumMinor') ||
    (threshold !== undefined &&
      (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold <= 0))
  ) {
    return { kind: 'INVALID', code: 'finance_owner_withdrawal_rule_invalid' };
  }
  return threshold === undefined || payload.amountMinor >= threshold
    ? { kind: 'APPROVAL_REQUIRED', ruleId: selected.id }
    : { kind: 'DIRECT' };
}

function stableApprovalId(
  actor: Pick<AdminApprovalActor, 'businessId' | 'employeeId'>,
  payload: OwnerWithdrawalApprovalPayload,
): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        OWNER_WITHDRAWAL_APPROVAL_ACTION,
        actor.businessId,
        actor.employeeId,
        payload.shopId,
        payload.accountId,
        payload.amountMinor,
        payload.reason,
        payload.commandId,
      ]),
    )
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

const commands: readonly ApprovalCommandRegistryEntry[] = [
  {
    actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
    containsSecretInput: false,
    serialize(input) {
      return readPayload(input);
    },
  },
];

export async function executeOrRequestOwnerWithdrawal(
  payload: OwnerWithdrawalApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<OwnerWithdrawalResult>,
): Promise<OwnerWithdrawalResult> {
  const route = evaluateOwnerWithdrawalRouting(payload, actor, rules);
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return direct();
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    return { ok: false, code: 'permission_forbidden' };
  }
  const rule = rules.find((item) => item.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: rule.id,
      actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
      commandId: stableApprovalId(actor, payload),
      commandInput: payload,
      reason: payload.reason,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry(commands),
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
  if (result['status'] === 'EXECUTED') {
    return { ok: true, idempotentReplay: true };
  }
  if (!['PENDING', 'APPROVED', 'EXECUTING'].includes(String(result['status']))) {
    return { ok: false, code: 'approval_request_terminal' };
  }
  return {
    ok: true,
    state: 'PENDING_APPROVAL',
    approvalRequestId: result['requestId'],
  };
}
