import type {
  AdminApprovalStatus,
  AdminPermission,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type ApprovalReadFilters = {
  id?: string;
  shopId?: string;
  status?: AdminApprovalStatus;
};

export type ApprovalDisplayStatus = AdminApprovalStatus | 'EXPIRED';

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
  displayStatus: ApprovalDisplayStatus;
  canDecide: boolean;
  executionLabel: string;
  failureMessage?: string;
  recoveryMessage?: string;
  expiresAt: string;
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
  required_approver_permission: AdminPermission;
  requires_second_person: boolean;
  status: AdminApprovalStatus;
  expires_at: string;
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

const EMPTY_SCOPE_SENTINEL = '00000000-0000-0000-0000-000000000000';

function hasBusinessWideAuthority(principal: AdminSessionPrincipal): boolean {
  return principal.role === 'OWNER' || principal.role === 'ADMIN';
}

function hasApproverPermission(
  principal: AdminSessionPrincipal,
  permission: AdminPermission,
): boolean {
  return principal.role === 'OWNER' || principal.permissions.includes(permission);
}

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
  if (value === null) return 'null';
  return null;
}

function collectPayloadSummaries(value: unknown, path: string, summaries: string[]): void {
  const primitive = summarizeValue(value);
  if (primitive !== null) {
    summaries.push(`${path}: ${primitive}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectPayloadSummaries(child, `${path}[${index}]`, summaries));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    collectPayloadSummaries(child, path === '' ? key : `${path}.${key}`, summaries);
  }
}

function summarizePayload(payload: Readonly<Record<string, unknown>>): string {
  const summaries: string[] = [];
  collectPayloadSummaries(payload, '', summaries);
  return summaries.length > 0
    ? summaries.join(' · ')
    : 'Persisted command contains no scalar change fields';
}

function executionLabel(status: AdminApprovalStatus, execution: ExecutionRow | undefined): string {
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

function isExpiredPending(row: ApprovalRequestRow, nowMs: number): boolean {
  if (row.status !== 'PENDING') return false;
  const expiresAtMs = Date.parse(row.expires_at);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs;
}

function visibleToPrincipal(row: ApprovalRequestRow, principal: AdminSessionPrincipal): boolean {
  if (row.shop_id === null) return hasBusinessWideAuthority(principal);
  return principal.shopIds.includes(row.shop_id);
}

function canPrincipalDecide(
  row: ApprovalRequestRow,
  principal: AdminSessionPrincipal,
  expired: boolean,
): boolean {
  if (row.status !== 'PENDING' || expired) return false;
  if (!hasApproverPermission(principal, row.required_approver_permission)) return false;
  return !row.requires_second_person || row.requester_employee_id !== principal.employeeId;
}

function applyPrincipalShopScope(
  query: URLSearchParams,
  principal: AdminSessionPrincipal,
  explicitShopId: string | undefined,
): void {
  if (explicitShopId) {
    query.set('shop_id', `eq.${explicitShopId}`);
    return;
  }
  if (principal.role === 'OWNER') return;
  if (principal.role === 'ADMIN') {
    if (principal.shopIds.length === 0) {
      query.set('shop_id', 'is.null');
      return;
    }
    query.set('or', `(shop_id.is.null,shop_id.in.(${principal.shopIds.join(',')}))`);
    return;
  }
  const shopIds = principal.shopIds.length > 0 ? principal.shopIds : [EMPTY_SCOPE_SENTINEL];
  query.set('shop_id', `in.(${shopIds.join(',')})`);
}

export async function listApprovalReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: ApprovalReadFilters = {},
): Promise<ApprovalReadModel[]> {
  const now = new Date();
  const query = new URLSearchParams({
    select:
      'id,business_id,shop_id,requester_employee_id,approver_employee_id,action_type,command_payload,reason,required_approver_permission,requires_second_person,status,expires_at,created_at,decided_at,executed_at,failed_at',
    business_id: `eq.${principal.businessId}`,
    order: 'created_at.desc,id.desc',
    limit: filters.id ? '1' : '100',
  });
  if (filters.id) query.set('id', `eq.${filters.id}`);
  applyPrincipalShopScope(query, principal, filters.shopId);
  if (filters.status) query.set('status', `eq.${filters.status}`);
  if (filters.status === 'PENDING') query.set('expires_at', `gt.${now.toISOString()}`);

  const requests = (
    await client.select<ApprovalRequestRow[]>('admin_approval_requests', query)
  ).filter((row) => visibleToPrincipal(row, principal));
  if (requests.length === 0) return [];

  const requestIds = requests.map((row) => row.id);
  const employeeIds = [
    ...new Set(
      requests.flatMap((row) => [
        row.requester_employee_id,
        ...(row.approver_employee_id ? [row.approver_employee_id] : []),
      ]),
    ),
  ];
  const [employees, shops, executions] = await Promise.all([
    client.select<EmployeeRow[]>(
      'business_employees',
      new URLSearchParams({
        select: 'id,display_name',
        business_id: `eq.${principal.businessId}`,
        id: `in.(${employeeIds.join(',')})`,
      }),
    ),
    client.select<ShopRow[]>(
      'shops',
      new URLSearchParams({
        select: 'id,name',
        id: `in.(${[...new Set(requests.flatMap((row) => (row.shop_id ? [row.shop_id] : [])))].join(',') || EMPTY_SCOPE_SENTINEL})`,
      }),
    ),
    client.select<ExecutionRow[]>(
      'admin_approval_execution_jobs',
      new URLSearchParams({
        select: 'approval_request_id,state,attempt_count,last_error_code',
        business_id: `eq.${principal.businessId}`,
        approval_request_id: `in.(${requestIds.join(',')})`,
      }),
    ),
  ]);

  const employeeNames = new Map(employees.map((row) => [row.id, row.display_name]));
  const shopNames = new Map(shops.map((row) => [row.id, row.name]));
  const executionsByRequest = new Map(executions.map((row) => [row.approval_request_id, row]));
  const nowMs = now.getTime();

  return requests.map((row) => {
    const execution = executionsByRequest.get(row.id);
    const actionLabel = titleCaseAction(row.action_type);
    const valueSummary = summarizePayload(row.command_payload);
    const expired = isExpiredPending(row, nowMs);
    const model: ApprovalReadModel = {
      id: row.id,
      requesterName: employeeNames.get(row.requester_employee_id) ?? 'Unknown requester',
      requesterEmployeeId: row.requester_employee_id,
      approverName: row.approver_employee_id
        ? (employeeNames.get(row.approver_employee_id) ?? 'Unknown approver')
        : null,
      shopId: row.shop_id,
      shopName: row.shop_id ? (shopNames.get(row.shop_id) ?? 'Assigned shop') : 'All shops',
      actionLabel,
      valueSummary,
      reason: row.reason,
      consequence: `Approving ${actionLabel} will execute the exact persisted change shown above through the durable approval executor using its existing idempotency key.`,
      status: row.status,
      displayStatus: expired ? 'EXPIRED' : row.status,
      canDecide: canPrincipalDecide(row, principal, expired),
      executionLabel: expired
        ? 'Expired — submit a new request if the action is still required.'
        : executionLabel(row.status, execution),
      expiresAt: row.expires_at,
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
