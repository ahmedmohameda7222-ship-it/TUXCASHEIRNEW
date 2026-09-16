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

function valueRows(value: unknown): Array<{ label: string; value: string }> {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ label: `Item ${index + 1}`, value: String(item) }));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      label: humanizeKey(key),
      value:
        typeof item === 'object' && item !== null ? 'Structured value changed' : String(item ?? '—'),
    }));
  }
  return [{ label: 'Value', value: String(value) }];
}

function ChangeList({ title, value }: { title: string; value: unknown }) {
  const rows = valueRows(value);
  return (
    <section className="admin-audit-change">
      <h3>{title}</h3>
      {rows.length === 0 ? <p>Not recorded.</p> : null}
      <dl>
        {rows.map((row) => (
          <div key={`${row.label}:${row.value}`}>
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
