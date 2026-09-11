import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

export function ShopsPage({
  workspace,
  onDeleteOrArchive,
  busy = false,
}: {
  workspace: AdminSettingsWorkspace;
  onDeleteOrArchive?: () => void;
  busy?: boolean;
}) {
  const shop = workspace.shop;
  return (
    <section className="admin-settings-section" aria-labelledby="settings-shop-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Canonical shop identity</p>
          <h2 id="settings-shop-title">{shop.name}</h2>
        </div>
        <span className="admin-status-pill">{shop.lifecycleState}</span>
      </div>
      <div className="admin-settings-grid">
        <article className="admin-settings-card">
          <span>Address</span>
          <strong>{shop.address ?? 'Not configured'}</strong>
          <small>{shop.timezone}</small>
        </article>
        <article className="admin-settings-card">
          <span>Contact phone</span>
          <strong>{shop.contactPhone ?? 'Not configured'}</strong>
          <small>Shared with receipts, delivery and store-location surfaces.</small>
        </article>
        <article className="admin-settings-card">
          <span>Online orders</span>
          <strong>{shop.onlineOrdersPaused ? 'Paused' : 'Accepting orders'}</strong>
          <small>
            {shop.temporaryClosed ? 'Shop is temporarily closed.' : 'Shop is not temporarily closed.'}
          </small>
        </article>
        <article className="admin-settings-card">
          <span>Coordinates</span>
          <strong>
            {shop.latitude === null || shop.longitude === null
              ? 'Not configured'
              : `${shop.latitude}, ${shop.longitude}`}
          </strong>
          <small>Canonical delivery/store-location coordinates.</small>
        </article>
      </div>
      <div className="admin-settings-subsection">
        <h3>Service hours</h3>
        {workspace.weeklyHours.length === 0 ? (
          <p className="admin-settings-muted">No weekly service hours configured.</p>
        ) : (
          <div className="admin-settings-list">
            {workspace.weeklyHours.map((hours) => (
              <div className="admin-settings-row" key={hours.id}>
                <div>
                  <strong>{hours.serviceKind}</strong>
                  <span>
                    Day {hours.dayOfWeek} · {hours.timezone}
                  </span>
                </div>
                <span>{hours.active ? `${hours.opensLocal}–${hours.closesLocal}` : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {onDeleteOrArchive ? (
        <div className="admin-settings-danger-zone">
          <div>
            <strong>Archive shop</strong>
            <span>Used shops are archived instead of deleting historical authority.</span>
          </div>
          <button
            className="admin-secondary-button"
            type="button"
            disabled={busy}
            onClick={onDeleteOrArchive}
          >
            Archive / delete unused shop
          </button>
        </div>
      ) : null}
    </section>
  );
}
