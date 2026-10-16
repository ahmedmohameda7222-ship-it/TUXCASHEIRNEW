import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from '../approvals/approvalService';
import { APPROVAL_RULE_ACTIONS } from '../approvals/approvalRuleActions';
import {
  CATALOG_PRICE_PUBLISH_ACTION,
  createCatalogPricePublishApprovalExecutionEntries,
  evaluateCatalogPricePublishRouting,
  executeOrRequestCatalogPricePublish,
} from './catalogPricePublishApproval';

const actor: AdminApprovalActor = {
  employeeId: 'a0000000-0000-4000-8000-000000000001',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['catalog.publish', 'catalog.pricing', 'approvals.review'],
  shopIds: ['c0000000-0000-4000-8000-000000000001'],
  sessionId: 'd0000000-0000-4000-8000-000000000001',
};
const payload = {
  shopId: actor.shopIds[0]!,
  draftId: 'e0000000-0000-4000-8000-000000000001',
  expectedDraftRevision: 3,
  expectedVersion: 2,
  maxPriceDeltaMinor: 4500,
  candidateFingerprint: 'a'.repeat(32),
};
const rule: AdminApprovalRule = {
  id: 'f0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId: payload.shopId,
  actionType: 'CATALOG_PRICE_PUBLISH',
  requesterPermission: 'catalog.pricing',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: { minimumMinor: 4000 },
  active: true,
};

describe('Catalog large price publication approval', () => {
  it('advertises only a true price-publishing runner with money threshold', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: CATALOG_PRICE_PUBLISH_ACTION,
      label: 'Large catalog price publication',
      requesterPermission: 'catalog.pricing',
      thresholdKind: 'minimumMinor',
    });
  });
  it('routes live computed deltas with shop-specific rule before business fallback', () => {
    const broad = { ...rule, shopId: null, id: 'business-wide' };
    expect(evaluateCatalogPricePublishRouting(payload, actor, [])).toEqual({ kind: 'DIRECT' });
    expect(evaluateCatalogPricePublishRouting({ ...payload, maxPriceDeltaMinor: 3999 },
      actor, [rule])).toEqual({ kind: 'DIRECT' });
    expect(evaluateCatalogPricePublishRouting(payload, actor, [broad, rule]))
      .toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: rule.id });
    expect(evaluateCatalogPricePublishRouting(payload, actor, [
      { ...rule, thresholdContext: { minimumMinor: -1 } },
    ])).toEqual({ kind: 'INVALID', code: 'approval_catalog_price_rule_invalid' });
    expect(evaluateCatalogPricePublishRouting({
      ...payload, candidateFingerprint: 'not-a-hash',
    }, actor, [rule])).toEqual({ kind: 'INVALID', code: 'invalid_catalog_price_publish' });
  });
  it('queues exact catalog revision, publish CAS and price impact without publishing', async () => {
    const createRequest = vi.fn(async (input: Parameters<ApprovalServiceDependencies['createRequest']>[0]) => ({
      ok: true, requestId: 'f0000000-0000-4000-8000-000000000002',
      status: 'PENDING' as const,
      persistedPayload: input.commandPayload,
    }));
    const deps: ApprovalServiceDependencies = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest,
      now: () => new Date('2026-10-16T00:00:00Z'),
    };
    const direct = vi.fn(async () => ({
      ok: true as const, draftId: payload.draftId,
      publishVersion: 3, operationsConfigurationVersion: 3,
    }));
    const result = await executeOrRequestCatalogPricePublish(payload, actor, [rule],
      deps, undefined, direct);
    expect(result).toEqual({ ok: true, state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002' });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      actionType: CATALOG_PRICE_PUBLISH_ACTION,
      requesterEmployeeId: actor.employeeId,
      commandPayload: payload,
    }));
  });
  it('rejects foreign worker claim and retains trusted actor identity', async () => {
    const publish = vi.fn(async () => ({
      ok: true as const, draftId: payload.draftId,
      publishVersion: 3, operationsConfigurationVersion: 3,
    }));
    const [entry] = createCatalogPricePublishApprovalExecutionEntries({ publish });
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
      businessId: actor.businessId, shopId: payload.shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      actionType: CATALOG_PRICE_PUBLISH_ACTION,
      commandId: 'f0000000-0000-4000-8000-000000000003',
      commandPayload: payload, claimToken: 'lease', attemptCount: 1,
      leaseExpiresAt: '2026-10-16T01:00:00Z',
    };
    await expect(entry!.execute({ payload, commandId: claim.commandId, claim: {
      ...claim, shopId: 'c0000000-0000-4000-8000-000000000002',
    } })).rejects.toThrow('approval_catalog_price_scope_invalid');
    await entry!.execute({ payload, commandId: claim.commandId, claim });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      ...payload, businessId: actor.businessId,
      approvalRequestId: claim.approvalRequestId,
      approverEmployeeId: claim.approverEmployeeId,
      approvalCommandId: claim.commandId,
    }));
  });
});
