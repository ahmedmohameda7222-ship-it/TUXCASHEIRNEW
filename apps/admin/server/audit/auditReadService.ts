import type { AdminApprovalStatus, AdminSessionPrincipal } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

export type AuditReadCursor = {
  createdAt: string;
  id: string;
};

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
  cursor?: AuditReadCursor;
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

export type AuditReadPage = {
  events: AuditReadModel[];
  nextCursor: AuditReadCursor | null;
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
const AUDIT_PAGE_SIZE = 100;

function hasBusinessWideAuthority(principal: AdminSessionPrincipal): boolean {
  return principal.role === 'OWNER' || principal.role === 'ADMIN';
}

function scopedShopIds(principal: AdminSessionPrincipal): string[] | null {
  return principal.role === 'OWNER' ? null : principal.shopIds;
}

function visibleToPrincipal(row: AuditRow, principal: AdminSessionPrincipal): boolean {
  if (row.shop_id === null) return hasBusinessWideAuthority(principal);
  return principal.shopIds.includes(row.shop_id);
}

function cursorOrFilter(cursor: AuditReadCursor): string {
  return `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`;
}

function applyPrincipalShopScope(
  query: URLSearchParams,
  principal: AdminSessionPrincipal,
  explicitShopId: string | undefined,
  cursor: AuditReadCursor | undefined,
): void {
  if (explicitShopId) {
    query.set('shop_id', `eq.${explicitShopId}`);
    if (cursor) query.set('or', cursorOrFilter(cursor));
    return;
  }
  if (principal.role === 'OWNER') {
    if (cursor) query.set('or', cursorOrFilter(cursor));
    return;
  }
  if (principal.role === 'ADMIN') {
    if (principal.shopIds.length === 0) {
      query.set('shop_id', 'is.null');
      if (cursor) query.set('or', cursorOrFilter(cursor));
      return;
    }
    if (cursor) {
      const scope = `or(shop_id.is.null,shop_id.in.(${principal.shopIds.join(',')}))`;
      const continuation = `or${cursorOrFilter(cursor)}`;
      query.set('and', `(${scope},${continuation})`);
    } else {
      query.set('or', `(shop_id.is.null,shop_id.in.(${principal.shopIds.join(',')}))`);
    }
    return;
  }
  const shopIds = principal.shopIds.length > 0 ? principal.shopIds : [EMPTY_SCOPE_SENTINEL];
  query.set('shop_id', `in.(${shopIds.join(',')})`);
  if (cursor) query.set('or', cursorOrFilter(cursor));
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
  const pageLimit = filters.id ? 1 : AUDIT_PAGE_SIZE + 1;
  if (filters.approvalStatus && hasAuditRpc(client)) {
    const rows = await client.rpc<AuditRow[]>('list_admin_audit_events_v3', {
      p_business_id: principal.businessId,
      p_shop_ids: scopedShopIds(principal),
      p_include_business_wide: hasBusinessWideAuthority(principal),
      p_shop_id: filters.shopId ?? null,
      p_actor_employee_id: filters.actorEmployeeId ?? null,
      p_action_type: filters.actionType ?? null,
      p_entity_type: filters.entityType ?? null,
      p_entity_id: filters.entityId ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_approval_status: filters.approvalStatus,
      p_event_id: filters.id ?? null,
      p_before_created_at: filters.id ? null : filters.cursor?.createdAt ?? null,
      p_before_id: filters.id ? null : filters.cursor?.id ?? null,
      p_limit: pageLimit,
    });
    return rows.filter((row) => visibleToPrincipal(row, principal));
  }

  const query = new URLSearchParams({
    select:
      'id,business_id,shop_id,actor_kind,actor_employee_id,actor_role,requester_employee_id,approver_employee_id,action_type,entity_type,entity_id,before_value,after_value,reason,approval_request_id,created_at',
    business_id: `eq.${principal.businessId}`,
    order: 'created_at.desc,id.desc',
    limit: String(pageLimit),
  });
  applyPrincipalShopScope(
    query,
    principal,
    filters.shopId,
    filters.id ? undefined : filters.cursor,
  );
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

  const rows = await client.rpc<AuditActorOptionRow[]>('list_admin_audit_actor_options_v2', {
    p_business_id: principal.businessId,
    p_shop_ids: scopedShopIds(principal),
    p_include_business_wide: hasBusinessWideAuthority(principal),
  });

  return rows
    .map((row) => ({ employeeId: row.employee_id, label: row.display_name }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

async function toAuditReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  events: AuditRow[],
): Promise<AuditReadModel[]> {
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

export async function listAuditReadPage(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: AuditReadFilters = {},
): Promise<AuditReadPage> {
  const visibleEvents = await loadEvents(client, principal, filters);
  const events = filters.id
    ? visibleEvents.slice(0, 1)
    : visibleEvents.slice(0, AUDIT_PAGE_SIZE);
  const lastEvent = events.at(-1);
  const nextCursor =
    !filters.id && visibleEvents.length > AUDIT_PAGE_SIZE && lastEvent
      ? { createdAt: lastEvent.created_at, id: lastEvent.id }
      : null;

  return {
    events: await toAuditReadModels(client, principal, events),
    nextCursor,
  };
}

export async function listAuditReadModels(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  filters: AuditReadFilters = {},
): Promise<AuditReadModel[]> {
  return (await listAuditReadPage(client, principal, filters)).events;
}
