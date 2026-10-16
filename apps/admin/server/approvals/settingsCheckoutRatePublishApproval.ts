import { createHash } from 'node:crypto';

import type { AdminApprovalActor, AdminApprovalRule, SettingsPublishResult } from '@tux/admin-contracts';
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

export const SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION = 'SETTINGS_CHECKOUT_RATE_PUBLISH';

const schema = z.object({
  shopId: z.string().uuid(),
  expectedSettingsVersion: z.number().int().nonnegative().safe(),
  payloadFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();

export type SettingsCheckoutRatePublishPayload = z.infer<typeof schema>;
export type ApprovedSettingsCheckoutRatePublish = SettingsCheckoutRatePublishPayload & {
  businessId: string;
  approvalRequestId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};
export type SettingsCheckoutRatePublishResult =
  | SettingsPublishResult
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string }
  | { ok: true; idempotentReplay: true };

function parse(input: unknown): SettingsCheckoutRatePublishPayload {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_checkout_rate_payload_invalid');
  }
  return parsed.data;
}

export type SettingsCheckoutRatePublishRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateSettingsCheckoutRatePublishRouting(
  payload: SettingsCheckoutRatePublishPayload,
  ratesChanged: boolean,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): SettingsCheckoutRatePublishRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'invalid_checkout_rate_publish' };
  }
  if (!ratesChanged) return { kind: 'DIRECT' };
  const matching = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION &&
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
    return { kind: 'INVALID', code: 'approval_checkout_rate_rule_invalid' };
  }
  return { kind: 'APPROVAL_REQUIRED', ruleId: rule.id };
}

const commandEntry: ApprovalCommandRegistryEntry = {
  actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
  containsSecretInput: false,
  serialize(input) {
    return parse(input);
  },
};

export function createSettingsCheckoutRateApprovalExecutionEntries(deps: {
  publish(input: ApprovedSettingsCheckoutRatePublish): Promise<SettingsPublishResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [{
    actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
    async execute({ payload, claim }) {
      const command = parse(payload);
      if (claim.shopId !== command.shopId) {
        throw new ApprovalTerminalCommandError('approval_checkout_rate_scope_invalid');
      }
      const result = await deps.publish({
        ...command,
        businessId: claim.businessId,
        approvalRequestId: claim.approvalRequestId,
        requesterEmployeeId: claim.requesterEmployeeId,
        approverEmployeeId: claim.approverEmployeeId,
        approvalCommandId: claim.commandId,
      });
      if (!result.ok) {
        throw new ApprovalTerminalCommandError(result.code);
      }
      if (!Number.isSafeInteger(result.settingsVersion) || result.settingsVersion < 1) {
        throw new Error('approval_checkout_rate_result_invalid');
      }
      return { result, idempotentReplay: false };
    },
  }];
}

function commandId(actor: AdminApprovalActor, payload: SettingsCheckoutRatePublishPayload): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([
      SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION, actor.businessId, actor.employeeId, payload,
    ]))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function executeOrRequestSettingsCheckoutRatePublish(
  payload: SettingsCheckoutRatePublishPayload,
  ratesChanged: boolean,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<SettingsPublishResult>,
): Promise<SettingsCheckoutRatePublishResult> {
  const route = evaluateSettingsCheckoutRatePublishRouting(payload, ratesChanged, actor, rules);
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
      actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
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
