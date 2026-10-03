import type { AdminApprovalActor, AdminApprovalStatus } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ApprovalServiceDependencies } from '../approvals/approvalService';
import type { AdminSupabaseClient } from '../supabaseAdmin';
import { EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION } from './staffApproval';
import { executeOrRequestStaffApproval } from './staffApprovalRouting';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const RULE_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const COMMAND_ID = '66666666-6666-4666-8666-666666666666';

function clientWithRoleApprovalRule(): AdminSupabaseClient {
  return {
    select: vi.fn(async () => [
      {
        id: RULE_ID,
        business_id: BUSINESS_ID,
        shop_id: SHOP_ID,
        action_type: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
        requester_permission: 'staff.manage',
        approver_permission: 'approvals.review',
        requires_second_person: true,
        requires_requester_repin: false,
        threshold_context: {},
        active: true,
      },
    ]),
  } as unknown as AdminSupabaseClient;
}

function approvalDependencies(status: AdminApprovalStatus = 'PENDING', idempotentReplay = false) {
  const createRequest = vi.fn(async () => ({
    ok: true,
    requestId: REQUEST_ID,
    status,
    idempotentReplay,
  }));
  const deps: ApprovalServiceDependencies = {
    loadRequest: vi.fn<ApprovalServiceDependencies['loadRequest']>(async () => null),
    loadRule: vi.fn<ApprovalServiceDependencies['loadRule']>(async () => ({
      id: RULE_ID,
      businessId: BUSINESS_ID,
      shopId: SHOP_ID,
      actionType: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
      requesterPermission: 'staff.manage',
      approverPermission: 'approvals.review',
      requiresSecondPerson: true,
      requiresRequesterRepin: false,
      thresholdContext: {},
      active: true,
    })),
    verifyEmployeePin: vi.fn<ApprovalServiceDependencies['verifyEmployeePin']>(async () => true),
    decideRequest: vi.fn<ApprovalServiceDependencies['decideRequest']>(async () => ({
      ok: true,
      status: 'APPROVED' as const,
    })),
    createRequest,
    now: () => new Date('2026-09-27T18:00:00.000Z'),
  };
  return { deps, createRequest };
}

function actor(permissions: AdminApprovalActor['permissions']): AdminApprovalActor {
  return {
    employeeId: '77777777-7777-4777-8777-777777777777',
    businessId: BUSINESS_ID,
    role: 'MANAGER',
    permissions,
    shopIds: [SHOP_ID],
    sessionId: '88888888-8888-4888-8888-888888888888',
  };
}

const routingInput = {
  actionType: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
  shopId: SHOP_ID,
  commandId: COMMAND_ID,
  commandInput: {
    employeeId: EMPLOYEE_ID,
    shopId: SHOP_ID,
    expectedVersion: 4,
    role: 'MANAGER',
  },
} as const;

describe('Workforce approval routing', () => {
  it('rejects a configured approval request when the requester lacks the rule permission', async () => {
    const { deps, createRequest } = approvalDependencies();
    const executeDirect = vi.fn(async () => ({ ok: true as const }));

    const result = await executeOrRequestStaffApproval(
      routingInput,
      actor([]),
      clientWithRoleApprovalRule(),
      deps,
      executeDirect,
    );

    expect(result).toEqual({ ok: false, code: 'approval_requester_not_authorized' });
    expect(createRequest).not.toHaveBeenCalled();
    expect(executeDirect).not.toHaveBeenCalled();
  });

  it('persists only the approval request when the requester satisfies the rule permission', async () => {
    const { deps, createRequest } = approvalDependencies();
    const executeDirect = vi.fn(async () => ({ ok: true as const }));

    const result = await executeOrRequestStaffApproval(
      routingInput,
      actor(['staff.manage']),
      clientWithRoleApprovalRule(),
      deps,
      executeDirect,
    );

    expect(result).toEqual({
      ok: true,
      state: 'PENDING_APPROVAL',
      approvalRequestId: REQUEST_ID,
      replayed: false,
    });
    expect(createRequest).toHaveBeenCalledOnce();
    expect(executeDirect).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'APPROVED', 'EXECUTING'] as const)(
    'keeps a replayed %s approval attached to the original command identity',
    async (status) => {
      const { deps } = approvalDependencies(status, true);

      await expect(
        executeOrRequestStaffApproval(
          routingInput,
          actor(['staff.manage']),
          clientWithRoleApprovalRule(),
          deps,
          vi.fn(async () => ({ ok: true as const })),
        ),
      ).resolves.toEqual({
        ok: true,
        state: 'PENDING_APPROVAL',
        approvalRequestId: REQUEST_ID,
        replayed: true,
      });
    },
  );

  it('surfaces rejected approval replays as terminal failures so a new command can be attempted', async () => {
    const { deps } = approvalDependencies('REJECTED', true);

    await expect(
      executeOrRequestStaffApproval(
        routingInput,
        actor(['staff.manage']),
        clientWithRoleApprovalRule(),
        deps,
        vi.fn(async () => ({ ok: true as const })),
      ),
    ).resolves.toEqual({ ok: false, code: 'approval_rejected' });
  });

  it('surfaces failed approval execution replays as terminal failures', async () => {
    const { deps } = approvalDependencies('FAILED', true);

    await expect(
      executeOrRequestStaffApproval(
        routingInput,
        actor(['staff.manage']),
        clientWithRoleApprovalRule(),
        deps,
        vi.fn(async () => ({ ok: true as const })),
      ),
    ).resolves.toEqual({ ok: false, code: 'approval_execution_failed' });
  });

  it('treats an executed approval replay as terminal applied success', async () => {
    const { deps } = approvalDependencies('EXECUTED', true);

    await expect(
      executeOrRequestStaffApproval(
        routingInput,
        actor(['staff.manage']),
        clientWithRoleApprovalRule(),
        deps,
        vi.fn(async () => ({ ok: true as const })),
      ),
    ).resolves.toEqual({ ok: true, state: 'APPLIED', replayed: true });
  });
});
