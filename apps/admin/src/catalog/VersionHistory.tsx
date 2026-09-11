import type { CatalogPublishVersionSummary } from '@tux/admin-contracts';

type VersionHistoryProps = {
  versions: readonly CatalogPublishVersionSummary[];
  currentPublishVersion: number;
  canRestore: boolean;
  pendingVersion: number | null;
  onRestore(version: number): Promise<void>;
};

function sourceLabel(version: CatalogPublishVersionSummary): string {
  if (version.sourceKind === 'ROLLBACK' && version.restoredFromPublishVersion !== null) {
    return `Rollback from version ${version.restoredFromPublishVersion}`;
  }
  if (version.sourceKind === 'IMMEDIATE_AVAILABILITY') return 'Immediate availability';
  if (version.sourceKind === 'BASELINE') return 'Baseline';
  if (version.sourceKind === 'SCHEDULE') return 'Scheduled publish';
  return 'Catalog publish';
}

export function VersionHistory({
  versions,
  currentPublishVersion,
  canRestore,
  pendingVersion,
  onRestore,
}: VersionHistoryProps) {
  return (
    <section className="admin-publish-card" aria-labelledby="catalog-history-heading">
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Immutable history</p>
          <h2 id="catalog-history-heading">Version history</h2>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="admin-empty-state">
          <strong>No publish history yet</strong>
          <span>The first canonical publish will appear here.</span>
        </div>
      ) : (
        <div className="admin-publish-history">
          {versions.map((version) => {
            const isCurrent = version.publishVersion === currentPublishVersion;
            return (
              <article className="admin-publish-history__row" key={version.publishVersion}>
                <div className="admin-publish-history__main">
                  <div className="admin-publish-history__title">
                    <strong>Version {version.publishVersion}</strong>
                    {isCurrent ? <span className="admin-status-pill">Live</span> : null}
                  </div>
                  <span>{sourceLabel(version)}</span>
                  <time dateTime={version.publishedAt}>
                    {new Date(version.publishedAt).toLocaleString()}
                  </time>
                </div>
                {!isCurrent ? (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={!canRestore || pendingVersion !== null}
                    onClick={() => void onRestore(version.publishVersion)}
                  >
                    {pendingVersion === version.publishVersion
                      ? 'Restoring…'
                      : `Restore version ${version.publishVersion}`}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
