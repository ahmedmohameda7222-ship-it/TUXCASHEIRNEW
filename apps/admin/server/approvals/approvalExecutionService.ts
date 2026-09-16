import type { AdminApprovalExecutionClaim } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type ApprovalExecutionClaim = AdminApprovalExecutionClaim;

export type ApprovalCommandExecutionResult = {
  result?: unknown;
  idempotentReplay: boolean;
};

export type ApprovalExecutionRegistryEntry = {
  actionType: string;
  execute(input: {
    commandId: string;
    payload: Readonly<Record<string, unknown>>;
    claim: ApprovalExecutionClaim;
  }): Promise<ApprovalCommandExecutionResult>;
};

export type ApprovalExecutionRegistry = ReadonlyMap<string, ApprovalExecutionRegistryEntry>;

export type CompleteApprovalExecutionInput = {
  approvalRequestId: string;
  claimToken: string;
  outcome: 'EXECUTED' | 'RETRYABLE' | 'FAILED';
  errorCode?: string | null;
  resultMetadata?: Readonly<Record<string, unknown>> | null;
};

export type ApprovalExecutionServiceDependencies = {
  claimApprovedCommand(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<ApprovalExecutionClaim[]>;
  completeClaim(input: CompleteApprovalExecutionInput): Promise<unknown>;
  registry: ApprovalExecutionRegistry;
  workerId: string;
  batchLimit?: number;
  leaseSeconds?: number;
};

export type ApprovalExecutionRunResult = {
  claimed: number;
  executed: number;
  retryable: number;
  failed: number;
};

export class ApprovalTerminalCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ApprovalTerminalCommandError';
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('approval_executor_configuration_invalid');
  }
  return value;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ApprovalTerminalCommandError) return error.code.slice(0, 200);
  return 'approval_execution_retryable_failure';
}

export function createApprovalExecutionRegistry(
  entries: readonly ApprovalExecutionRegistryEntry[],
): ApprovalExecutionRegistry {
  const registry = new Map<string, ApprovalExecutionRegistryEntry>();
  for (const entry of entries) {
    const actionType = entry.actionType.trim();
    if (actionType === '') throw new Error('approval_command_action_type_required');
    if (registry.has(actionType)) throw new Error('approval_command_duplicate_registration');
    registry.set(actionType, { ...entry, actionType });
  }
  return registry;
}

export async function executeClaimedCommand(
  claim: ApprovalExecutionClaim,
  registry: ApprovalExecutionRegistry,
): Promise<ApprovalCommandExecutionResult> {
  const entry = registry.get(claim.actionType);
  if (!entry) throw new ApprovalTerminalCommandError('approval_command_not_registered');
  return entry.execute({ commandId: claim.commandId, payload: claim.commandPayload, claim });
}

export function createApprovalExecutionService(deps: ApprovalExecutionServiceDependencies) {
  const batchLimit = boundedInteger(deps.batchLimit, 25, 1, 100);
  const leaseSeconds = boundedInteger(deps.leaseSeconds, 300, 30, 900);

  return {
    async runOnce(): Promise<ApprovalExecutionRunResult> {
      const claims = await deps.claimApprovedCommand({
        workerId: deps.workerId,
        limit: batchLimit,
        leaseSeconds,
      });
      let executed = 0;
      let retryable = 0;
      let failed = 0;

      for (const claim of claims) {
        let result: ApprovalCommandExecutionResult;
        try {
          result = await executeClaimedCommand(claim, deps.registry);
        } catch (error) {
          if (error instanceof ApprovalTerminalCommandError) {
            await deps.completeClaim({
              approvalRequestId: claim.approvalRequestId,
              claimToken: claim.claimToken,
              outcome: 'FAILED',
              errorCode: safeErrorCode(error),
              resultMetadata: null,
            });
            failed += 1;
            continue;
          }

          await deps.completeClaim({
            approvalRequestId: claim.approvalRequestId,
            claimToken: claim.claimToken,
            outcome: 'RETRYABLE',
            errorCode: safeErrorCode(error),
            resultMetadata: null,
          });
          retryable += 1;
          continue;
        }

        // Completion is deliberately outside the execution catch. If the business command
        // committed but the completion write has an ambiguous network outcome, do not issue a
        // second state transition here. Leave the durable claim for lease expiry/recovery; the
        // registered command must converge by command_id on the next run.
        await deps.completeClaim({
          approvalRequestId: claim.approvalRequestId,
          claimToken: claim.claimToken,
          outcome: 'EXECUTED',
          errorCode: null,
          resultMetadata: { idempotentReplay: result.idempotentReplay },
        });
        executed += 1;
      }

      return { claimed: claims.length, executed, retryable, failed };
    },
  };
}

type ApprovalClaimRow = {
  approval_request_id: string;
  business_id: string;
  shop_id: string | null;
  requester_employee_id: string;
  approver_employee_id: string;
  action_type: string;
  command_id: string;
  command_payload: Readonly<Record<string, unknown>>;
  claim_token: string;
  attempt_count: number;
  lease_expires_at: string;
};

function mapClaimRow(row: ApprovalClaimRow): ApprovalExecutionClaim {
  return {
    approvalRequestId: row.approval_request_id,
    businessId: row.business_id,
    shopId: row.shop_id,
    requesterEmployeeId: row.requester_employee_id,
    approverEmployeeId: row.approver_employee_id,
    actionType: row.action_type,
    commandId: row.command_id,
    commandPayload: row.command_payload,
    claimToken: row.claim_token,
    attemptCount: Number(row.attempt_count),
    leaseExpiresAt: row.lease_expires_at,
  };
}

export function createSupabaseApprovalExecutionDependencies(
  client: AdminSupabaseClient,
): Pick<ApprovalExecutionServiceDependencies, 'claimApprovedCommand' | 'completeClaim'> {
  return {
    async claimApprovedCommand(input) {
      const rows = await client.rpc<ApprovalClaimRow[]>('claim_admin_approval_execution_v1', {
        p_worker_id: input.workerId,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      });
      if (!Array.isArray(rows)) throw new Error('approval_executor_backend_contract_invalid');
      return rows.map(mapClaimRow);
    },
    async completeClaim(input) {
      return client.rpc<unknown>('complete_admin_approval_execution_v1', {
        p_approval_request_id: input.approvalRequestId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome,
        p_error_code: input.errorCode ?? null,
        p_result_metadata: input.resultMetadata ?? null,
      });
    },
  };
}

export async function claimApprovedCommand(
  deps: Pick<ApprovalExecutionServiceDependencies, 'claimApprovedCommand'>,
  input: { workerId: string; limit?: number; leaseSeconds?: number },
): Promise<ApprovalExecutionClaim[]> {
  return deps.claimApprovedCommand({
    workerId: input.workerId,
    limit: boundedInteger(input.limit, 25, 1, 100),
    leaseSeconds: boundedInteger(input.leaseSeconds, 300, 30, 900),
  });
}

export async function recoverExpiredApprovalExecution(
  deps: Pick<ApprovalExecutionServiceDependencies, 'claimApprovedCommand'>,
  workerId: string,
): Promise<ApprovalExecutionClaim[]> {
  return claimApprovedCommand(deps, { workerId });
}
