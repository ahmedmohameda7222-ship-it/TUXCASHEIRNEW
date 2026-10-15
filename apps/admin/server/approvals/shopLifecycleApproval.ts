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

export const SHOP_LIFECYCLE_APPROVAL_ACTION = 'SHOP_LIFECYCLE_CHANGE';

const payloadSchema = z
  .object({
    shopId: z.string().uuid(),
    expectedLifecycleRevision: z.number().int().safe().positive(),
    expectedState: z.enum(['ACTIVE', 'SUSPENDED']),
    targetState: z.enum(['ACTIVE', 'SUSPENDED']),
  })
  .strict()
  .refine((value) => value.expectedState !== value.targetState);

export type ShopLifecycleApprovalPayload = z.infer<typeof payloadSchema>;
export type ApprovedShopLifecycleInput = ShopLifecycleApprovalPayload & {
  approvalRequestId: string;
  businessId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  originalCommandId: string;
};

export type ShopLifecycleApprovalResult =
  | { ok: true; lifecycleRevision?: number; idempotentReplay?: boolean }
  | {
      ok: true;
      state: 'PENDING_APPROVAL';
      approvalRequestId: string;
      idempotentReplay?: boolean;
    }
  | { ok: false; code: string; currentVersion?: number };

export type ApprovedShopLifecycleMutationResult =
  | { ok: true; lifecycleRevision: number; idempotentReplay?: boolean }
  | { ok: false; code: string; currentVersion?: number };

function parsePayload(input: unknown): ShopLifecycleApprovalPayload {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalTerminalCommandError('approval_shop_lifecycle_payload_invalid');
  }
  return parsed.data;
}

export function createShopLifecycleApprovalCommandEntries(): readonly ApprovalCommandRegistryEntry[] {
  return [
    {
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize(input) {
        return parsePayload(input);
      },
    },
  ];
}

export function createShopLifecycleApprovalExecutionEntries(deps: {
  executeLifecycle(input: ApprovedShopLifecycleInput): Promise<ApprovedShopLifecycleMutationResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const input = parsePayload(payload);
        if (claim.shopId === null || claim.shopId !== input.shopId) {
          throw new ApprovalTerminalCommandError('approval_shop_lifecycle_scope_invalid');
        }
        const result = await deps.executeLifecycle({
          ...input,
          approvalRequestId: claim.approvalRequestId,
          businessId: claim.businessId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          originalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (!Number.isSafeInteger(result.lifecycleRevision) || result.lifecycleRevision < 1) {
          throw new Error('approval_shop_lifecycle_result_invalid');
        }
        return { result, idempotentReplay: result.idempotentReplay === true };
      },
    },
  ];
}

export type ShopLifecycleApprovalRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateShopLifecycleApprovalRouting(
  input: ShopLifecycleApprovalPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): ShopLifecycleApprovalRouting {
  if (!payloadSchema.safeParse(input).success) {
    return { kind: 'INVALID', code: 'invalid_lifecycle_transition' };
  }
  const matching = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === SHOP_LIFECYCLE_APPROVAL_ACTION &&
      (rule.shopId === null || rule.shopId === input.shopId),
  );
  const rule =
    matching.find((entry) => entry.shopId === input.shopId) ??
    matching.find((entry) => entry.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  if (
    Object.keys(rule.thresholdContext).length !== 0 ||
    rule.requesterPermission !== 'shops.manage'
  ) {
    return { kind: 'INVALID', code: 'approval_shop_lifecycle_rule_invalid' };
  }
  return { kind: 'APPROVAL_REQUIRED', ruleId: rule.id };
}

function stableLifecycleApprovalCommandId(
  actor: Pick<AdminApprovalActor, 'businessId' | 'employeeId'>,
  payload: ShopLifecycleApprovalPayload,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        SHOP_LIFECYCLE_APPROVAL_ACTION,
        actor.businessId,
        actor.employeeId,
        payload.shopId,
        payload.expectedLifecycleRevision,
        payload.expectedState,
        payload.targetState,
      ]),
    )
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export async function executeOrRequestShopLifecycle(
  payload: ShopLifecycleApprovalPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  executeDirect: () => Promise<ShopLifecycleApprovalResult>,
): Promise<ShopLifecycleApprovalResult> {
  const route = evaluateShopLifecycleApprovalRouting(payload, actor, rules);
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return executeDirect();
  const rule = rules.find((entry) => entry.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes(rule.requesterPermission)) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }
  const commandId = stableLifecycleApprovalCommandId(actor, payload);
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: route.ruleId,
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      commandId,
      commandInput: payload,
      reason: null,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry(createShopLifecycleApprovalCommandEntries()),
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
  if (result['status'] === 'EXECUTED') return { ok: true, idempotentReplay: true };
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
