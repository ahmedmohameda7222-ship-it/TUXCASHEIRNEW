import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApprovalTerminalCommandError } from './approvalExecutionService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import type { ApprovalServiceDependencies } from './approvalService';
import {
  createOwnerWithdrawalApprovalExecutionEntries,
  evaluateOwnerWithdrawalRouting,
  executeOrRequestOwnerWithdrawal,
  OWNER_WITHDRAWAL_APPROVAL_ACTION,
} from './financeOwnerWithdrawalApproval';

type CreateRequestInput = Parameters<ApprovalServiceDependencies['createRequest']>[0];
const shopId = 'a2222222-2222-4222-8222-222222222222';
const actor: AdminApprovalActor = {
  employeeId: 'a3333333-3333-4333-8333-333333333333',
  businessId: 'a1111111-1111-4111-8111-111111111111',
  role: 'OWNER',
  permissions: ['finance.adjust', 'approvals.review'],
  shopIds: [shopId],
  sessionId: 'a4444444-4444-4444-8444-444444444444',
};
const payload = {
  shopId,
  accountId: 'a5555555-5555-4555-8555-555555555555',
  amountMinor: 500,
  reason: 'Owner draw',
  commandId: 'a6666666-6666-4666-8666-666666666666',
};
const rule: AdminApprovalRule = {
  id: 'a7777777-7777-4777-8777-777777777777',
  businessId: actor.businessId,
  shopId,
  actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
  requesterPermission: 'finance.adjust',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: true,
  thresholdContext: { minimumMinor: 500 },
  active: true,
};

describe('Owner withdrawal approval', () => {
  it('has an executable configurable threshold action', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
      label: 'Owner withdrawal',
      requesterPermission: 'finance.adjust',
      thresholdKind: 'minimumMinor',
    });
  });
  it('respects shop-specific threshold precedence and fails closed', () => {
    const business = { ...rule, id: 'business', shopId: null };
    const local = { ...rule, thresholdContext: { minimumMinor: 800 } };
    expect(evaluateOwnerWithdrawalRouting(payload, actor, [business])).toEqual({
      kind: 'APPROVAL_REQUIRED', ruleId: 'business',
    });
    expect(evaluateOwnerWithdrawalRouting(payload, actor, [business, local])).toEqual({
      kind: 'DIRECT',
    });
    expect(evaluateOwnerWithdrawalRouting({ ...payload, amountMinor: 800 }, actor, [local]))
      .toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: rule.id });
    expect(evaluateOwnerWithdrawalRouting(payload, actor, [
      { ...rule, requiresSecondPerson: false },
    ])).toEqual({ kind: 'INVALID', code: 'finance_owner_withdrawal_rule_invalid' });
    expect(evaluateOwnerWithdrawalRouting({ ...payload, amountMinor: 0 }, actor, [rule]))
      .toEqual({ kind: 'INVALID', code: 'finance_owner_withdrawal_invalid' });
  });
  it('makes durable requests without posting and retains command identity', async () => {
    const seen: CreateRequestInput[] = [];
    const deps = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input: CreateRequestInput) => {
        seen.push(input);
        return {
          ok: true, requestId: 'a8888888-8888-4888-8888-888888888888',
          status: 'PENDING' as const,
        };
      }),
      now: () => new Date('2026-10-15T08:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, commandId: payload.commandId }));
    const first = await executeOrRequestOwnerWithdrawal(
      payload, actor, [rule], deps, '123456', direct,
    );
    await executeOrRequestOwnerWithdrawal(payload, actor, [rule], deps, '123456', direct);
    expect(first).toMatchObject({ ok: true, state: 'PENDING_APPROVAL' });
    expect(direct).not.toHaveBeenCalled();
    expect(seen[0]?.commandId).toBe(seen[1]?.commandId);
    expect(seen[0]).toMatchObject({
      actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
      commandPayload: payload,
    });
  });
  it('requires matching shop in worker claim', async () => {
    const exec = vi.fn(async () => ({ ok: true as const, commandId: payload.commandId }));
    const entry = createOwnerWithdrawalApprovalExecutionEntries({
      executeWithdrawal: exec,
    })[0]!;
    const claim = {
      approvalRequestId: 'a8888888-8888-4888-8888-888888888888',
      businessId: actor.businessId,
      shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a9999999-9999-4999-8999-999999999999',
      commandId: 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      actionType: OWNER_WITHDRAWAL_APPROVAL_ACTION,
      commandPayload: payload,
      claimToken: 'claim-token',
      attemptCount: 1,
      leaseExpiresAt: '2026-10-15T09:00:00Z',
    };
    await expect(entry.execute({ payload, claim, commandId: claim.commandId }))
      .resolves.toMatchObject({ idempotentReplay: false });
    await expect(entry.execute({
      payload, claim: { ...claim, shopId: actor.businessId }, commandId: claim.commandId,
    })).rejects.toBeInstanceOf(ApprovalTerminalCommandError);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
