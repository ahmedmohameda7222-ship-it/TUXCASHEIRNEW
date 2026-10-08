import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { SettingOverrideEditor } from './SettingOverrideEditor';
import {
  formatBasisPointsAsPercent,
  formatMinorAsEgp,
  parseEgpToMinor,
  parsePercentToBasisPoints,
} from './settingsModel';
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
          <p className="admin-settings-kicker">Order totals and requirements</p>
          <h2 id="settings-checkout-title">Checkout</h2>
        </div>
      </div>

      <p className="admin-field__help">
        Save each change, then publish settings when you are ready to use it for future orders.
      </p>

      <div className="admin-settings-grid">
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.minimumOrderMinor"
          label="Minimum order (EGP)"
          kind="integer"
          min={0}
          step={0.01}
          inputMode="decimal"
          formatValue={formatMinorAsEgp}
          parseInput={parseEgpToMinor}
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.serviceChargeBps"
          label="Service charge (%)"
          kind="integer"
          min={0}
          max={100}
          step={0.01}
          inputMode="decimal"
          formatValue={formatBasisPointsAsPercent}
          parseInput={parsePercentToBasisPoints}
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.taxBps"
          label="Tax / VAT (%)"
          kind="integer"
          min={0}
          max={100}
          step={0.01}
          inputMode="decimal"
          formatValue={formatBasisPointsAsPercent}
          parseInput={parsePercentToBasisPoints}
          help="Used for future order totals after settings are published."
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
          settingKey="checkout.allowDiscountStacking"
          label="Allow discount stacking"
          kind="boolean"
          help="Applies to future orders; existing orders keep their original total."
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.allowDeliveryFeeOverride"
          label="Allow delivery fee override"
          kind="boolean"
          help="When off, delivery orders use the configured zone fee."
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
                  <span>{zone.active ? 'Available for delivery' : 'Not currently available'}</span>
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
