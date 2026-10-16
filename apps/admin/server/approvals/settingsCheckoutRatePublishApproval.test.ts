import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from './approvalService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import {
  SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
  createSettingsCheckoutRateApprovalExecutionEntries,
  evaluateSettingsCheckoutRatePublishRouting,
  executeOrRequestSettingsCheckoutRatePublish,
} from './settingsCheckoutRatePublishApproval';

const actor: AdminApprovalActor = {
  employeeId: 'a0000000-0000-4000-8000-000000000001',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['settings.manage', 'approvals.review'],
  shopIds: ['c0000000-0000-4000-8000-000000000001'],
  sessionId: 'd0000000-0000-4000-8000-000000000001',
};
const payload = {
  shopId: actor.shopIds[0]!,
  expectedSettingsVersion: 7,
  payloadFingerprint: 'abcdef0123456789abcdef0123456789',
};
const rule: AdminApprovalRule = {
  id: 'f0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId: payload.shopId,
  actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
  requesterPermission: 'settings.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

describe('Checkout tax/service publication: optional two-person approval', () => {
  it('advertises only real rate-sensitive publication, not arbitrary staged settings', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
      label: 'Checkout tax / service rate publication',
      requesterPermission: 'settings.manage',
      thresholdKind: null,
    });
  });
  it('bypasses approval for unchanged rates and uses shop-first rule for changed rates', () => {
    const broad = { ...rule, id: 'business-wide', shopId: null };
    expect(evaluateSettingsCheckoutRatePublishRouting(payload, false, actor, [rule]))
      .toEqual({ kind: 'DIRECT' });
    expect(evaluateSettingsCheckoutRatePublishRouting(payload, true, actor, []))
      .toEqual({ kind: 'DIRECT' });
    expect(evaluateSettingsCheckoutRatePublishRouting(payload, true, actor, [broad, rule]))
      .toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: rule.id });
    expect(evaluateSettingsCheckoutRatePublishRouting(payload, true, actor, [
      { ...rule, thresholdContext: { minimumMinor: 100 } },
    ])).toEqual({ kind: 'INVALID', code: 'approval_checkout_rate_rule_invalid' });
    expect(evaluateSettingsCheckoutRatePublishRouting({
      ...payload, payloadFingerprint: 'invalid',
    }, true, actor, [rule])).toEqual({
      kind: 'INVALID', code: 'invalid_checkout_rate_publish',
    });
  });
  it('persists the exact snapshot hash and does not publish while pending', async () => {
    const createRequest = vi.fn(async (input: Parameters<ApprovalServiceDependencies['createRequest']>[0]) => ({
      ok: true, requestId: 'f0000000-0000-4000-8000-000000000002',
      status: 'PENDING' as const, persistedPayload: input.commandPayload,
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
      ok: true as const, settingsVersion: 8, operationsConfigurationVersion: 8,
    }));
    const actual = await executeOrRequestSettingsCheckoutRatePublish(
      payload, true, actor, [rule], deps, undefined, direct,
    );
    expect(actual).toEqual({
      ok: true, state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
    });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
      requesterEmployeeId: actor.employeeId,
      commandPayload: payload,
    }));
  });
  it('keeps exact command identity for retry but changes it when the payload fingerprint changes', async () => {
    const ids: string[] = [];
    const deps: ApprovalServiceDependencies = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input) => {
        ids.push(input.commandId);
        return {
          ok: true, requestId: 'f0000000-0000-4000-8000-000000000002',
          status: 'PENDING' as const,
        };
      }),
      now: () => new Date('2026-10-16T00:00:00Z'),
    };
    const direct = vi.fn(async () => ({
      ok: true as const, settingsVersion: 8, operationsConfigurationVersion: 8,
    }));
    await executeOrRequestSettingsCheckoutRatePublish(payload, true, actor, [rule], deps, undefined, direct);
    await executeOrRequestSettingsCheckoutRatePublish(payload, true, actor, [rule], deps, undefined, direct);
    await executeOrRequestSettingsCheckoutRatePublish({
      ...payload, payloadFingerprint: '00000000000000000000000000000000',
    }, true, actor, [rule], deps, undefined, direct);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(direct).not.toHaveBeenCalled();
  });
  it('does not forward a foreign-shop claim to the trusted publisher', async () => {
    const publish = vi.fn(async () => ({
      ok: true as const, settingsVersion: 8, operationsConfigurationVersion: 8,
    }));
    const [entry] = createSettingsCheckoutRateApprovalExecutionEntries({ publish });
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
      businessId: actor.businessId, shopId: payload.shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      actionType: SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
      commandId: 'f0000000-0000-4000-8000-000000000003',
      commandPayload: payload,
      claimToken: 'claim', attemptCount: 1, leaseExpiresAt: '2026-10-16T01:00:00Z',
    };
    await expect(entry!.execute({ commandId: claim.commandId, payload, claim: {
      ...claim, shopId: 'c0000000-0000-4000-8000-000000000002',
    } })).rejects.toThrow('approval_checkout_rate_scope_invalid');
    await entry!.execute({ commandId: claim.commandId, payload, claim });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      ...payload, businessId: actor.businessId,
      approvalRequestId: claim.approvalRequestId,
      approvalCommandId: claim.commandId,
    }));
  });
});
