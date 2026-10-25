import type { CatalogJsonValue, CatalogPublishEntityChange } from '@tux/admin-contracts';

const fieldLabels: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  priceMinor: 'Price',
  categoryId: 'Category assignment',
  slug: 'URL slug',
  imageKey: 'Product image',
  family: 'Product family',
  bestSeller: 'Best-seller flag',
  active: 'Active / archived',
  soldOut: 'Manual sold-out status',
  isCombo: 'Combo configuration',
  sortOrder: 'Display order',
};

function formatValue(field: string, value: CatalogJsonValue | undefined): string {
  if (value === undefined || value === null) return 'None';
  if (field === 'priceMinor' && typeof value === 'number') {
    return `EGP ${(value / 100).toFixed(2)}`;
  }
  if (field === 'active' && typeof value === 'boolean') return value ? 'Active' : 'Archived';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function title(change: CatalogPublishEntityChange): string {
  const preferred = change.after?.['name'] ?? change.before?.['name'];
  return typeof preferred === 'string' && preferred ? preferred : change.id;
}

export function PublishReviewChanges({
  changes,
}: {
  changes: readonly CatalogPublishEntityChange[];
}) {
  const modified = changes.filter((change) => change.status !== 'unchanged');
  const unchanged = changes.filter((change) => change.status === 'unchanged');

  return (
    <section className="admin-publish-card" aria-labelledby="publishing-field-diff-heading">
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Compare draft with current publication</p>
          <h2 id="publishing-field-diff-heading">Before → After review</h2>
        </div>
        <span className="admin-status-pill">{modified.length} changed records</span>
      </div>
      {modified.length === 0 ? (
        <p>There are no changed products, categories, or modifiers in this draft.</p>
      ) : (
        <div className="admin-publish-history">
          {modified.map((change) => (
            <article className="admin-publish-history__row" key={`${change.kind}:${change.id}`}>
              <div className="admin-publish-history__main">
                <div className="admin-publish-history__title">
                  <strong>{title(change)}</strong>
                  <span className="admin-status-pill">
                    {change.kind} · {change.status}
                  </span>
                </div>
                {change.changedFields.map((field) => (
                  <div className="admin-settings-row" key={field}>
                    <strong>{fieldLabels[field] ?? field}</strong>
                    <span>
                      {formatValue(field, change.before?.[field])} →{' '}
                      {formatValue(field, change.after?.[field])}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      {unchanged.length ? (
        <details>
          <summary>{unchanged.length} unchanged records</summary>
          <ul>
            {unchanged.map((change) => (
              <li key={`${change.kind}:${change.id}`}>
                {change.kind} · {title(change)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="admin-publish-card__copy">
        Relationship changes are summarized separately. No change takes effect until it passes the
        authorized publish and approval workflow.
      </p>
    </section>
  );
}
