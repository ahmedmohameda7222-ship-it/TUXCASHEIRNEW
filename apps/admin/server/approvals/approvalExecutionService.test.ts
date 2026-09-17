import { describe, expect, it, vi } from 'vitest';

import {
  ApprovalTerminalCommandError,
  createApprovalExecutionRegistry,
  createApprovalExecutionService,
  type ApprovalExecutionClaim,
} from './approvalExecutionService';

const claim: ApprovalExecutionClaim = {
  approvalRequestId: 'request-1',
  businessId: 'business-1',
  shopId: 'shop-1',
  requesterEmployeeId: 'employee-requester',
  approverEmployeeId: 'employee-approver',
  actionType: 'TEST_IDEMPOTENT_COMMAND',
  commandId: 'command-1',
  commandPayload: { entityId: 'entity-1' },
  claimToken: 'claim-token-1',
  attemptCount: 1,
  leaseExpiresAt: '2026-09-16T12:05:00.000Z',
};

function idempotentBusinessCommand() {
  const results = new Map<string, { entityId: string }>();
  let effects = 0;

  return {
    execute: vi.fn(async (commandId: string, payload: unknown) => {
      const existing = results.get(commandId);
      if (existing) return { result: existing, idempotentReplay: true };
      const entityId = (payload as { entityId: string }).entityId;
      const result = { entityId };
      results.set(commandId, result);
      effects += 1;
      return { result, idempotentReplay: false };
    }),
    businessEffects: () => effects,
  };
}

describe('approvalExecutionService', () => {
  it('recovers when the business command committed but completion recording timed out', async () => {
    const command = idempotentBusinessCommand();
    let completionAttempts = 0;
    let terminal = false;
    const claimApprovedCommand = vi.fn(async () => (terminal ? [] : [claim]));
    const completeClaim = vi.fn(async () => {
      completionAttempts += 1;
      if (completionAttempts === 1) throw new Error('completion_write_timed_out');
      terminal = true;
      return { ok: true as const, status: 'EXECUTED' as const };
    });
    const registry = createApprovalExecutionRegistry([
      {
        actionType: claim.actionType,
        execute: ({ commandId, payload }) => command.execute(commandId, payload),
      },
    ]);
    const service = createApprovalExecutionService({
      claimApprovedCommand,
      completeClaim,
      registry,
      workerId: 'approval-runner-test',
    });

    await expect(service.runOnce()).rejects.toThrow('completion_write_timed_out');
    await service.runOnce();

    expect(command.businessEffects()).toBe(1);
    expect(command.execute).toHaveBeenCalledTimes(2);
    expect(completeClaim).toHaveBeenCalledTimes(2);
  });

  it('persists the command deterministic result with replay metadata', async () => {
    const completeClaim = vi.fn(async () => ({ ok: true as const, status: 'EXECUTED' as const }));
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [claim]),
      completeClaim,
      registry: createApprovalExecutionRegistry([
        {
          actionType: claim.actionType,
          execute: vi.fn(async () => ({
            result: { entityId: 'entity-1', version: 7 },
            idempotentReplay: false,
          })),
        },
      ]),
      workerId: 'approval-runner-test',
    });

    await service.runOnce();

    expect(completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'EXECUTED',
        resultMetadata: {
          idempotentReplay: false,
          result: { entityId: 'entity-1', version: 7 },
        },
      }),
    );
  });

  it('rejects an EXECUTED completion response that did not commit', async () => {
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [claim]),
      completeClaim: vi.fn(async () => ({ ok: false as const, code: 'approval_claim_stale' })),
      registry: createApprovalExecutionRegistry([
        {
          actionType: claim.actionType,
          execute: vi.fn(async () => ({
            result: { entityId: 'entity-1' },
            idempotentReplay: false,
          })),
        },
      ]),
      workerId: 'approval-runner-test',
    });

    await expect(service.runOnce()).rejects.toThrow('approval_execution_completion_not_committed');
  });

  it('rejects a FAILED completion response that did not commit', async () => {
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [claim]),
      completeClaim: vi.fn(async () => ({ ok: false as const, code: 'approval_claim_stale' })),
      registry: createApprovalExecutionRegistry([
        {
          actionType: claim.actionType,
          execute: vi.fn(async () => {
            throw new ApprovalTerminalCommandError('terminal_business_error');
          }),
        },
      ]),
      workerId: 'approval-runner-test',
    });

    await expect(service.runOnce()).rejects.toThrow('approval_execution_completion_not_committed');
  });

  it('rejects a RETRYABLE completion response that did not commit', async () => {
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [claim]),
      completeClaim: vi.fn(async () => ({ ok: false as const, code: 'approval_claim_stale' })),
      registry: createApprovalExecutionRegistry([
        {
          actionType: claim.actionType,
          execute: vi.fn(async () => {
            throw new Error('temporary_backend_failure');
          }),
        },
      ]),
      workerId: 'approval-runner-test',
    });

    await expect(service.runOnce()).rejects.toThrow('approval_execution_completion_not_committed');
  });

  it('never executes an unknown persisted command type', async () => {
    const completeClaim = vi.fn(async () => ({ ok: true as const, status: 'FAILED' as const }));
    const service = createApprovalExecutionService({
      claimApprovedCommand: vi.fn(async () => [{ ...claim, actionType: 'UNKNOWN_COMMAND' }]),
      completeClaim,
      registry: createApprovalExecutionRegistry([]),
      workerId: 'approval-runner-test',
    });

    await service.runOnce();

    expect(completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalRequestId: claim.approvalRequestId,
        outcome: 'FAILED',
        errorCode: 'approval_command_not_registered',
      }),
    );
  });

  it('does not claim more than the configured bounded batch', async () => {
    const claimApprovedCommand = vi.fn(async () => []);
    const service = createApprovalExecutionService({
      claimApprovedCommand,
      completeClaim: vi.fn(),
      registry: createApprovalExecutionRegistry([]),
      workerId: 'approval-runner-test',
      batchLimit: 25,
    });

    await service.runOnce();

    expect(claimApprovedCommand).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: 'approval-runner-test', limit: 25 }),
    );
  });
});
