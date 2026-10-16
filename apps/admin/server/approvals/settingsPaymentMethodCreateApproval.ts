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

export const SETTINGS_PAYMENT_METHOD_CREATE_ACTION = 'SETTINGS_PAYMENT_METHOD_CREATE';

const schema = z
  .object({
    shopId: z.string().uuid(),
    commandId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(120),
    logicType: z.enum(['CASH', 'CARD', 'DIGITAL', 'OTHER']),
    active: z.boolean(),
    sortOrder: z.number().int().safe().nonnegative(),
    channel: z.enum(['POS', 'ONLINE', 'BOTH']),
    requiresReference: z.boolean(),
    manualConfirmationRequired: z.boolean(),
    refundAllowed: z.boolean(),
    expectedSettingsVersion: z.number().int().safe().nonnegative(),
  })
  .strict();

export type PaymentMethodCreateApprovalPayload = z.infer<typeof schema>;
export type ApprovedPaymentMethodCreate = PaymentMethodCreateApprovalPayload & {
  businessId: string;
  approvalRequestId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};
export type PaymentMethodCreateMutationResult =
  | { ok: true; paymentMethodId: string; editVersion: number; idempotentReplay?: boolean }
  | { ok: false; code: string; currentVersion?: number };
export type PaymentMethodCreateApprovalResult =
  | PaymentMethodCreateMutationResult
  | { ok: true; idempotentReplay: true }
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string };

function parse(value: unknown): PaymentMethodCreateApprovalPayload {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApprovalTerminalCommandError('approval_payment_create_payload_invalid');
  }
  return result.data;
}

export type PaymentMethodCreateRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluatePaymentMethodCreateRouting(
  payload: PaymentMethodCreateApprovalPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): PaymentMethodCreateRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'invalid_payment_method_create' };
  }
  const candidates = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === SETTINGS_PAYMENT_METHOD_CREATE_ACTION &&
      (rule.shopId === payload.shopId || rule.shopId === null),
  );
  const rule =
    candidates.find((item) => item.shopId === payload.shopId) ??
    candidates.find((item) => item.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  if (
    rule.requesterPermission !== 'settings.manage' ||
    rule.approverPermission !== 'approvals.review' ||
    !rule.requiresSecondPerson ||
    Object.keys(rule.thresholdContext).length !== 0
  ) {
    return { kind: 'INVALID', code: 'approval_payment_create_rule_invalid' };
  }
  return { kind: 'APPROVAL_REQUIRED', ruleId: rule.id };
}

const commandEntry: ApprovalCommandRegistryEntry = {
  actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
  containsSecretInput: false,
  serialize(value) {
    return parse(value);
  },
};

export function createPaymentMethodCreateApprovalExecutionEntries(deps: {
  executeCreate(input: ApprovedPaymentMethodCreate): Promise<PaymentMethodCreateMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
      async execute({ payload, claim }) {
        const command = parse(payload);
        if (command.shopId !== claim.shopId) {
          throw new ApprovalTerminalCommandError('approval_payment_create_scope_invalid');
        }
        const result = await deps.executeCreate({
          ...command,
          businessId: claim.businessId,
          approvalRequestId: claim.approvalRequestId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (
          !Number.isSafeInteger(result.editVersion) ||
          result.editVersion < 1 ||
          !z.string().uuid().safeParse(result.paymentMethodId).success
        ) {
          throw new Error('approval_payment_create_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

function requestCommandId(
  actor: AdminApprovalActor,
  payload: PaymentMethodCreateApprovalPayload,
): string {
  const hex = createHash('sha256')
    .update(
      JSON.stringify([
        SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
        actor.businessId,
        actor.employeeId,
        payload,
      ]),
    )
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function executeOrRequestPaymentMethodCreate(
  payload: PaymentMethodCreateApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<PaymentMethodCreateMutationResult>,
): Promise<PaymentMethodCreateApprovalResult> {
  const decision = evaluatePaymentMethodCreateRouting(payload, actor, rules);
  if (decision.kind === 'INVALID') return { ok: false, code: decision.code };
  if (decision.kind === 'DIRECT') return direct();
  const rule = rules.find((item) => item.id === decision.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes(rule.requesterPermission)) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: rule.id,
      actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
      commandId: requestCommandId(actor, payload),
      commandInput: payload,
      reason: null,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry([commandEntry]),
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
  if (result['status'] === 'EXECUTED') return { ok: true, idempotentReplay: true };
  if (!['PENDING', 'APPROVED', 'EXECUTING'].includes(String(result['status']))) {
    return { ok: false, code: 'approval_request_terminal' };
  }
  return { ok: true, state: 'PENDING_APPROVAL', approvalRequestId: result['requestId'] };
}
