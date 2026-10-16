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

export const SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION = 'SETTINGS_PAYMENT_METHOD_CHANGE';

const schema = z
  .object({
    shopId: z.string().uuid(),
    paymentMethodId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(120),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    channel: z.enum(['POS', 'ONLINE', 'BOTH']),
    requiresReference: z.boolean(),
    manualConfirmationRequired: z.boolean(),
    refundAllowed: z.boolean(),
    expectedSettingsVersion: z.number().int().safe().nonnegative(),
    expectedEditVersion: z.number().int().safe().positive(),
  })
  .strict();

export type SettingsPaymentMethodApprovalPayload = z.infer<typeof schema>;
export type ApprovedSettingsPaymentMethodUpdate = SettingsPaymentMethodApprovalPayload & {
  businessId: string;
  approvalRequestId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};
export type SettingsPaymentMethodMutationResult =
  | { ok: true; editVersion: number; idempotentReplay?: boolean }
  | { ok: false; code: string; currentVersion?: number };
export type SettingsPaymentMethodApprovalResult =
  | SettingsPaymentMethodMutationResult
  | { ok: true; idempotentReplay: true }
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string };

function parse(input: unknown): SettingsPaymentMethodApprovalPayload {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApprovalTerminalCommandError('approval_payment_payload_invalid');
  return parsed.data;
}

export type SettingsPaymentMethodRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateSettingsPaymentMethodRouting(
  payload: SettingsPaymentMethodApprovalPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): SettingsPaymentMethodRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'invalid_payment_method_change' };
  }
  const matching = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === payload.shopId),
  );
  const rule =
    matching.find((entry) => entry.shopId === payload.shopId) ??
    matching.find((entry) => entry.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  if (
    rule.requesterPermission !== 'settings.manage' ||
    rule.approverPermission !== 'approvals.review' ||
    !rule.requiresSecondPerson ||
    Object.keys(rule.thresholdContext).length !== 0
  ) {
    return { kind: 'INVALID', code: 'approval_payment_rule_invalid' };
  }
  return { kind: 'APPROVAL_REQUIRED', ruleId: rule.id };
}

const commandEntry: ApprovalCommandRegistryEntry = {
  actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
  containsSecretInput: false,
  serialize(input) {
    return parse(input);
  },
};

export function createSettingsPaymentMethodApprovalExecutionEntries(deps: {
  executeUpdate(
    input: ApprovedSettingsPaymentMethodUpdate,
  ): Promise<SettingsPaymentMethodMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const command = parse(payload);
        if (claim.shopId !== command.shopId) {
          throw new ApprovalTerminalCommandError('approval_payment_scope_invalid');
        }
        const result = await deps.executeUpdate({
          ...command,
          businessId: claim.businessId,
          approvalRequestId: claim.approvalRequestId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (!Number.isSafeInteger(result.editVersion) || result.editVersion < 1) {
          throw new Error('approval_payment_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

function commandId(
  actor: AdminApprovalActor,
  payload: SettingsPaymentMethodApprovalPayload,
): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION, actor.businessId, actor.employeeId, payload]))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function executeOrRequestSettingsPaymentMethodUpdate(
  payload: SettingsPaymentMethodApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<SettingsPaymentMethodMutationResult>,
): Promise<SettingsPaymentMethodApprovalResult> {
  const route = evaluateSettingsPaymentMethodRouting(payload, actor, rules);
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return direct();
  const rule = rules.find((entry) => entry.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes(rule.requesterPermission)) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: rule.id,
      actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
      commandId: commandId(actor, payload),
      commandInput: payload,
      reason: null,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry([commandEntry]),
  );
  if (result['ok'] !== true) {
    return { ok: false, code: typeof result['code'] === 'string' ? result['code'] : 'approval_request_failed' };
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
