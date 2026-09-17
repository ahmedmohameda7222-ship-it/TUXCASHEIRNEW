import type { AdminApprovalStatus, AdminSessionPrincipal } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type AuditReadFilters = {
  id?: string;
  shopId?: string;
  actorEmployeeId?: string;
  actionType?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  approvalStatus?: AdminApprovalStatus;
};

export type AuditReadModel = {
  id: string;
  shopId: string | null;
  shopName: string;
  actorKind: 'HUMAN' | 'SYSTEM';
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
  requesterName: string | null;
  approverName: string | null;
  approvalStatus: AdminApprovalStatus | null;
  createdAt: string;
};

export type AuditActorOption = {
  employeeId: string;
  label: string;
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
  requester_employee_id: string | null;
  approver_employee_id: string | null;
  approval_status?: AdminApprovalStatus | null;
  created_at: string;
};

type EmployeeRow = { id: string; display_name: string };
type AuditActorOptionRow = { employee_id: string; display_name: string };
type ShopRow = { id: string; name: string };
type ApprovalRow = { id: string; status: AdminApprovalStatus };

const EMPTY_SCOPE_SENTINEL = '00000000-0000-0000-0000-000000000000';

function hasBusinessWideAuthority(principal: AdminSessionPrincipal): boolean {
  return principal.role === 'OWNER' || principal.role === 'ADMIN';
}

function visibleToPrincipal(row: AuditRow, principal: AdminSessionPrincipal): boolean {
  if (row.shop_id === null) return hasBusinessWideAuthority(principal);
  return principal.shopIds.includes(row.shop_id);
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
  if (hasBusinessWideAuthority(principal)) return;
  const shopIds = principal.shopIds.length > 0 ? principal.shopIds : [EMPTY_SCOPE_SENTINEL];
  query.set('shop_id', `in.(${shopIds.join(',')})`);
}

function applyEventFilters(query: URLSearchParams, filters: AuditReadFilters): void {
  if (filters.id) query.set('id', `eq.${filters.id}`);
  if (filters.actorEmployeeId) query.set('actor_employee_id', `eq.${filters.actorEmployeeId}`);
  if (filters.actionType) query.set('action_type', `eq.${filters.actionType}`);
  if (filters.entityType) query.set('entity_type', `eq.${filters.entityType}`);
  if (filters.entityId) query.set('entity_id', `eq.${filters.entityId}`);
  if (filters.from) query.set('created_at', `gte.${filters.from}`);
  if (filters.to) query.append('created_at', `lte.${filters.to}`);
}

function hasAuditRpc(client: AdminSupabaseClient): boolean {
  return typeof (client as unknown as { rpc?: unknown }).rpc === 'function';
}

async function loadEvents(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: AuditReadFilters,
): Promise<AuditRow[]> {
  if (filters.approvalStatus && hasAuditRpc(client)) {
    const rows = await client.rpc<AuditRow[]>('list_admin_audit_events_v1', {
      p_business_id: principal.businessId,
      p_shop_ids: hasBusinessWideAuthority(principal) ? null : principal.shopIds,
      p_shop_id: filters.shopId ?? null,
      p_actor_employee_id: filters.actorEmployeeId ?? null,
      p_action_type: filters.actionType ?? null,
      p_entity_type: filters.entityType ?? null,
      p_entity_id: filters.entityId ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_approval_status: filters.approvalStatus,
      p_event_id: filters.id ?? null,
      p_limit: filters.id ? 1 : 100,
    });
    return rows.filter((row) => visibleToPrincipal(row, principal));
  }

  const query = new URLSearchParams({
    select:
      'id,business_id,shop_id,actor_kind,actor_employee_id,actor_role,requester_employee_id,approver_employee_id,action_type,entity_type,entity_id,before_value,after_value,reason,approval_request_id,created_at',
    business_id: `eq.${principal.businessId}`,
    order: 'created_at.desc,id.desc',
    limit: filters.id ? '1' : '100',
  });
  applyPrincipalShopScope(query, principal, filters.shopId);
  applyEventFilters(query, filters);
  let events = (await client.select<AuditRow[]>('admin_audit_events', query)).filter((row) =>
    visibleToPrincipal(row, principal),
  );
  if (filters.approvalStatus) {
    events = events.filter((row) => row.approval_status === filters.approvalStatus);
  }
  return events;
}

