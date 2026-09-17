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
type AuditActorOption = { employeeId: string; label: string };
type AuditResponse = { events: AuditApiModel[]; actorOptions: AuditActorOption[] };

const APPROVAL_STATUSES: readonly AdminApprovalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
];
const CAIRO_TIME_ZONE = 'Africa/Cairo';
const cairoWallClockFormatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
  timeZone: CAIRO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function parseBusinessDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function cairoWallClockMillis(instantMillis: number): number {
  const parts = Object.fromEntries(
    cairoWallClockFormatter
      .formatToParts(new Date(instantMillis))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return Date.UTC(
    parts['year'] ?? 0,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
}

function cairoStartOfDateMillis(year: number, month: number, day: number): number {
  const targetWallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidate = targetWallClock;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const delta = targetWallClock - cairoWallClockMillis(candidate);
    candidate += delta;
    if (delta === 0) break;
  }
  return candidate;
}

export function cairoDateBoundary(value: string, endOfDay: boolean): string | null {
  const parsed = parseBusinessDate(value);
  if (!parsed) return null;
  const start = cairoStartOfDateMillis(parsed.year, parsed.month, parsed.day);
  if (!endOfDay) return new Date(start).toISOString();

  const nextDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  const nextStart = cairoStartOfDateMillis(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
  );
  return new Date(nextStart - 1).toISOString();
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
      const from = cairoDateBoundary(fromDate, false);
      const to = cairoDateBoundary(toDate, true);
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
  const actorOptions = auditQuery.data?.actorOptions ?? [];
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId],
  );
  const shopNames = useMemo(
    () =>
      new Map(events.flatMap((event) => (event.shopId ? [[event.shopId, event.shopName]] : []))),
    [events],
  );

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
            {actorOptions.map((actor) => (
              <option key={actor.employeeId} value={actor.employeeId}>
                {actor.label}
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
