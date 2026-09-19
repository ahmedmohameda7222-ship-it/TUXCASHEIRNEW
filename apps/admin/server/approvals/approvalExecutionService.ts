import type { AdminApprovalExecutionClaim } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';

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

function normalizeSecretKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

const API_CREDENTIAL_KEYS = new Set([
  'api_key',
  'client_secret',
  'access_key',
  'secret_key',
  'private_key',
]);

function isSecretResultKey(key: string): boolean {
  const normalized = normalizeSecretKey(key);
  const collapsed = normalized.replaceAll('_', '');
  return (
    /(^|_)(pin|password|passcode|verifier|salt|lookup|token)(_|$)/.test(normalized) ||
    API_CREDENTIAL_KEYS.has(normalized) ||
    [
      'pinhash',
      'pinlookuphash',
      'pinverifier',
      'pinsalt',
      'passwordhash',
      'passwordverifier',
      'claimtoken',
      'apikey',
      'clientsecret',
      'accesskey',
      'secretkey',
      'privatekey',
    ].includes(collapsed)
  );
}

function redactSecretResultFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretResultFields);
  if (typeof value !== 'object' || value === null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretResultKey(key)) continue;
    output[key] = redactSecretResultFields(child);
  }
  return output;
}

function safeExecutionResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (encoded === undefined) return undefined;
  return redactSecretResultFields(JSON.parse(encoded) as unknown);
}

function executionResultMetadata(
  result: ApprovalCommandExecutionResult,
): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { idempotentReplay: result.idempotentReplay };
  const safeResult = safeExecutionResult(result.result);
  if (safeResult !== undefined) metadata['result'] = safeResult;
  return metadata;
}

function assertCompletionCommitted(value: unknown): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>)['ok'] !== true
  ) {
    throw new Error('approval_execution_completion_not_committed');
  }
}

async function completeCommittedClaim(
  deps: ApprovalExecutionServiceDependencies,
  input: CompleteApprovalExecutionInput,
): Promise<void> {
  const completion = await deps.completeClaim(input);
  assertCompletionCommitted(completion);
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
            await completeCommittedClaim(deps, {
              approvalRequestId: claim.approvalRequestId,
              claimToken: claim.claimToken,
              outcome: 'FAILED',
              errorCode: safeErrorCode(error),
              resultMetadata: null,
            });
            failed += 1;
            continue;
          }

          await completeCommittedClaim(deps, {
            approvalRequestId: claim.approvalRequestId,
            claimToken: claim.claimToken,
            outcome: 'RETRYABLE',
            errorCode: safeErrorCode(error),
            resultMetadata: null,
          });
          retryable += 1;
          continue;
        }

        const resultMetadata = executionResultMetadata(result);

        // Completion is deliberately outside the execution catch. If the business command
        // committed but the completion write has an ambiguous network outcome, do not issue a
        // second state transition here. Leave the durable claim for lease expiry/recovery; the
        // registered command must converge by command_id on the next run. Result metadata is
        // supplemental: an unserializable result is omitted rather than abandoning a committed
        // command claim.
        await completeCommittedClaim(deps, {
          approvalRequestId: claim.approvalRequestId,
          claimToken: claim.claimToken,
          outcome: 'EXECUTED',
          errorCode: null,
          resultMetadata,
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
