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

export const CASHIER_RECONCILIATION_APPROVAL_ACTION = 'FINANCE_CASHIER_RECONCILIATION';

const schema = z
  .object({
    shopId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    cashierWorkerId: z.string().uuid(),
    actualMinor: z.number().int().safe().nonnegative(),
    expectedMinor: z.number().int().safe(),
    reason: z.string().trim().max(500).nullable(),
    commandId: z.string().uuid(),
  })
  .strict();

export type CashierReconciliationPayload = z.infer<typeof schema>;

export type ApprovedCashierReconciliationInput = CashierReconciliationPayload & {
  businessId: string;
  approvalRequestId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};

export type CashierReconciliationMutationResult =
  | { ok: true; reconciliationId: string; idempotentReplay?: boolean; replayed?: boolean }
  | { ok: false; code: string };

export type CashierReconciliationResult =
  | CashierReconciliationMutationResult
  | { ok: true; idempotentReplay: true }
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string };

function parsePayload(input: unknown): CashierReconciliationPayload {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_cashier_reconciliation_payload_invalid');
  }
  return parsed.data;
}

export function createCashierReconciliationApprovalExecutionEntries(deps: {
  executeReconciliation(
    input: ApprovedCashierReconciliationInput,
  ): Promise<CashierReconciliationMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: CASHIER_RECONCILIATION_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const input = parsePayload(payload);
        if (claim.shopId !== input.shopId) {
          throw new ApprovalTerminalCommandError('approval_cashier_reconciliation_scope_invalid');
        }
        const result = await deps.executeReconciliation({
          ...input,
          businessId: claim.businessId,
          approvalRequestId: claim.approvalRequestId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (!z.string().uuid().safeParse(result.reconciliationId).success) {
          throw new Error('approval_cashier_reconciliation_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

export type CashierReconciliationRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

/** varianceMinor is obtained from server-trusted drawer facts, NEVER a client field. */
export function evaluateCashierReconciliationRouting(
  payload: CashierReconciliationPayload,
  varianceMinor: number,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): CashierReconciliationRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'finance_cashier_reconciliation_invalid' };
  }
  if (!Number.isSafeInteger(varianceMinor) || varianceMinor < 0) {
    return { kind: 'INVALID', code: 'finance_cashier_variance_invalid' };
  }
  const applicable = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === CASHIER_RECONCILIATION_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === payload.shopId),
  );
  const rule =
    applicable.find((r) => r.shopId === payload.shopId) ??
    applicable.find((r) => r.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  const threshold = rule.thresholdContext['minimumMinor'];
  if (
    rule.requesterPermission !== 'finance.reconcile' ||
    rule.approverPermission !== 'approvals.review' ||
    !rule.requiresSecondPerson ||
    Object.keys(rule.thresholdContext).some((key) => key !== 'minimumMinor') ||
    (threshold !== undefined &&
      (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold <= 0))
  ) {
    return { kind: 'INVALID', code: 'finance_cashier_rule_invalid' };
  }
  return threshold === undefined || varianceMinor >= threshold
    ? { kind: 'APPROVAL_REQUIRED', ruleId: rule.id }
    : { kind: 'DIRECT' };
}

const commands: readonly ApprovalCommandRegistryEntry[] = [
  {
    actionType: CASHIER_RECONCILIATION_APPROVAL_ACTION,
    containsSecretInput: false,
    serialize(input) {
      return parsePayload(input);
    },
  },
];

function approvalCommandId(actor: AdminApprovalActor, payload: CashierReconciliationPayload) {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        CASHIER_RECONCILIATION_APPROVAL_ACTION,
        actor.businessId,
        actor.employeeId,
        payload.shopId,
        payload.businessDayId,
        payload.cashierWorkerId,
        payload.actualMinor,
        payload.expectedMinor,
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

export async function executeOrRequestCashierReconciliation(
  payload: CashierReconciliationPayload,
  trustedAbsoluteVarianceMinor: number,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<CashierReconciliationMutationResult>,
): Promise<CashierReconciliationResult> {
  const route = evaluateCashierReconciliationRouting(
    payload,
    trustedAbsoluteVarianceMinor,
    actor,
    rules,
  );
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return direct();
  const rule = rules.find((r) => r.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: route.ruleId,
      actionType: CASHIER_RECONCILIATION_APPROVAL_ACTION,
      commandId: approvalCommandId(actor, payload),
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
