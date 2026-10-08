import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { SettingOverrideEditor } from './SettingOverrideEditor';
import { displaySettingValue, resolveWorkspaceSetting, settingSourceLabel } from './settingsModel';
import type { SettingOverrideUpdateDraft } from './useSettings';

const RECEIPT_SEQUENCE_MAX = 2_147_483_647;

export function ReceiptsPage({
  workspace,
  onUpdate,
  updating,
}: {
  workspace: AdminSettingsWorkspace;
  onUpdate(draft: SettingOverrideUpdateDraft): void | Promise<void>;
  updating: boolean;
}) {
  const resetPolicy = resolveWorkspaceSetting(workspace, 'receipt.sequenceResetPolicy');

  return (
    <section className="admin-settings-receipts" aria-labelledby="settings-receipts-heading">
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Receipts</p>
          <h2 id="settings-receipts-heading">Receipt identity and numbering</h2>
        </div>
      </div>
      <p className="admin-field__help">
        Update how future receipts look and number orders. Existing receipts stay unchanged.
      </p>

      <div className="admin-settings-receipts__grid">
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="receipt.orderPrefix"
          label="Order prefix"
          kind="text"
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="receipt.footer"
          label="Receipt footer"
          kind="text"
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="receipt.sequenceStart"
          label="Sequence start"
          kind="integer"
          min={1}
          max={RECEIPT_SEQUENCE_MAX}
          help="A new starting number takes effect at the next business-day boundary."
          updating={updating}
          onUpdate={onUpdate}
        />
        <article
          className="admin-catalog-editor__section is-compact"
          data-setting-key="receipt.sequenceResetPolicy"
        >
          <div className="admin-catalog-editor__section-heading">
            <div>
              <p className="admin-catalog-editor__eyebrow">
                {settingSourceLabel(resetPolicy.source)}
              </p>
              <h3>Sequence reset policy</h3>
            </div>
          </div>
          <p>{displaySettingValue(resetPolicy.value ?? 'BUSINESS_DAY')}</p>
          <p className="admin-field__help">
            Receipt numbering restarts at the beginning of each business day.
          </p>
        </article>
      </div>
    </section>
  );
}
