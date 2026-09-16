import type { AdminApprovalStatus, AdminSessionPrincipal } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type ApprovalReadFilters = {
  id?: string;
  shopId?: string;
  status?: AdminApprovalStatus;
};

export type ApprovalReadModel = {
  id: string;
  requesterName: string;
  requesterEmployeeId: string;
  approverName: string | null;
  shopId: string | null;
  shopName: string;
  actionLabel: string;
  valueSummary: string;
  reason: string | null;
  consequence: string;
  status: AdminApprovalStatus;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  failedAt: string | null;
};

type ApprovalRequestRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  requester_employee_id: string;
  approver_employee_id: string | null;
  action_type: string;
  command_payload: Readonly<Record<string, unknown>>;
  reason: string | null;
  status: AdminApprovalStatus;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  failed_at: string | null;
};

type EmployeeRow = { id: string; display_name: string };
type ShopRow = { id: string; name: string };
type ExecutionRow = {
  approval_request_id: string;
  state: 'READY' | 'CLAIMED' | 'RETRYABLE' | 'EXECUTED' | 'FAILED';
  attempt_count: number;
  last_error_code: string | null;
};

function titleCaseAction(actionType: string): string {
  const normalized = actionType.replace(/[._-]+/g, ' ').trim();
  return normalized === ''
    ? 'Sensitive Admin action'
    : normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function summarizeValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

function summarizePayload(payload: Readonly<Record<string, unknown>>): string {
  const preferredKeys = ['amountMinor', 'quantityImpact', 'amount', 'quantity', 'value', 'entityId'];
  for (const key of preferredKeys) {
    const summary = summarizeValue(payload[key]);
    if (summary !== null) return `${key}: ${summary}`;
  }
  for (const [key, value] of Object.entries(payload)) {
    const summary = summarizeValue(value);
    if (summary !== null) return `${key}: ${summary}`;
  }
  return 'Persisted command ready for second-person review';
}

function executionLabel(
  status: AdminApprovalStatus,
  execution: ExecutionRow | undefined,
): string {
  if (status === 'PENDING') return 'Not started';
  if (status === 'REJECTED') return 'Rejected — command will not execute';
  if (status === 'EXECUTED') return 'Executed successfully';
  if (status === 'FAILED') return 'Execution failed';
  if (!execution) return status === 'APPROVED' ? 'Queued for execution' : 'Execution in progress';
  if (execution.state === 'READY') return 'Queued for execution';
  if (execution.state === 'CLAIMED') return 'Execution in progress';
  if (execution.state === 'RETRYABLE') {
    return `Retry scheduled after attempt ${execution.attempt_count}`;
  }
  return execution.state === 'EXECUTED' ? 'Executed successfully' : 'Execution failed';
}

function visibleToPrincipal(row: ApprovalRequestRow, principal: AdminSessionPrincipal): boolean {
  return row.shop_id === null || principal.shopIds.includes(row.shop_id);
}

export async function listApprovalReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: ApprovalReadFilters = {},
): Promise<ApprovalReadModel[]> {
  const query = new URLSearchParams({
    select:
      'id,business_id,shop_id,requester_employee_id,approver_employee_id,action_type,command_payload,reason,status,created_at,decided_at,executed_at,failed_at',
    business_id: `eq.${principal.businessId}`,
    order: 'created_at.desc,id.desc',
    limit: filters.id ? '1' : '100',
  });
  if (filters.id) query.set('id', `eq.${filters.id}`);
  if (filters.shopId) query.set('shop_id', `eq.${filters.shopId}`);
  if (filters.status) query.set('status', `eq.${filters.status}`);

  const requests = (
    await client.select<ApprovalRequestRow[]>('admin_approval_requests', query)
  ).filter((row) => visibleToPrincipal(row, principal));
  if (requests.length === 0) return [];

  const [employees, shops, executions] = await Promise.all([
    client.select<EmployeeRow[]>(
      'business_employees',
      new URLSearchParams({
        select: 'id,display_name',
        business_id: `eq.${principal.businessId}`,
      }),
    ),
    client.select<ShopRow[]>(
      'shops',
      new URLSearchParams({
        select: 'id,name',
        id: `in.(${[...new Set(requests.flatMap((row) => (row.shop_id ? [row.shop_id] : [])))].join(',') || '00000000-0000-0000-0000-000000000000'})`,
      }),
    ),
    client.select<ExecutionRow[]>(
      'admin_approval_execution_jobs',
      new URLSearchParams({
        select: 'approval_request_id,state,attempt_count,last_error_code',
        business_id: `eq.${principal.businessId}`,
      }),
    ),
  ]);

  const employeeNames = new Map(employees.map((row) => [row.id, row.display_name]));
  const shopNames = new Map(shops.map((row) => [row.id, row.name]));
  const executionsByRequest = new Map(executions.map((row) => [row.approval_request_id, row]));

  return requests.map((row) => {
    const execution = executionsByRequest.get(row.id);
    const model: ApprovalReadModel = {
      id: row.id,
      requesterName: employeeNames.get(row.requester_employee_id) ?? 'Unknown requester',
      requesterEmployeeId: row.requester_employee_id,
      approverName: row.approver_employee_id
        ? (employeeNames.get(row.approver_employee_id) ?? 'Unknown approver')
        : null,
      shopId: row.shop_id,
      shopName: row.shop_id ? (shopNames.get(row.shop_id) ?? 'Assigned shop') : 'All shops',
      actionLabel: titleCaseAction(row.action_type),
      valueSummary: summarizePayload(row.command_payload),
      reason: row.reason,
      consequence:
        'If approved, the persisted command will execute through the durable approval executor using its existing idempotency key.',
      status: row.status,
      executionLabel: executionLabel(row.status, execution),
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      executedAt: row.executed_at,
      failedAt: row.failed_at,
    };
    if (row.status === 'FAILED') {
      model.failureMessage = execution?.last_error_code
        ? `The approved command stopped safely (${execution.last_error_code}).`
        : 'The approved command could not be completed safely.';
      model.recoveryMessage =
        'Review the failure and submit a new request if the command policy still allows it.';
    }
    return model;
  });
}
