import type { AdminApprovalActor, AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createShopLifecycleApprovalExecutionEntries,
  evaluateShopLifecycleApprovalRouting,
  executeOrRequestShopLifecycle,
  SHOP_LIFECYCLE_APPROVAL_ACTION,
} from './shopLifecycleApproval';
import { ApprovalTerminalCommandError } from './approvalExecutionService';
import { APPROVAL_RULE_ACTIONS } from './approvalRuleActions';

const actor: AdminApprovalActor = {
  employeeId: 'a0000000-0000-4000-8000-000000000001',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  role: 'OWNER',
  permissions: ['shops.manage', 'approvals.review'],
  shopIds: ['c0000000-0000-4000-8000-000000000001'],
  sessionId: 'd0000000-0000-4000-8000-000000000001',
};
const shopId = actor.shopIds[0]!;
const payload = {
  shopId,
  expectedState: 'ACTIVE' as const,
  targetState: 'SUSPENDED' as const,
  expectedLifecycleRevision: 4,
};
const rule: AdminApprovalRule = {
  id: 'e0000000-0000-4000-8000-000000000001',
  businessId: actor.businessId,
  shopId,
  actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
  requesterPermission: 'shops.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

describe('Shop lifecycle approval: supported executable action', () => {
  it('lists only a real callable protected shop lifecycle approval action', () => {
    expect(APPROVAL_RULE_ACTIONS).toContainEqual({
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      label: 'Shop suspension / reactivation',
      requesterPermission: 'shops.manage',
      thresholdKind: null,
    });
  });

  it('resolves shop rules ahead of business defaults and fails closed on malformed thresholds', () => {
    const defaultRule = { ...rule, id: 'business-rule', shopId: null };
    expect(evaluateShopLifecycleApprovalRouting(payload, actor, [])).toEqual({ kind: 'DIRECT' });
    expect(evaluateShopLifecycleApprovalRouting(payload, actor, [defaultRule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: 'business-rule',
    });
    expect(evaluateShopLifecycleApprovalRouting(payload, actor, [defaultRule, rule])).toEqual({
      kind: 'APPROVAL_REQUIRED',
      ruleId: rule.id,
    });
    expect(
      evaluateShopLifecycleApprovalRouting(payload, actor, [
        { ...rule, thresholdContext: { minimumMinor: 500 } },
      ]),
    ).toEqual({ kind: 'INVALID', code: 'approval_shop_lifecycle_rule_invalid' });
    expect(
      evaluateShopLifecycleApprovalRouting(
        { ...payload, targetState: 'ACTIVE' },
        actor,
        [rule],
      ),
    ).toEqual({ kind: 'INVALID', code: 'invalid_lifecycle_transition' });
  });

  it('serializes exact CAS payload to approval request but never calls the direct mutation', async () => {
    const createRequest = vi.fn(async (input) => ({
      ok: true,
      requestId: 'f0000000-0000-4000-8000-000000000001',
      status: 'PENDING' as const,
      persistedPayload: input.commandPayload,
    }));
    const deps = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest,
      now: () => new Date('2026-10-15T07:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, lifecycleRevision: 5 }));
    const outcome = await executeOrRequestShopLifecycle(payload, actor, [rule], deps, undefined, direct);
    expect(outcome).toMatchObject({
      ok: true,
      state: 'PENDING_APPROVAL',
      approvalRequestId: 'f0000000-0000-4000-8000-000000000001',
    });
    expect(direct).not.toHaveBeenCalled();
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(createRequest.mock.calls[0]?.[0]).toMatchObject({
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      requesterEmployeeId: actor.employeeId,
      shopId,
      commandPayload: payload,
    });
  });

  it('replays stable approval command IDs and rejects a changed expected revision', async () => {
    const commands: string[] = [];
    const deps = {
      loadRequest: vi.fn(async () => null),
      loadRule: vi.fn(async () => rule),
      verifyEmployeePin: vi.fn(async () => true),
      decideRequest: vi.fn(async () => ({ ok: false as const, code: 'unused' })),
      createRequest: vi.fn(async (input) => {
        commands.push(input.commandId);
        return { ok: true, requestId: 'f0000000-0000-4000-8000-000000000001', status: 'PENDING' as const };
      }),
      now: () => new Date('2026-10-15T07:00:00Z'),
    };
    const direct = vi.fn(async () => ({ ok: true as const, lifecycleRevision: 5 }));
    await executeOrRequestShopLifecycle(payload, actor, [rule], deps, undefined, direct);
    await executeOrRequestShopLifecycle(payload, actor, [rule], deps, undefined, direct);
    await executeOrRequestShopLifecycle(
      { ...payload, expectedLifecycleRevision: 5 },
      actor,
      [rule],
      deps,
      undefined,
      direct,
    );
    expect(commands[0]).toBe(commands[1]);
    expect(commands[2]).not.toBe(commands[0]);
    expect(direct).not.toHaveBeenCalled();
  });

  it('runner rejects foreign shop claims and forwards exact authorized claim identities', async () => {
    const executeLifecycle = vi.fn(async () => ({
      ok: true as const,
      lifecycleRevision: 5,
      idempotentReplay: false,
    }));
    const [entry] = createShopLifecycleApprovalExecutionEntries({ executeLifecycle });
    expect(entry).toBeDefined();
    const claim = {
      approvalRequestId: 'f0000000-0000-4000-8000-000000000001',
      businessId: actor.businessId,
      shopId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: 'a0000000-0000-4000-8000-000000000002',
      commandId: 'f0000000-0000-4000-8000-000000000002',
      actionType: SHOP_LIFECYCLE_APPROVAL_ACTION,
      commandPayload: payload,
      claimToken: 'claim-token',
      attemptCount: 1,
      leaseExpiresAt: '2026-10-15T08:00:00Z',
    };
    await expect(entry!.execute({ payload, claim, commandId: claim.commandId })).resolves.toMatchObject({
      result: { lifecycleRevision: 5 },
      idempotentReplay: false,
    });
    expect(executeLifecycle).toHaveBeenCalledWith({
      ...payload,
      approvalRequestId: claim.approvalRequestId,
      businessId: actor.businessId,
      requesterEmployeeId: actor.employeeId,
      approverEmployeeId: claim.approverEmployeeId,
      originalCommandId: claim.commandId,
    });
    await expect(
      entry!.execute({
        payload,
        claim: { ...claim, shopId: 'd0000000-0000-4000-8000-000000000002' },
        commandId: claim.commandId,
      }),
    ).rejects.toBeInstanceOf(ApprovalTerminalCommandError);
    expect(executeLifecycle).toHaveBeenCalledTimes(1);
  });
});
