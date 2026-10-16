import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from './approvalService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import { approvalRuleWriteSchema } from './approvalRulesRoute';
import {
  SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
  createSettingsPaymentZoneApprovalExecutionEntries,
  evaluateSettingsPaymentZoneRouting,
  executeOrRequestSettingsPaymentZoneUpdate,
} from './settingsPaymentZoneApproval';

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
  paymentMethodId: 'e0000000-0000-4000-8000-000000000001',
  deliveryZoneId: 'e0000000-0000-4000-8000-000000000002',
  allowed: false,
  expectedAllowed: null,
  expectedSettingsVersion: 3,
};
const rule: AdminApprovalRule = {
  id: 'f0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId: payload.shopId,
  actionType: SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
  requesterPermission: 'settings.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

describe('Payment zone restriction: optional second-person approval', () => {
  it('only advertises executable zone policy and rejects one-person/amount policies', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
      label: 'Payment zone restrictions',
      requesterPermission: 'settings.manage',
      thresholdKind: null,
    });
    const command = {
      type: 'rule.upsert' as const,
      ruleId: null,
      shopId: payload.shopId,
      actionType: SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
      requesterPermission: 'settings.manage' as const,
      approverPermission: 'approvals.review' as const,
      requiresSecondPerson: true,
      requiresRequesterRepin: false,
      expiresAfterSeconds: 3600,
      threshold: { kind: 'none' as const },
      active: true,
      expectedVersion: null,
    };
    expect(approvalRuleWriteSchema.safeParse(command).success).toBe(true);
    expect(approvalRuleWriteSchema.safeParse({ ...command, requiresSecondPerson: false }).success)
      .toBe(false);
    expect(approvalRuleWriteSchema.safeParse({
      ...command,
      threshold: { kind: 'minimumMinor', value: 1 },
    }).success).toBe(false);
  });
  it('selects specific shop rule and rejects invalid threshold or malformed CAS', () => {
    const fallback = { ...rule, shopId: null, id: 'fallback' };
    expect(evaluateSettingsPaymentZoneRouting(payload, actor, [])).toEqual({ kind: 'DIRECT' });
    expect(evaluateSettingsPaymentZoneRouting(payload, actor, [fallback, rule])).toEqual({
      kind: 'APPROVAL_REQUIRED', ruleId: rule.id,
    });
    expect(evaluateSettingsPaymentZoneRouting(payload, actor, [
      { ...rule, thresholdContext: { minimumMinor: 1 } },
    ])).toEqual({ kind: 'INVALID', code: 'approval_payment_zone_rule_invalid' });
    expect(evaluateSettingsPaymentZoneRouting({
      ...payload, expectedSettingsVersion: -1,
    }, actor, [rule])).toEqual({ kind: 'INVALID', code: 'invalid_payment_zone_change' });
  });
  it('never calls the mutation while a second-person request is pending', async () => {
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
    const direct = vi.fn(async () => ({ ok: true as const }));
    const result = await executeOrRequestSettingsPaymentZoneUpdate(
      payload, actor, [rule], deps, undefined, direct,
    );
    expect(result).toEqual({ ok: true, state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002' });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      actionType: SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION, commandPayload: payload,
    }));
  });
  it('stable command for exact retry and replay changes with optimistic state', async () => {
    const ids: string[] = [];
    const deps: ApprovalServiceDependencies = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input) => {
        ids.push(input.commandId);
        return { ok: true, requestId: 'f0000000-0000-4000-8000-000000000002', status: 'PENDING' as const };
      }),
      now: () => new Date('2026-10-16T00:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const }));
    await executeOrRequestSettingsPaymentZoneUpdate(payload, actor, [rule], deps, undefined, direct);
    await executeOrRequestSettingsPaymentZoneUpdate(payload, actor, [rule], deps, undefined, direct);
    await executeOrRequestSettingsPaymentZoneUpdate({
      ...payload, expectedAllowed: false,
    }, actor, [rule], deps, undefined, direct);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(direct).not.toHaveBeenCalled();
  });
  it('re-validates shop scope and forwards trusted claim identity to runner', async () => {
    const executeChange = vi.fn(async () => ({ ok: true as const }));
    const [entry] = createSettingsPaymentZoneApprovalExecutionEntries({ executeChange });
    expect(entry).toBeDefined();
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
      businessId: actor.businessId, shopId: payload.shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      actionType: SETTINGS_PAYMENT_ZONE_APPROVAL_ACTION,
      commandId: 'f0000000-0000-4000-8000-000000000003',
      commandPayload: payload,
      claimToken: 'claim', attemptCount: 1, leaseExpiresAt: '2026-10-16T01:00:00Z',
    };
    await expect(entry!.execute({ commandId: claim.commandId, payload, claim: {
      ...claim, shopId: 'c0000000-0000-4000-8000-000000000002',
    } })).rejects.toThrow('approval_payment_zone_scope_invalid');
    await entry!.execute({ commandId: claim.commandId, payload, claim });
    expect(executeChange).toHaveBeenCalledWith(expect.objectContaining({
      ...payload, businessId: actor.businessId, approvalRequestId: claim.approvalRequestId,
    }));
  });
});
