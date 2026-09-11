import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { displaySettingValue, resolveWorkspaceSetting, settingSourceLabel } from './settingsModel';

const CHECKOUT_KEYS = [
  ['checkout.serviceChargeBps', 'Service charge (bps)'],
  ['checkout.minimumOrderMinor', 'Minimum order'],
  ['checkout.requireCustomerPhone', 'Require customer phone'],
  ['checkout.allowScheduledOrders', 'Scheduled orders'],
] as const;

export function CheckoutPage({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <section className="admin-settings-section" aria-labelledby="settings-checkout-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Published checkout rules</p>
          <h2 id="settings-checkout-title">Checkout</h2>
        </div>
        <span className="admin-status-pill">v{workspace.settingsVersion}</span>
      </div>
      <div className="admin-settings-grid">
        {CHECKOUT_KEYS.map(([key, label]) => {
          const setting = resolveWorkspaceSetting(workspace, key);
          return (
            <article className="admin-settings-card" key={key}>
              <span>{label}</span>
              <strong>{displaySettingValue(setting.value)}</strong>
              <small>{settingSourceLabel(setting.source)}</small>
            </article>
          );
        })}
      </div>
      <div className="admin-settings-subsection">
        <h3>Delivery zones</h3>
        {workspace.deliveryZones.length === 0 ? (
          <p className="admin-settings-muted">No delivery zones configured.</p>
        ) : (
          <div className="admin-settings-list">
            {workspace.deliveryZones.map((zone) => (
              <div className="admin-settings-row" key={zone.id}>
                <div>
                  <strong>{zone.name}</strong>
                  <span>Sort {zone.sortOrder}</span>
                </div>
                <span>{zone.active ? `${(zone.feeMinor / 100).toFixed(2)} EGP` : 'Inactive'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
