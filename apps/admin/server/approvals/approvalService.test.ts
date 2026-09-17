import type { AdminApprovalRule } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import {
  approveRequest,
  createApprovalCommandRegistry,
  createSupabaseApprovalServiceDependencies,
  requestApproval,
  serializeApprovalCommand,
  type ApprovalActor,
  type ApprovalRequestRecord,
  type ApprovalServiceDependencies,
  type RequestApprovalInput,
} from './approvalService';

const requester: ApprovalActor = {
  employeeId: 'employee-requester',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['approvals.review'],
  shopIds: ['shop-1'],
  sessionId: 'session-requester',
};

const approver: ApprovalActor = {
  employeeId: 'employee-approver',
  businessId: 'business-1',
  role: 'MANAGER',
  permissions: ['approvals.review'],
  shopIds: ['shop-1'],
  sessionId: 'session-approver',
};

const pendingRequest: ApprovalRequestRecord = {
  id: 'request-1',
  businessId: 'business-1',
  shopId: 'shop-1',
  requesterEmployeeId: requester.employeeId,
  actionType: 'INVENTORY_EMERGENCY_ADJUSTMENT',
  requiredApproverPermission: 'approvals.review',
  requiresSecondPerson: true,
  status: 'PENDING',
};

const approvalRule: AdminApprovalRule = {
  id: 'rule-1',
  businessId: 'business-1',
  shopId: 'shop-1',
  actionType: 'SAFE_TEST_COMMAND',
  requesterPermission: 'settings.manage',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  thresholdContext: {},
  active: true,
};

function dependencies(
  overrides: Partial<ApprovalServiceDependencies> = {},
): ApprovalServiceDependencies {
  return {
    loadRequest: vi.fn(async () => pendingRequest),
    loadRule: vi.fn(async () => approvalRule),
    verifyEmployeePin: vi.fn(async () => true),
    decideRequest: vi.fn(async ({ decision }) => ({
      ok: true as const,
      status: decision === 'APPROVE' ? ('APPROVED' as const) : ('REJECTED' as const),
    })),
    createRequest: vi.fn(async (input) => ({
      ok: true as const,
      requestId: 'request-1',
      status: 'PENDING' as const,
      persistedPayload: input.commandPayload,
    })),
    now: () => new Date('2026-09-16T12:00:00.000Z'),
    ...overrides,
  };
}