export async function listAuditActorOptions(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
): Promise<AuditActorOption[]> {
  if (!hasAuditRpc(client)) throw new Error('admin_audit_actor_options_rpc_required');
  if (!hasBusinessWideAuthority(principal) && principal.shopIds.length === 0) return [];

  const rows = await client.rpc<AuditActorOptionRow[]>('list_admin_audit_actor_options_v1', {
    p_business_id: principal.businessId,
    p_shop_ids: hasBusinessWideAuthority(principal) ? null : principal.shopIds,
  });

  return rows
    .map((row) => ({ employeeId: row.employee_id, label: row.display_name }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function listAuditReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: AuditReadFilters = {},
): Promise<AuditReadModel[]> {
  const events = await loadEvents(client, principal, filters);
  if (events.length === 0) return [];

  const approvalStatusById = new Map<string, AdminApprovalStatus>();
  for (const row of events) {
    if (row.approval_request_id && row.approval_status) {
      approvalStatusById.set(row.approval_request_id, row.approval_status);
    }
  }

  const approvalRequestIds = [
    ...new Set(events.flatMap((row) => (row.approval_request_id ? [row.approval_request_id] : []))),
  ];
  const missingApprovalStatusIds = approvalRequestIds.filter(
    (approvalRequestId) => !approvalStatusById.has(approvalRequestId),
  );
  if (missingApprovalStatusIds.length > 0) {
    const approvalRows = await client.select<ApprovalRow[]>(
      'admin_approval_requests',
      new URLSearchParams({
        select: 'id,status',
        business_id: `eq.${principal.businessId}`,
        id: `in.(${missingApprovalStatusIds.join(',')})`,
      }),
    );
    for (const row of approvalRows) approvalStatusById.set(row.id, row.status);
  }

  const employeeIds = [
    ...new Set(
      events.flatMap((row) =>
        [row.actor_employee_id, row.requester_employee_id, row.approver_employee_id].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  const shopIds = [...new Set(events.flatMap((row) => (row.shop_id ? [row.shop_id] : [])))];

  const [employees, shops] = await Promise.all([
    client.select<EmployeeRow[]>(
      'business_employees',
      new URLSearchParams({
        select: 'id,display_name',
        business_id: `eq.${principal.businessId}`,
        id: `in.(${employeeIds.join(',') || EMPTY_SCOPE_SENTINEL})`,
      }),
    ),
    client.select<ShopRow[]>(
      'shops',
      new URLSearchParams({
        select: 'id,name',
        id: `in.(${shopIds.join(',') || EMPTY_SCOPE_SENTINEL})`,
      }),
    ),
  ]);

  const employeeNames = new Map(employees.map((row) => [row.id, row.display_name]));
  const shopNames = new Map(shops.map((row) => [row.id, row.name]));

  return events.map((row) => ({
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_id ? (shopNames.get(row.shop_id) ?? 'Assigned shop') : 'All shops',
    actorKind: row.actor_kind,
    actorEmployeeId: row.actor_employee_id,
    actorLabel:
      row.actor_kind === 'SYSTEM'
        ? 'System'
        : row.actor_employee_id
          ? (employeeNames.get(row.actor_employee_id) ?? 'Unknown actor')
          : 'Unknown actor',
    actorRole: row.actor_role,
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    reason: row.reason,
    approvalRequestId: row.approval_request_id,
    requesterName: row.requester_employee_id
      ? (employeeNames.get(row.requester_employee_id) ?? 'Unknown requester')
      : null,
    approverName: row.approver_employee_id
      ? (employeeNames.get(row.approver_employee_id) ?? 'Unknown approver')
      : null,
    approvalStatus: row.approval_request_id
      ? (approvalStatusById.get(row.approval_request_id) ?? null)
      : null,
    createdAt: row.created_at,
  }));
}
