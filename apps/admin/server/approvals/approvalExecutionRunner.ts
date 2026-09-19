import { getAdminServerEnv } from '../env.js';
import { AdminSupabaseClient } from '../supabaseAdmin.js';
import {
  createApprovalExecutionRegistry,
  createApprovalExecutionService,
  createSupabaseApprovalExecutionDependencies,
  type ApprovalExecutionRunResult,
} from './approvalExecutionService.js';

export type ApprovalExecutionHttpResult = {
  statusCode: number;
  body: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
};

export type ApprovalExecutionRequestInput = {
  method?: string | undefined;
  authorization?: string | undefined;
  cronSecret?: string | undefined;
  run(): Promise<ApprovalExecutionRunResult>;
};

export async function handleApprovalExecutionRequest(
  input: ApprovalExecutionRequestInput,
): Promise<ApprovalExecutionHttpResult> {
  const method = (input.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return {
      statusCode: 405,
      body: { error: 'method_not_allowed' },
      headers: { allow: 'GET, POST' },
    };
  }

  const cronSecret = input.cronSecret?.trim() ?? '';
  if (cronSecret === '') {
    return { statusCode: 503, body: { error: 'cron_secret_not_configured' } };
  }
  if (input.authorization !== `Bearer ${cronSecret}`) {
    return { statusCode: 401, body: { error: 'unauthorized' } };
  }

  try {
    const result = await input.run();
    return { statusCode: 200, body: result };
  } catch {
    return { statusCode: 500, body: { error: 'approval_executor_failed' } };
  }
}

export async function runApprovalExecutionRunner(input: {
  execute(): Promise<ApprovalExecutionRunResult>;
}): Promise<ApprovalExecutionRunResult> {
  return input.execute();
}

export async function runProductionApprovalExecutionRunner(): Promise<ApprovalExecutionRunResult> {
  const client = new AdminSupabaseClient(getAdminServerEnv());
  const persistence = createSupabaseApprovalExecutionDependencies(client);

  // Plan 3 intentionally ships the durable generic executor without inventing business-domain
  // commands. Plans 4+ register approved commands here as their authoritative idempotent
  // handlers are implemented. An unregistered persisted action fails closed in the executor.
  const registry = createApprovalExecutionRegistry([]);
  const service = createApprovalExecutionService({
    ...persistence,
    registry,
    workerId: 'admin-approval-executor',
    batchLimit: 25,
    leaseSeconds: 300,
  });

  return runApprovalExecutionRunner({ execute: () => service.runOnce() });
}
