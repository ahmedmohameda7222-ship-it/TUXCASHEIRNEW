import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApprovalTerminalCommandError } from './approvalExecutionService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';
import type { ApprovalServiceDependencies } from './approvalService';
import {
  createFinanceSnapshotApprovalExecutionEntries,
  evaluateFinanceSnapshotApprovalRouting,
  executeOrRequestFinanceSnapshotAdjustment,
  FINANCE_SNAPSHOT_APPROVAL_ACTION,
} from './financeSnapshotApproval';

type CreateRequestInput = Parameters<ApprovalServiceDependencies['createRequest']>[0];

const actor: AdminApprovalActor = {
  employeeId: 'a0000000-0000-4000-8000-000000000001',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['finance.adjust', 'approvals.review'],
  shopIds: ['c0000000-0000-4000-8000-000000000001'],
  sessionId: 'd0000000-0000-4000-8000-000000000001',
};
const shopId = actor.shopIds[0]!;
const payload = {
  shopId,
  snapshotId: 'e0000000-0000-4000-8000-000000000001',
  amountMinor: -500,
  reason: 'Correct recorded till amount',
  commandId: 'f0000000-0000-4000-8000-000000000001',
  expectedAdjustmentCount: 3,
};
const rule: AdminApprovalRule = {
  id: 'e0000000-0000-4000-8000-000000000002',
  businessId: actor.businessId,
  shopId,
  actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
  requesterPermission: 'finance.adjust',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: true,
  thresholdContext: { minimumMinor: 500 },
  active: true,
};

describe('Finance Snapshot second-person approval', () => {
  it('only exposes a callable financial adjustment action with trusted threshold', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      label: 'Financial Z correction',
      requesterPermission: 'finance.adjust',
      thresholdKind: 'minimumMinor',
    });
  });

  it('checks signed magnitude and shop-specific rule precedence', () => {
    const globalRule = {
      ...rule,
      id: 'f0000000-0000-4000-8000-000000000002',
      shopId: null,
    };
    const localRule = { ...rule, thresholdContext: { minimumMinor: 1_000 } };
    expect(evaluateFinanceSnapshotApprovalRouting(payload, actor, [])).toEqual({
      kind: 'DIRECT',
    });
    expect(evaluateFinanceSnapshotApprovalRouting(payload, actor, [globalRule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: globalRule.id,
    });
    expect(
      evaluateFinanceSnapshotApprovalRouting(payload, actor, [globalRule, localRule]),
    ).toEqual({ kind: 'DIRECT' });
    expect(
      evaluateFinanceSnapshotApprovalRouting(
        { ...payload, amountMinor: -1_000 },
        actor,
        [globalRule, localRule],
      ),
    ).toEqual({ kind: 'APPROVAL_REQUIRED', ruleId: localRule.id });
  });

  it('fails closed on invalid rules and malformed command payloads', () => {
    expect(
      evaluateFinanceSnapshotApprovalRouting(payload, actor, [
        { ...rule, thresholdContext: { minimumQuantityImpact: 1 } },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'finance_snapshot_approval_rule_invalid' });
    expect(
      evaluateFinanceSnapshotApprovalRouting({ ...payload, amountMinor: 0 }, actor, [rule]),
    ).toEqual({ kind: 'INVALID', code: 'finance_adjustment_invalid' });
    expect(
      evaluateFinanceSnapshotApprovalRouting(payload, actor, [
        { ...rule, requiresSecondPerson: false },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'finance_snapshot_approval_rule_invalid' });
  });

  it('creates a durable approval request without calling the direct Finance RPC', async () => {
    const requests: CreateRequestInput[] = [];
    const deps = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input: CreateRequestInput) => {
        requests.push(input);
        return {
          ok: true,
          requestId: 'f0000000-0000-4000-8000-000000000003',
          status: 'PENDING' as const,
        };
      }),
      now: () => new Date('2026-10-15T09:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, adjustmentId: 'posted' }));
    const result = await executeOrRequestFinanceSnapshotAdjustment(
      payload,
      actor,
      [rule],
      deps,
      '1234',
      direct,
    );
    expect(result).toMatchObject({
      ok: true,
      state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000003',
    });
    expect(direct).not.toHaveBeenCalled();
    expect(requests[0]).toMatchObject({
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      commandPayload: payload,
      requesterEmployeeId: actor.employeeId,
      shopId,
    });
    expect(JSON.stringify(requests[0])).not.toContain('1234');
  });

  it('preserves one command identity on retry but changes it for stale counts', async () => {
    const commands: string[] = [];
    const deps = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input: CreateRequestInput) => {
        commands.push(input.commandId);
        return {
          ok: true,
          requestId: 'f0000000-0000-4000-8000-000000000003',
          status: 'PENDING' as const,
        };
      }),
      now: () => new Date('2026-10-15T09:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const }));
    await executeOrRequestFinanceSnapshotAdjustment(payload, actor, [rule], deps, '1234', direct);
    await executeOrRequestFinanceSnapshotAdjustment(payload, actor, [rule], deps, '1234', direct);
    await executeOrRequestFinanceSnapshotAdjustment(
      { ...payload, expectedAdjustmentCount: 4 },
      actor,
      [rule],
      deps,
      '1234',
      direct,
    );
    expect(commands[0]).toBe(commands[1]);
    expect(commands[2]).not.toBe(commands[0]);
    expect(direct).not.toHaveBeenCalled();
  });

  it('worker rejects foreign claims and preserves exact serialized financial intent', async () => {
    const executeAdjustment = vi.fn(async () => ({
      ok: true as const,
      adjustmentId: 'f0000000-0000-4000-8000-000000000004',
      idempotentReplay: false,
    }));
    const entry = createFinanceSnapshotApprovalExecutionEntries({ executeAdjustment })[0]!;
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000003',
      businessId: actor.businessId,
      shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      commandId: 'f0000000-0000-4000-8000-000000000005',
      actionType: FINANCE_SNAPSHOT_APPROVAL_ACTION,
      commandPayload: payload,
      claimToken: 'claim-token',
      attemptCount: 1,
      leaseExpiresAt: '2026-10-15T10:00:00Z',
    };
    await expect(
      entry.execute({ payload, claim, commandId: claim.commandId }),
    ).resolves.toMatchObject({ result: { ok: true }, idempotentReplay: false });
    expect(executeAdjustment).toHaveBeenCalledWith({
      ...payload,
      approvalRequestId: claim.approvalRequestId,
      businessId: actor.businessId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: claim.approverEmployeeId,
      approvalCommandId: claim.commandId,
    });
    await expect(
      entry.execute({
        payload,
        claim: { ...claim, shopId: 'c0000000-0000-4000-8000-000000000002' },
        commandId: claim.commandId,
      }),
    ).rejects.toBeInstanceOf(ApprovalTerminalCommandError);
    expect(executeAdjustment).toHaveBeenCalledTimes(1);
  });
});
