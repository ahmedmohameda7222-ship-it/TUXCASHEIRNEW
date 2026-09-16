import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import { AuditDetailPage, type AuditDetailViewModel } from './AuditDetailPage';
import './audit.css';

type AuditApiModel = Omit<AuditDetailViewModel, 'createdAtLabel'> & { createdAt: string };
type AuditResponse = { events: AuditApiModel[] };

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function AuditPage() {
  const [actionType, setActionType] = useState('');
  const [entityType, setEntityType] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const auditQuery = useQuery({
    queryKey: ['admin', 'audit', actionType, entityType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (actionType.trim()) params.set('actionType', actionType.trim());
      if (entityType.trim()) params.set('entityType', entityType.trim());
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      return adminFetch<AuditResponse>(`/api/admin/audit${suffix}`);
    },
  });
  const events = auditQuery.data?.events ?? [];
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId],
  );

  return (
    <PageScaffold
      eyebrow="History"
      title="Audit log"
      description="Immutable business mutation history with actor role, shop, entity, reason, and approval linkage."
    >
      <div className="admin-audit-filters" aria-label="Audit filters">
        <label className="admin-field">
          <span>Action</span>
          <input
            value={actionType}
            onChange={(event) => setActionType(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>Entity</span>
          <input
            value={entityType}
            onChange={(event) => setEntityType(event.currentTarget.value)}
          />
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
