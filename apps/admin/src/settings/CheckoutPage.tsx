import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { SettingOverrideEditor } from './SettingOverrideEditor';
import type { SettingOverrideUpdateDraft } from './useSettings';

export function CheckoutPage({
  workspace,
  onUpdate,
  updating,
}: {
  workspace: AdminSettingsWorkspace;
  onUpdate(draft: SettingOverrideUpdateDraft): void | Promise<void>;
  updating: boolean;
}) {
  return (
    <section className="admin-settings-section" aria-labelledby="settings-checkout-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Published checkout rules</p>
          <h2 id="settings-checkout-title">Checkout</h2>
        </div>
        <span className="admin-status-pill">v{workspace.settingsVersion}</span>
      </div>

      <p className="admin-field__help">
        Save creates or updates this shop&apos;s override. Publish settings makes the saved rules live
        for future Menu and Operations checkouts.
      </p>

      <div className="admin-settings-grid">
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.minimumOrderMinor"
          label="Minimum order (minor units)"
          kind="integer"
          min={0}
          max={Number.MAX_SAFE_INTEGER}
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.serviceChargeBps"
          label="Service charge (bps)"
          kind="integer"
          min={0}
          max={10_000}
          help="100 basis points = 1%."
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.taxBps"
          label="Tax / VAT (bps)"
          kind="integer"
          min={0}
          max={10_000}
          help="Applied by the trusted checkout pricing boundary; browser totals are estimates only."
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.requireCustomerPhone"
          label="Require customer phone"
          kind="boolean"
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.allowScheduledOrders"
          label="Scheduled orders"
          kind="boolean"
          updating={updating}
          onUpdate={onUpdate}
        />
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
