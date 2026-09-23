import type { AdminOrderFinancialMutationResult } from '@tux/admin-contracts';

import { getAdminServerEnv } from '../env.js';
import {
  createOrderApprovalExecutionEntries,
  type ApprovedRefundExecutionInput,
  type ApprovedReturnExecutionInput,
} from '../orders/orderApproval.js';
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

function createOrderApprovalPersistence(client: AdminSupabaseClient) {
  return {
    executeRefund(input: ApprovedRefundExecutionInput) {
      return client.rpc<AdminOrderFinancialMutationResult>('execute_approved_admin_order_refund_v1', {
        p_approval_request_id: input.approvalRequestId,
        p_business_id: input.businessId,
        p_shop_id: input.shopId,
        p_requester_employee_id: input.requesterEmployeeId,
        p_approver_employee_id: input.approverEmployeeId,
        p_order_id: input.orderId,
        p_payment_id: input.paymentId,
        p_amount_minor: input.amountMinor,
        p_reason_code_id: input.reasonCodeId,
        p_note: input.note,
        p_command_id: input.orderCommandId,
      });
    },
    executeReturn(input: ApprovedReturnExecutionInput) {
      return client.rpc<AdminOrderFinancialMutationResult>('execute_approved_admin_order_return_v1', {
        p_approval_request_id: input.approvalRequestId,
        p_business_id: input.businessId,
        p_shop_id: input.shopId,
        p_requester_employee_id: input.requesterEmployeeId,
        p_approver_employee_id: input.approverEmployeeId,
        p_order_id: input.orderId,
        p_items: input.items,
        p_reason_code_id: input.reasonCodeId,
        p_note: input.note,
        p_command_id: input.orderCommandId,
      });
    },
  };
}

export async function runProductionApprovalExecutionRunner(): Promise<ApprovalExecutionRunResult> {
  const client = new AdminSupabaseClient(getAdminServerEnv());
  const persistence = createSupabaseApprovalExecutionDependencies(client);
  const registry = createApprovalExecutionRegistry(
    createOrderApprovalExecutionEntries(createOrderApprovalPersistence(client)),
  );
  const service = createApprovalExecutionService({
    ...persistence,
    registry,
    workerId: 'admin-approval-executor',
    batchLimit: 25,
    leaseSeconds: 300,
  });

  return runApprovalExecutionRunner({ execute: () => service.runOnce() });
}