describe('approvalService', () => {
  it('rejects requester self-approval even with a valid PIN', async () => {
    const deps = dependencies();

    const result = await approveRequest(
      { requestId: pendingRequest.id, pin: '482731' },
      requester,
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'self_approval_forbidden' });
    expect(deps.verifyEmployeePin).not.toHaveBeenCalled();
    expect(deps.decideRequest).not.toHaveBeenCalled();
  });

  it('verifies the approver own PIN before recording an approval decision', async () => {
    const verifyEmployeePin = vi.fn(async () => false);
    const deps = dependencies({ verifyEmployeePin });

    const result = await approveRequest(
      { requestId: pendingRequest.id, pin: '482731' },
      approver,
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'invalid_pin' });
    expect(verifyEmployeePin).toHaveBeenCalledWith(approver.employeeId, '482731');
    expect(deps.decideRequest).not.toHaveBeenCalled();
  });

  it('rejects a shop-scoped manager from approving a business-wide request', async () => {
    const deps = dependencies({
      loadRequest: vi.fn(async () => ({ ...pendingRequest, shopId: null })),
    });

    const result = await approveRequest(
      { requestId: pendingRequest.id, pin: '482731' },
      approver,
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'approval_shop_scope_forbidden' });
    expect(deps.verifyEmployeePin).not.toHaveBeenCalled();
    expect(deps.decideRequest).not.toHaveBeenCalled();
  });

  it('rejects a shop-scoped manager from creating a business-wide request', async () => {
    const deps = dependencies();
    const registry = createApprovalCommandRegistry([
      {
        actionType: 'SAFE_TEST_COMMAND',
        containsSecretInput: false,
        serialize: (input: unknown) => ({ entityId: (input as { entityId: string }).entityId }),
      },
    ]);

    const result = await requestApproval(
      {
        businessId: 'business-1',
        shopId: null,
        ruleId: 'rule-1',
        actionType: 'SAFE_TEST_COMMAND',
        commandId: 'command-business-wide',
        commandInput: { entityId: 'entity-1' },
      },
      approver,
      deps,
      registry,
    );

    expect(result).toEqual({ ok: false, code: 'approval_shop_scope_forbidden' });
    expect(deps.createRequest).not.toHaveBeenCalled();
  });

  it('requires requester re-PIN when the persisted approval rule requires it without persisting the PIN', async () => {
    const sentinelPin = '482731';
    const verifyEmployeePin = vi.fn(async () => true);
    const createRequest = vi.fn(async (input) => ({
      ok: true as const,
      requestId: 'request-2',
      status: 'PENDING' as const,
      persistedPayload: input.commandPayload,
    }));
    const deps = dependencies({
      loadRule: vi.fn(async () => ({ ...approvalRule, requiresRequesterRepin: true })),
      verifyEmployeePin,
      createRequest,
    });
    const registry = createApprovalCommandRegistry([
      {
        actionType: 'SAFE_TEST_COMMAND',
        containsSecretInput: false,
        serialize: (input: unknown) => ({ entityId: (input as { entityId: string }).entityId }),
      },
    ]);

    const result = await requestApproval(
      {
        businessId: 'business-1',
        shopId: 'shop-1',
        ruleId: 'rule-1',
        actionType: 'SAFE_TEST_COMMAND',
        commandId: 'command-1',
        commandInput: { entityId: 'entity-1' },
        reason: 'Sensitive action',
        requesterPin: sentinelPin,
      },
      requester,
      deps,
      registry,
    );

    expect(result.ok).toBe(true);
    expect(verifyEmployeePin).toHaveBeenCalledWith(requester.employeeId, sentinelPin);
    const persisted = JSON.stringify(createRequest.mock.calls[0]?.[0] ?? {});
    expect(persisted).not.toContain(sentinelPin);
    expect(persisted).not.toContain('requesterPin');
  });

  it('derives requester re-PIN from the persisted rule instead of caller input', async () => {
    const sentinelPin = '482731';
    const verifyEmployeePin = vi.fn(async () => false);
    const createRequest = vi.fn(async () => ({
      ok: true as const,
      requestId: 'request-3',
      status: 'PENDING' as const,
    }));
    const deps = dependencies({
      loadRule: vi.fn(async () => ({ ...approvalRule, requiresRequesterRepin: true })),
      verifyEmployeePin,
      createRequest,
    });
    const registry = createApprovalCommandRegistry([
      {
        actionType: 'SAFE_TEST_COMMAND',
        containsSecretInput: false,
        serialize: (input: unknown) => ({ entityId: (input as { entityId: string }).entityId }),
      },
    ]);
    const untrustedInput = {
      businessId: 'business-1',
      shopId: 'shop-1',
      ruleId: 'rule-1',
      actionType: 'SAFE_TEST_COMMAND',
      commandId: 'command-2',
      commandInput: { entityId: 'entity-2' },
      requesterPin: sentinelPin,
      requiresRequesterRepin: false,
    } as unknown as RequestApprovalInput;

    const result = await requestApproval(untrustedInput, requester, deps, registry);

    expect(result).toEqual({ ok: false, code: 'invalid_pin' });
    expect(verifyEmployeePin).toHaveBeenCalledWith(requester.employeeId, sentinelPin);
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('preserves terminal status and replay metadata returned by request creation', async () => {
    const rpc = vi.fn(async () => ({
      ok: true,
      requestId: 'request-terminal',
      status: 'EXECUTED',
      idempotentReplay: true,
    }));
    const deps = createSupabaseApprovalServiceDependencies({
      rpc,
    } as unknown as AdminSupabaseClient);

    const result = await deps.createRequest({
      businessId: 'business-1',
      shopId: 'shop-1',
      requesterEmployeeId: 'employee-requester',
      requesterSessionId: 'session-requester',
      ruleId: 'rule-1',
      actionType: 'SAFE_TEST_COMMAND',
      commandId: 'command-terminal',
      commandPayload: { entityId: 'entity-terminal' },
      reason: null,
    });

    expect(result).toEqual({
      ok: true,
      requestId: 'request-terminal',
      status: 'EXECUTED',
      idempotentReplay: true,
    });
  });

  it('fails closed when a secret-bearing command has no explicit serializer', () => {
    const registry = createApprovalCommandRegistry([
      {
        actionType: 'EMPLOYEE_PIN_CHANGE',
        containsSecretInput: true,
      },
    ]);

    expect(() =>
      serializeApprovalCommand(registry, 'EMPLOYEE_PIN_CHANGE', {
        employeeId: 'employee-2',
        newPin: '482731',
      }),
    ).toThrowError('approval_secret_safe_serializer_required');
  });
});
