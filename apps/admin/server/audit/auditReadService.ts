import type { AdminApprovalStatus, AdminSessionPrincipal } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type AuditReadFilters = {
  shopId?: string;
  actorEmployeeId?: string;
  actionType?: string;
  entityType?: string;
  approvalStatus?: AdminApprovalStatus;
  from?: string;
  to?: string;
};

export type AuditReadModel = {
  id: string;
  shopId: string | null;
  shopName: string;
  actorEmployeeId: string | null;
  actorLabel: string;
  actorRole: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string | null;
  approvalRequestId: string | null;
  approvalStatus: AdminApprovalStatus | null;
  createdAt: string;
};

type AuditRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  actor_kind: 'HUMAN' | 'SYSTEM';
  actor_employee_id: string | null;
  actor_role: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  approval_request_id: string | null;
  created_at: string;
};

type EmployeeRow = { id: string; display_name: string };
type ShopRow = { id: string; name: string };
type ApprovalRow = { id: string; status: AdminApprovalStatus };

function visibleToPrincipal(row: AuditRow, principal: AdminSessionPrincipal): boolean {
  return row.shop_id === null || principal.shopIds.includes(row.shop_id);
}

function inFilter(ids: readonly string[]): string {
  return `in.(${ids.join(',')})`;
}

export async function listAuditReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: AuditReadFilters = {},
): Promise<AuditReadModel[]> {
  let statusMatchedApprovals: ApprovalRow[] | null = null;
  if (filters.approvalStatus) {
    const approvalRows = await client.select<ApprovalRow[]>(
      'admin_approval_requests',
      new URLSearchParams({
        select: 'id,status',
        business_id: `eq.${principal.businessId}`,
        status: `eq.${filters.approvalStatus}`,
        limit: '100',
      }),
    );
    statusMatchedApprovals = approvalRows.filter(
      (approval) => approval.status === filters.approvalStatus,
    );
    if (statusMatchedApprovals.length === 0) return [];
  }

  const query = new URLSearchParams({
    select:
      'id,business_id,shop_id,actor_kind,actor_employee_id,actor_role,action_type,entity_type,entity_id,before_value,after_value,reason,approval_request_id,created_at',
    business_id: `eq.${principal.businessId}`,
    order: 'created_at.desc,id.desc',
    limit: '100',
  });
  if (filters.shopId) query.set('shop_id', `eq.${filters.shopId}`);
  if (filters.actorEmployeeId) query.set('actor_employee_id', `eq.${filters.actorEmployeeId}`);
  if (filters.actionType) query.set('action_type', `eq.${filters.actionType}`);
  if (filters.entityType) query.set('entity_type', `eq.${filters.entityType}`);
  if (filters.from) query.set('created_at', `gte.${filters.from}`);
  if (filters.to) query.append('created_at', `lte.${filters.to}`);
  if (statusMatchedApprovals) {
    query.set(
      'approval_request_id',
      inFilter(statusMatchedApprovals.map((approval) => approval.id)),
    );
  }

  const matchedApprovalIds = statusMatchedApprovals
    ? new Set(statusMatchedApprovals.map((approval) => approval.id))
    : null;
  const rows = (await client.select<AuditRow[]>('admin_audit_events', query)).filter(
    (row) =>
      visibleToPrincipal(row, principal) &&
      (matchedApprovalIds === null ||
        (row.approval_request_id !== null && matchedApprovalIds.has(row.approval_request_id))),
  );
  if (rows.length === 0) return [];

  const linkedApprovalIds = [
    ...new Set(rows.flatMap((row) => (row.approval_request_id ? [row.approval_request_id] : []))),
  ];
  const approvalRowsPromise = statusMatchedApprovals
    ? Promise.resolve(statusMatchedApprovals)
    : linkedApprovalIds.length === 0
      ? Promise.resolve<ApprovalRow[]>([])
      : client.select<ApprovalRow[]>(
          'admin_approval_requests',
          new URLSearchParams({
            select: 'id,status',
            business_id: `eq.${principal.businessId}`,
            id: inFilter(linkedApprovalIds),
            limit: '100',
          }),
        );

  const [employees, shops, approvals] = await Promise.all([
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
        id: `in.(${[...new Set(rows.flatMap((row) => (row.shop_id ? [row.shop_id] : [])))].join(',') || '00000000-0000-0000-0000-000000000000'})`,
      }),
    ),
    approvalRowsPromise,
  ]);
  const employeeNames = new Map(employees.map((row) => [row.id, row.display_name]));
  const shopNames = new Map(shops.map((row) => [row.id, row.name]));
  const approvalStatuses = new Map(approvals.map((row) => [row.id, row.status]));

  return rows.map((row) => ({
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_id ? (shopNames.get(row.shop_id) ?? 'Assigned shop') : 'All shops',
    actorEmployeeId: row.actor_employee_id,
    actorLabel:
      row.actor_kind === 'SYSTEM'
        ? 'System'
        : (employeeNames.get(row.actor_employee_id ?? '') ?? 'Unknown actor'),
    actorRole: row.actor_role,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    reason: row.reason,
    approvalRequestId: row.approval_request_id,
    approvalStatus: row.approval_request_id
      ? (approvalStatuses.get(row.approval_request_id) ?? null)
      : null,
    createdAt: row.created_at,
  }));
}
