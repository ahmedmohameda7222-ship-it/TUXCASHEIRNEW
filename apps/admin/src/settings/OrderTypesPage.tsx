import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

export function OrderTypesPage({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <section className="admin-settings-section" aria-labelledby="settings-order-types-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Canonical fulfillment authority</p>
          <h2 id="settings-order-types-title">Order types</h2>
        </div>
        <span className="admin-status-pill">{workspace.orderTypes.length} configured</span>
      </div>
      <p className="admin-settings-muted">
        These are the existing canonical order types consumed by Operations and online ordering.
      </p>
      <div className="admin-settings-list">
        {workspace.orderTypes.map((orderType) => (
          <div className="admin-settings-row" key={orderType.id}>
            <div>
              <strong>{orderType.name}</strong>
              <span>
                {orderType.behavior} · sort {orderType.sortOrder}
              </span>
            </div>
            <span className={orderType.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}>
              {orderType.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
