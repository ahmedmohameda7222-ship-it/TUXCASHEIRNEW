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
  createdAtLabel: string;
};

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
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
      appendValueRows(child, `${label ? `${label} · ` : ''}${humanizeKey(key)}`, rows);
    }
    return;
  }

  rows.push({ label: label || 'Value', value: String(value ?? '—') });
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
        <h2 id={`audit-${event.id}`}>{humanizeKey(event.actionType)}</h2>
        <p>{event.createdAtLabel}</p>
      </header>
      <dl className="admin-audit-facts">
        <div>
          <dt>Actor</dt>
          <dd>
            {event.actorLabel} · {event.actorRole}
          </dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>{event.shopName}</dd>
        </div>
        <div>
          <dt>Entity</dt>
          <dd>{event.entityType ? `${event.entityType} · ${event.entityId ?? '—'}` : '—'}</dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>{event.approvalRequestId ?? 'Not linked'}</dd>
        </div>
      </dl>
      {event.reason ? <p>Reason: {event.reason}</p> : null}
      <div className="admin-audit-change-grid">
        <ChangeList title="Before" value={event.beforeValue} />
        <ChangeList title="After" value={event.afterValue} />
      </div>
    </article>
  );
}
