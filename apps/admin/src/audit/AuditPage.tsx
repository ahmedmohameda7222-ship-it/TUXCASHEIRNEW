import type { AdminApprovalStatus } from '@tux/admin-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import { useShopScope } from '../shops/ShopScopeProvider';
import { AuditDetailPage, type AuditDetailViewModel } from './AuditDetailPage';
import './audit.css';

type AuditApiModel = Omit<AuditDetailViewModel, 'createdAtLabel'> & {
  createdAt: string;
  shopId: string | null;
  actorEmployeeId: string | null;
  approvalStatus: AdminApprovalStatus | null;
};
type AuditResponse = { events: AuditApiModel[] };

const APPROVAL_STATUSES: readonly AdminApprovalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
];

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function dateBoundary(value: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
}

export function AuditPage() {
  const { principal } = useShopScope();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [shopId, setShopId] = useState('');
  const [actorEmployeeId, setActorEmployeeId] = useState('');
  const [actionType, setActionType] = useState('');
  const [entityType, setEntityType] = useState('');
  const [approvalStatus, setApprovalStatus] = useState<AdminApprovalStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const auditQuery = useQuery({
    queryKey: [
      'admin',
      'audit',
      fromDate,
      toDate,
      shopId,
      actorEmployeeId,
      actionType,
      entityType,
      approvalStatus,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      const from = dateBoundary(fromDate, false);
      const to = dateBoundary(toDate, true);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (shopId) params.set('shopId', shopId);
      if (actorEmployeeId) params.set('actorEmployeeId', actorEmployeeId);
      if (actionType.trim()) params.set('actionType', actionType.trim());
      if (entityType.trim()) params.set('entityType', entityType.trim());
      if (approvalStatus) params.set('approvalStatus', approvalStatus);
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      return adminFetch<AuditResponse>(`/api/admin/audit${suffix}`);
    },
  });
  const events = auditQuery.data?.events ?? [];
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId],
  );
  const shopNames = useMemo(
    () =>
      new Map(events.flatMap((event) => (event.shopId ? [[event.shopId, event.shopName]] : []))),
    [events],
  );
  const actorOptions = useMemo(() => {
    const actors = new Map<string, string>();
    for (const event of events) {
      if (event.actorEmployeeId) actors.set(event.actorEmployeeId, event.actorLabel);
    }
    if (actorEmployeeId && !actors.has(actorEmployeeId)) {
      actors.set(actorEmployeeId, 'Selected actor');
    }
    return [...actors.entries()];
  }, [events, actorEmployeeId]);

  return (
    <PageScaffold
      eyebrow="History"
      title="Audit log"
      description="Immutable business mutation history with actor role, shop, entity, reason, and approval linkage."
    >
      <div className="admin-audit-filters" aria-label="Audit filters">
        <label className="admin-field">
          <span>From date</span>
          <input
            aria-label="From date"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>To date</span>
          <input
            aria-label="To date"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>Shop</span>
          <select
            aria-label="Shop"
            value={shopId}
            onChange={(event) => setShopId(event.currentTarget.value)}
          >
            <option value="">All authorized shops</option>
            {principal.shopIds.map((authorizedShopId, index) => (
              <option key={authorizedShopId} value={authorizedShopId}>
                {shopNames.get(authorizedShopId) ?? `Shop ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Actor</span>
          <select
            aria-label="Actor"
            value={actorEmployeeId}
            onChange={(event) => setActorEmployeeId(event.currentTarget.value)}
          >
            <option value="">All human actors</option>
            {actorOptions.map(([employeeId, label]) => (
              <option key={employeeId} value={employeeId}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Action</span>
          <input
            aria-label="Action"
            value={actionType}
            onChange={(event) => setActionType(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>Entity</span>
          <input
            aria-label="Entity"
            value={entityType}
            onChange={(event) => setEntityType(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>Approval status</span>
          <select
            aria-label="Approval status"
            value={approvalStatus}
            onChange={(event) =>
              setApprovalStatus(event.currentTarget.value as AdminApprovalStatus | '')
            }
          >
            <option value="">All approval statuses</option>
            {APPROVAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      {auditQuery.isLoading ? <p>Loading audit history…</p> : null}
      {auditQuery.isError ? (
        <p className="admin-error-text">Audit history could not be loaded.</p>
      ) : null}
      {!auditQuery.isLoading && events.length === 0 ? (
        <p>No audit events match these filters.</p>
      ) : null}
      <div className="admin-audit-layout">
        <nav className="admin-audit-list" aria-label="Audit events">
          {events.map((event) => (
            <button
              className="admin-audit-list__item"
              aria-current={event.id === selected?.id ? 'true' : undefined}
              key={event.id}
              type="button"
              onClick={() => setSelectedId(event.id)}
            >
              <strong>{event.actionType.replaceAll('_', ' ')}</strong>
              <span>{event.actorLabel}</span>
              <span>{event.shopName}</span>
              <span>{formatInstant(event.createdAt)}</span>
            </button>
          ))}
        </nav>
        {selected ? (
          <AuditDetailPage
            event={{ ...selected, createdAtLabel: formatInstant(selected.createdAt) }}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
