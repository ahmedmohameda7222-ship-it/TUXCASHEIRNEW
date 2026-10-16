import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from './approvalService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import {
  SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
  createPaymentMethodCreateApprovalExecutionEntries,
  evaluatePaymentMethodCreateRouting,
  executeOrRequestPaymentMethodCreate,
} from './settingsPaymentMethodCreateApproval';

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
  commandId: 'create-payment-method-91',
  displayName: 'Card',
  logicType: 'CARD' as const,
  active: true,
  sortOrder: 10,
  channel: 'BOTH' as const,
  requiresReference: true,
  manualConfirmationRequired: false,
  refundAllowed: true,
  expectedSettingsVersion: 3,
};
const rule: AdminApprovalRule = {
  id: 'f0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId: payload.shopId,
  actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
  requesterPermission: 'settings.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

describe('Payment method CREATE optional approval', () => {
  it('advertises a distinct executable action instead of reusing edit policy', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
      label: 'Payment method creation',
      requesterPermission: 'settings.manage',
      thresholdKind: null,
    });
  });
  it('routes shop-specific policy before business default, and rejects malformed rules', () => {
    expect(evaluatePaymentMethodCreateRouting(payload, actor, [])).toEqual({ kind: 'DIRECT' });
    expect(evaluatePaymentMethodCreateRouting(payload, actor, [
      { ...rule, shopId: null, id: 'fallback' }, rule,
    ])).toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: rule.id });
    expect(evaluatePaymentMethodCreateRouting(payload, actor, [
      { ...rule, requiresSecondPerson: false },
    ])).toEqual({ kind: 'INVALID', code: 'approval_payment_create_rule_invalid' });
    expect(evaluatePaymentMethodCreateRouting({
      ...payload, commandId: '',
    }, actor, [rule])).toEqual({ kind: 'INVALID', code: 'invalid_payment_method_create' });
  });
  it('creates a durable request with exact client idempotency key and never calls direct create', async () => {
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
      ok: true as const,
      paymentMethodId: 'f0000000-0000-4000-8000-000000000004',
      editVersion: 1,
    }));
    const result = await executeOrRequestPaymentMethodCreate(
      payload, actor, [rule], deps, undefined, direct,
    );
    expect(result).toEqual({
      ok: true,
      state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
    });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
      requesterEmployeeId: actor.employeeId,
      commandPayload: payload,
    }));
  });
  it('forwards only trusted claimed business/requester/approver to execution', async () => {
    const executeCreate = vi.fn(async () => ({
      ok: true as const, paymentMethodId: 'f0000000-0000-4000-8000-000000000004', editVersion: 1,
    }));
    const [entry] = createPaymentMethodCreateApprovalExecutionEntries({ executeCreate });
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000002',
      businessId: actor.businessId, shopId: payload.shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      actionType: SETTINGS_PAYMENT_METHOD_CREATE_ACTION,
      commandId: 'f0000000-0000-4000-8000-000000000003',
      commandPayload: payload, claimToken: 'lease', attemptCount: 1,
      leaseExpiresAt: '2026-10-16T01:00:00Z',
    };
    await expect(entry!.execute({ payload, commandId: claim.commandId, claim: {
      ...claim, shopId: 'c0000000-0000-4000-8000-000000000002',
    } })).rejects.toThrow('approval_payment_create_scope_invalid');
    await entry!.execute({ payload, commandId: claim.commandId, claim });
    expect(executeCreate).toHaveBeenCalledWith(expect.objectContaining({
      ...payload, businessId: actor.businessId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: claim.approverEmployeeId,
      approvalRequestId: claim.approvalRequestId,
      approvalCommandId: claim.commandId,
    }));
  });
});
