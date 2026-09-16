import { describe, expect, it, vi } from 'vitest';

import {
  approveRequest,
  createApprovalCommandRegistry,
  requestApproval,
  serializeApprovalCommand,
  type ApprovalActor,
  type ApprovalRequestRecord,
  type ApprovalServiceDependencies,
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

function dependencies(
  overrides: Partial<ApprovalServiceDependencies> = {},
): ApprovalServiceDependencies {
  return {
    loadRequest: vi.fn(async () => pendingRequest),
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
        requiresRequesterRepin: false,
      },
      approver,
      deps,
      registry,
    );

    expect(result).toEqual({ ok: false, code: 'approval_shop_scope_forbidden' });
    expect(deps.createRequest).not.toHaveBeenCalled();
  });

  it('requires requester re-PIN when the approval rule requires it without persisting the PIN', async () => {
    const sentinelPin = '482731';
    const verifyEmployeePin = vi.fn(async () => true);
    const createRequest = vi.fn(async (input) => ({
      ok: true as const,
      requestId: 'request-2',
      status: 'PENDING' as const,
      persistedPayload: input.commandPayload,
    }));
    const deps = dependencies({ verifyEmployeePin, createRequest });
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
        requiresRequesterRepin: true,
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
