import { createHash } from 'node:crypto';

import type {
  AdminApprovalActor,
  AdminApprovalRule,
  CatalogPublishResult,
} from '@tux/admin-contracts';
import { z } from 'zod';

import {
  ApprovalTerminalCommandError,
  type ApprovalExecutionRegistryEntry,
} from '../approvals/approvalExecutionService.js';
import {
  createApprovalCommandRegistry,
  requestApproval,
  type ApprovalCommandRegistryEntry,
  type ApprovalServiceDependencies,
} from '../approvals/approvalService.js';

export const CATALOG_PRICE_PUBLISH_ACTION = 'CATALOG_PRICE_PUBLISH';

const schema = z
  .object({
    shopId: z.string().uuid(),
    draftId: z.string().uuid(),
    expectedDraftRevision: z.number().int().safe().positive(),
    expectedVersion: z.number().int().safe().nonnegative(),
    maxPriceDeltaMinor: z.number().int().safe().nonnegative(),
    candidateFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();

export type CatalogPricePublishPayload = z.infer<typeof schema>;
export type ApprovedCatalogPricePublish = CatalogPricePublishPayload & {
  businessId: string;
  approvalRequestId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  approvalCommandId: string;
};
export type CatalogPricePublishApprovalResult =
  | CatalogPublishResult
  | { ok: true; idempotentReplay: true }
  | { ok: true; state: 'PENDING_APPROVAL'; approvalRequestId: string }
  | { ok: false; code: string; currentVersion?: number; currentDraftRevision?: number };

function parse(value: unknown): CatalogPricePublishPayload {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApprovalTerminalCommandError('approval_catalog_price_payload_invalid');
  return parsed.data;
}

export type CatalogPricePublishRouting =
  | { kind: 'DIRECT' }
  | { kind: 'APPROVAL_REQUIRED'; ruleId: string }
  | { kind: 'INVALID'; code: string };

export function evaluateCatalogPricePublishRouting(
  payload: CatalogPricePublishPayload,
  actor: Pick<AdminApprovalActor, 'businessId'>,
  rules: readonly AdminApprovalRule[],
): CatalogPricePublishRouting {
  if (!schema.safeParse(payload).success) {
    return { kind: 'INVALID', code: 'invalid_catalog_price_publish' };
  }
  if (payload.maxPriceDeltaMinor === 0) return { kind: 'DIRECT' };
  const applicable = rules.filter(
    (rule) =>
      rule.active &&
      rule.businessId === actor.businessId &&
      rule.actionType === CATALOG_PRICE_PUBLISH_ACTION &&
      (rule.shopId === null || rule.shopId === payload.shopId),
  );
  const rule =
    applicable.find((entry) => entry.shopId === payload.shopId) ??
    applicable.find((entry) => entry.shopId === null);
  if (!rule) return { kind: 'DIRECT' };
  const rawMinimum = rule.thresholdContext['minimumMinor'];
  const minimum =
    rawMinimum === undefined ? 0 : typeof rawMinimum === 'number' ? rawMinimum : Number.NaN;
  if (
    rule.requesterPermission !== 'catalog.pricing' ||
    rule.approverPermission !== 'approvals.review' ||
    !rule.requiresSecondPerson ||
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    Object.keys(rule.thresholdContext).some((key) => key !== 'minimumMinor')
  ) {
    return { kind: 'INVALID', code: 'approval_catalog_price_rule_invalid' };
  }
  if (payload.maxPriceDeltaMinor < minimum) return { kind: 'DIRECT' };
  return { kind: 'APPROVAL_REQUIRED', ruleId: rule.id };
}

const entry: ApprovalCommandRegistryEntry = {
  actionType: CATALOG_PRICE_PUBLISH_ACTION,
  containsSecretInput: false,
  serialize(value) {
    return parse(value);
  },
};

export function createCatalogPricePublishApprovalExecutionEntries(deps: {
  publish(input: ApprovedCatalogPricePublish): Promise<CatalogPublishResult>;
}): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: CATALOG_PRICE_PUBLISH_ACTION,
      async execute({ payload, claim }) {
        const command = parse(payload);
        if (command.shopId !== claim.shopId) {
          throw new ApprovalTerminalCommandError('approval_catalog_price_scope_invalid');
        }
        const result = await deps.publish({
          ...command,
          businessId: claim.businessId,
          approvalRequestId: claim.approvalRequestId,
          requesterEmployeeId: claim.requesterEmployeeId,
          approverEmployeeId: claim.approverEmployeeId,
          approvalCommandId: claim.commandId,
        });
        if (!result.ok) throw new ApprovalTerminalCommandError(result.code);
        if (!Number.isSafeInteger(result.publishVersion) || result.publishVersion < 1) {
          throw new Error('approval_catalog_price_result_invalid');
        }
        return { result, idempotentReplay: false };
      },
    },
  ];
}

function stableCommandId(actor: AdminApprovalActor, payload: CatalogPricePublishPayload): string {
  const hex = createHash('sha256')
    .update(
      JSON.stringify([CATALOG_PRICE_PUBLISH_ACTION, actor.businessId, actor.employeeId, payload]),
    )
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function executeOrRequestCatalogPricePublish(
  payload: CatalogPricePublishPayload,
  actor: AdminApprovalActor,
  rules: readonly AdminApprovalRule[],
  deps: ApprovalServiceDependencies,
  requesterPin: string | undefined,
  direct: () => Promise<CatalogPublishResult>,
): Promise<CatalogPricePublishApprovalResult> {
  const route = evaluateCatalogPricePublishRouting(payload, actor, rules);
  if (route.kind === 'INVALID') return { ok: false, code: route.code };
  if (route.kind === 'DIRECT') return direct();
  const rule = rules.find((item) => item.id === route.ruleId);
  if (!rule) return { ok: false, code: 'approval_rule_resolution_failed' };
  if (actor.role !== 'OWNER' && !actor.permissions.includes(rule.requesterPermission)) {
    return { ok: false, code: 'approval_requester_not_authorized' };
  }
  const result = await requestApproval(
    {
      businessId: actor.businessId,
      shopId: payload.shopId,
      ruleId: rule.id,
      actionType: CATALOG_PRICE_PUBLISH_ACTION,
      commandId: stableCommandId(actor, payload),
      commandInput: payload,
      reason: null,
      ...(requesterPin === undefined ? {} : { requesterPin }),
    },
    actor,
    deps,
    createApprovalCommandRegistry([entry]),
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
