import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from './approvalService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import { approvalRuleWriteSchema } from './approvalRulesRoute';
import {
  SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
  createSettingsPaymentMethodApprovalExecutionEntries,
  evaluateSettingsPaymentMethodRouting,
  executeOrRequestSettingsPaymentMethodUpdate,
} from './settingsPaymentMethodApproval';

const actor: AdminApprovalActor = {
  employeeId: 'a0000000-0000-4000-8000-000000000001',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['settings.manage', 'approvals.review'],
  shopIds: ['c0000000-0000-4000-8000-000000000001'],
  sessionId: 'd0000000-0000-4000-8000-000000000001',
};
const shopId = actor.shopIds[0]!;
const payload = {
  shopId,
  paymentMethodId: 'e0000000-0000-4000-8000-000000000001',
  displayName: 'Card',
  active: true,
  sortOrder: 1,
  channel: 'BOTH' as const,
  requiresReference: false,
  manualConfirmationRequired: false,
  refundAllowed: true,
  expectedSettingsVersion: 3,
  expectedEditVersion: 2,
};
const rule: AdminApprovalRule = {
  id: 'f0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId,
  actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
  requesterPermission: 'settings.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

describe('Sensitive payment-method update approval', () => {
  it('rejects false second-person policy and unsupported payment thresholds', () => {
    const base = {
      type: 'rule.upsert' as const,
      ruleId: null,
      shopId,
      actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
      requesterPermission: 'settings.manage' as const,
      approverPermission: 'approvals.review' as const,
      requiresSecondPerson: true,
      requiresRequesterRepin: false,
      expiresAfterSeconds: 3600,
      threshold: { kind: 'none' as const },
      active: true,
      expectedVersion: null,
    };
    expect(approvalRuleWriteSchema.safeParse(base).success).toBe(true);
    expect(approvalRuleWriteSchema.safeParse({ ...base, requiresSecondPerson: false }).success).toBe(false);
    expect(approvalRuleWriteSchema.safeParse({
      ...base, threshold: { kind: 'minimumMinor', value: 1 },
    }).success).toBe(false);
  });
  it('advertises a real discrete payment update runner, not all Settings writes', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
      label: 'Payment method updates',
      requesterPermission: 'settings.manage',
      thresholdKind: null,
    });
  });
  it('prefers shop rule, rejects malformed thresholds and invalid changes', () => {
    const fallback = { ...rule, shopId: null };
    expect(evaluateSettingsPaymentMethodRouting(payload, actor, [])).toEqual({ kind: 'DIRECT' });
    expect(evaluateSettingsPaymentMethodRouting(payload, actor, [fallback, rule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: rule.id,
    });
    expect(
      evaluateSettingsPaymentMethodRouting(payload, actor, [
        { ...rule, thresholdContext: { minimumMinor: 1 } },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'approval_payment_rule_invalid' });
    expect(
      evaluateSettingsPaymentMethodRouting({ ...payload, expectedEditVersion: -1 }, actor, [rule]),
    ).toEqual({ kind: 'INVALID', code: 'invalid_payment_method_change' });
  });
  it('queues an exact CAS payload without calling the direct updater', async () => {
    const createRequest = vi.fn(
      async (input: Parameters<ApprovalServiceDependencies['createRequest']>[0]) => ({
        ok: true,
        requestId: 'f0000000-0000-4000-8000-000000000002',
        status: 'PENDING' as const,
        persistedPayload: input.commandPayload,
      }),
    );
    const deps: ApprovalServiceDependencies = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest,
      now: () => new Date('2026-10-16T00:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, editVersion: 3 }));
    const outcome = await executeOrRequestSettingsPaymentMethodUpdate(
      payload,
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    expect(outcome).toEqual({
      ok: true,
      state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
    });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
        requesterEmployeeId: actor.employeeId,
        commandPayload: payload,
      }),
    );
  });
  it('uses a stable command for exact retries and changes it for a changed edit revision', async () => {
    const ids: string[] = [];
    const deps: ApprovalServiceDependencies = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input) => {
        ids.push(input.commandId);
        return {
          ok: true,
          requestId: 'f0000000-0000-4000-8000-000000000002',
          status: 'PENDING' as const,
        };
      }),
      now: () => new Date('2026-10-16T00:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, editVersion: 3 }));
    await executeOrRequestSettingsPaymentMethodUpdate(
      payload,
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    await executeOrRequestSettingsPaymentMethodUpdate(
      payload,
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    await executeOrRequestSettingsPaymentMethodUpdate(
      { ...payload, expectedEditVersion: 3 },
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(direct).not.toHaveBeenCalled();
  });
  it('rejects foreign runner claim and forwards exact authenticated identity', async () => {
    const executeUpdate = vi.fn(async () => ({ ok: true as const, editVersion: 3 }));
    const [entry] = createSettingsPaymentMethodApprovalExecutionEntries({ executeUpdate });
    expect(entry).toBeDefined();
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
      businessId: actor.businessId,
      shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      actionType: SETTINGS_PAYMENT_METHOD_APPROVAL_ACTION,
      commandId: 'f0000000-0000-4000-8000-000000000003',
      commandPayload: payload,
      claimToken: 'claim',
      attemptCount: 1,
      leaseExpiresAt: '2026-10-16T01:00:00Z',
    };
    await expect(
      entry!.execute({
        commandId: claim.commandId,
        payload,
        claim: {
          ...claim,
          shopId: 'c0000000-0000-4000-8000-000000000002',
        },
      }),
    ).rejects.toThrow('approval_payment_scope_invalid');
    await entry!.execute({ commandId: claim.commandId, payload, claim });
    expect(executeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...payload,
        businessId: actor.businessId,
        approvalRequestId: claim.approvalRequestId,
        approverEmployeeId: claim.approverEmployeeId,
      }),
    );
  });
});
