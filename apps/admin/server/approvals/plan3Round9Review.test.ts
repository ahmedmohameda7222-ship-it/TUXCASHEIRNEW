import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import {
  createApprovalExecutionRegistry,
  createApprovalExecutionService,
  type ApprovalExecutionClaim,
} from './approvalExecutionService';
import { listApprovalReadModels } from './approvalReadService';

const shopId = '11111111-1111-4111-8111-111111111111';

function approvalReadClient() {
  const select = vi.fn(async (table: string) => {
    if (table === 'admin_approval_requests') {
      return [
        {
          id: '22222222-2222-4222-8222-222222222222',
          business_id: 'business-1',
          shop_id: shopId,
          requester_employee_id: 'requester-1',
          approver_employee_id: null,
          action_type: 'FINANCE_ADJUSTMENT',
          command_payload: { amountMinor: 5000 },
          reason: 'correction',
          required_approver_permission: 'finance.adjust',
          requires_second_person: true,
          status: 'PENDING',
          expires_at: '2099-01-01T00:00:00.000Z',
          created_at: '2026-09-17T20:00:00.000Z',
          decided_at: null,
          executed_at: null,
          failed_at: null,
        },
      ];
    }
    if (table === 'business_employees') {
      return [{ id: 'requester-1', display_name: 'Requester One' }];
    }
    if (table === 'shops') return [{ id: shopId, name: 'TUX' }];
    if (table === 'admin_approval_execution_jobs') return [];
    throw new Error(`unexpected table ${table}`);
  });
  return { client: { select } as unknown as AdminSupabaseClient, select };
}

const executionClaim: ApprovalExecutionClaim = {
  approvalRequestId: 'request-1',
  businessId: 'business-1',
  shopId,
  requesterEmployeeId: 'requester-1',
  approverEmployeeId: 'approver-1',
  actionType: 'TEST_RESULT_PROJECTION',
  commandId: 'command-1',
  commandPayload: { entityId: 'entity-1' },
  claimToken: 'claim-token-1',
  attemptCount: 1,
  leaseExpiresAt: '2026-09-17T21:05:00.000Z',
};

describe('Plan 3 Round 9 Codex regressions', () => {
  it('does not expose decision controls without the persisted action-specific approver permission', async () => {
    const principal: AdminSessionPrincipal = {
      employeeId: 'approver-1',
      businessId: 'business-1',
      role: 'MANAGER',
      permissions: ['approvals.review'],
      shopIds: [shopId],
    };
    const { client } = approvalReadClient();

    const [model] = await listApprovalReadModels(client, principal);

    expect(model?.canDecide).toBe(false);
  });

  it('does not expose decision controls to the requester when second-person approval is required', async () => {
    const principal: AdminSessionPrincipal = {
      employeeId: 'requester-1',
      businessId: 'business-1',
      role: 'MANAGER',
      permissions: ['approvals.review', 'finance.adjust'],
      shopIds: [shopId],
    };
    const { client } = approvalReadClient();

    const [model] = await listApprovalReadModels(client, principal);

    expect(model?.canDecide).toBe(false);
  });

  it('completes an already-committed command when its result cannot be JSON serialized', async () => {
    const completeClaim = vi.fn(async () => ({ ok: true as const, status: 'EXECUTED' as const }));
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [executionClaim]),
      completeClaim,
      registry: createApprovalExecutionRegistry([
        {
          actionType: executionClaim.actionType,
          execute: vi.fn(async () => ({
            result: { entityId: 'entity-1', version: 1n },
            idempotentReplay: false,
          })),
        },
      ]),
      workerId: 'approval-runner-round9',
    });

    await expect(service.runOnce()).resolves.toEqual({
      claimed: 1,
      executed: 1,
      retryable: 0,
      failed: 0,
    });
    expect(completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'EXECUTED',
        resultMetadata: { idempotentReplay: false },
      }),
    );
  });
});
