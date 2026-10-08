import type { AdminApprovalStatus } from '@tux/admin-contracts';

export type AuditDetailViewModel = {
  id: string;
  shopName: string;
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
  sessionId: string | null;
  contextMetadata: unknown;
  createdAtLabel: string;
};

export function auditLabel(key: string): string {
  const label = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .toLowerCase();
  return label.replace(/^./, (character) => character.toUpperCase());
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const auditNumberFormatter = new Intl.NumberFormat('en-EG', { maximumFractionDigits: 6 });

export function displayAuditValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return auditNumberFormatter.format(value);
  if (typeof value === 'string') {
    if (uuidPattern.test(value)) return 'Internal record';
    if (/^[A-Z][A-Z0-9_]*$/.test(value)) return auditLabel(value);
    return value;
  }
  return String(value ?? '—');
}

type ChangeRow = { label: string; value: string };

function appendValueRows(value: unknown, label: string, rows: ChangeRow[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ label: label || 'Value', value: '[]' });
      return;
    }
    value.forEach((item, index) => {
      appendValueRows(item, `${label ? `${label} · ` : ''}Item ${index + 1}`, rows);
    });
    return;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      rows.push({ label: label || 'Value', value: '{}' });
      return;
    }
    for (const [key, child] of entries) {
      appendValueRows(child, `${label ? `${label} · ` : ''}${auditLabel(key)}`, rows);
    }
    return;
  }

  rows.push({ label: label || 'Value', value: displayAuditValue(value) });
}

function valueRows(value: unknown): ChangeRow[] {
  if (value === null || value === undefined) return [];
  const rows: ChangeRow[] = [];
  appendValueRows(value, '', rows);
  return rows;
}

function ChangeList({ title, value }: { title: string; value: unknown }) {
  const rows = valueRows(value);
  return (
    <section className="admin-audit-change">
      <h3>{title}</h3>
      {rows.length === 0 ? <p>Not recorded.</p> : null}
      <dl>
        {rows.map((row, index) => (
          <div key={`${index}:${row.label}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AuditDetailPage({ event }: { event: AuditDetailViewModel }) {
  return (
    <article className="admin-audit-detail" aria-labelledby={`audit-${event.id}`}>
      <header>
        <p className="admin-catalog-editor__eyebrow">Audit event</p>
        <h2 id={`audit-${event.id}`}>
          {event.actorLabel} · {auditLabel(event.actionType)}
        </h2>
        <p>{event.createdAtLabel}</p>
      </header>
      <dl className="admin-audit-facts">
        <div>
          <dt>Actor</dt>
          <dd>
            {event.actorLabel} · {auditLabel(event.actorRole)}
          </dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{event.shopName}</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>{event.entityType ? auditLabel(event.entityType) : 'General activity'}</dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>
            {event.approvalRequestId ? (
              <>
                <span>Requested by {event.requesterName ?? 'Unknown'}</span>
                <span> · Approved by {event.approverName ?? 'Not decided'}</span>
                <span>
                  {' '}
                  · {event.approvalStatus ? auditLabel(event.approvalStatus) : 'Unknown status'}
                </span>
              </>
            ) : (
              'Not linked'
            )}
          </dd>
        </div>
      </dl>
      {event.reason ? <p>Reason: {event.reason}</p> : null}
      <div className="admin-audit-change-grid">
        <ChangeList title="Before" value={event.beforeValue} />
        <ChangeList title="After" value={event.afterValue} />
      </div>
      <details className="admin-audit-technical">
        <summary>Technical details</summary>
        <dl className="admin-audit-facts">
          <div>
            <dt>Event reference</dt>
            <dd>{event.id}</dd>
          </div>
          <div>
            <dt>Record reference</dt>
            <dd>{event.entityId ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Approval reference</dt>
            <dd>{event.approvalRequestId ?? 'Not linked'}</dd>
          </div>
          <div>
            <dt>Session reference</dt>
            <dd>{event.sessionId ?? 'Not recorded'}</dd>
          </div>
        </dl>
        <ChangeList title="Additional context" value={event.contextMetadata} />
      </details>
    </article>
  );
}
