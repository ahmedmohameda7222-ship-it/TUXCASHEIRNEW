import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  CASHIER_RECONCILIATION_APPROVAL_ACTION,
  createCashierReconciliationApprovalExecutionEntries,
  evaluateCashierReconciliationRouting,
  executeOrRequestCashierReconciliation,
} from './financeCashierReconciliationApproval';

const shopId = '22222222-2222-4222-8222-222222222222';
const actor = {
  employeeId: '33333333-3333-4333-8333-333333333333',
  businessId: '11111111-1111-4111-8111-111111111111',
  role: 'OWNER',
  permissions: ['finance.reconcile', 'approvals.review'],
  shopIds: [shopId],
  sessionId: '44444444-4444-4444-8444-444444444444',
} as AdminApprovalActor;
const command = {
  shopId,
  businessDayId: '55555555-5555-4555-8555-555555555555',
  cashierWorkerId: '66666666-6666-4666-8666-666666666666',
  actualMinor: 1800,
  expectedMinor: 1300,
  reason: 'Drawer variance',
  commandId: '77777777-7777-4777-8777-777777777777',
};
const rule = {
  id: '88888888-8888-4888-8888-888888888888',
  businessId: actor.businessId,
  shopId,
  actionType: 'FINANCE_CASHIER_RECONCILIATION',
  requesterPermission: 'finance.reconcile',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: { minimumMinor: 500 },
  active: true,
} as AdminApprovalRule;

describe('cashier reconciliation trusted approval boundary', () => {
  it('uses trusted absolute drawer variance and prefers shop rules to business defaults', () => {
    expect(CASHIER_RECONCILIATION_APPROVAL_ACTION).toBe('FINANCE_CASHIER_RECONCILIATION');
    const defaultRule = { ...rule, id: 'business-rule', shopId: null };
    expect(evaluateCashierReconciliationRouting(command, 501, actor, [defaultRule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: 'business-rule',
    });
    expect(evaluateCashierReconciliationRouting(command, 500, actor, [defaultRule, rule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: rule.id,
    });
    expect(evaluateCashierReconciliationRouting(command, 499, actor, [rule])).toEqual({
      kind: 'DIRECT',
    });
    expect(evaluateCashierReconciliationRouting(command, -1, actor, [rule])).toEqual({
      kind: 'INVALID',
      code: 'finance_cashier_variance_invalid',
    });
    expect(
      evaluateCashierReconciliationRouting(command, 500, actor, [
        { ...rule, thresholdContext: { minimumMinor: 0 } },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'finance_cashier_rule_invalid' });
  });

  it('persists exact command without posting cash when second person is required', async () => {
    const createRequest = vi.fn(async () => ({
      ok: true,
      requestId: '99999999-9999-4999-8999-999999999999',
      status: 'PENDING' as const,
    }));
    const deps = {
      createRequest,
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      now: () => new Date('2026-10-15T12:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, reconciliationId: 'direct' }));
    const outcome = await executeOrRequestCashierReconciliation(
      command,
      500,
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    expect(outcome).toMatchObject({ ok: true, state: 'PENDING_APPROVAL' });
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });

  it('executes only the exact shop-scoped approved payload', async () => {
    const executeReconciliation = vi.fn(async () => ({
      ok: true as const,
      reconciliationId: '12345678-1234-4234-8234-123456789abc',
      idempotentReplay: false,
    }));
    const entry = createCashierReconciliationApprovalExecutionEntries({
      executeReconciliation,
    })[0]!;
    const claim = {
      approvalRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      businessId: actor.businessId,
      shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      actionType: CASHIER_RECONCILIATION_APPROVAL_ACTION,
      claimToken: 'durable-claim',
      commandPayload: command,
      attemptCount: 1,
      leaseExpiresAt: '2026-10-15T13:00:00Z',
    };
    await expect(
      entry.execute({ claim, payload: command, commandId: claim.commandId }),
    ).resolves.toMatchObject({ result: { ok: true }, idempotentReplay: false });
    expect(executeReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        ...command,
        approvalRequestId: claim.approvalRequestId,
        approvalCommandId: claim.commandId,
        approverEmployeeId: claim.approverEmployeeId,
      }),
    );
    await expect(
      entry.execute({
        claim: { ...claim, shopId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        payload: command,
        commandId: claim.commandId,
      }),
    ).rejects.toThrow();
    expect(executeReconciliation).toHaveBeenCalledTimes(1);
  });
});
