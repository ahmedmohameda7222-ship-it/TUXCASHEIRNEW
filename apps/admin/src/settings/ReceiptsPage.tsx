import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { SettingOverrideEditor } from './SettingOverrideEditor';
import { displaySettingValue, resolveWorkspaceSetting, settingSourceLabel } from './settingsModel';
import type { SettingOverrideUpdateDraft } from './useSettings';

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
        Effective values resolve the shop override first, then the business default. Saved changes
        affect future orders only after Publish settings; historical receipt snapshots remain
        unchanged.
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
          max={Number.MAX_SAFE_INTEGER}
          help="The Operations allocator applies sequence changes at a safe business-day boundary."
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
            {resetPolicy.source === 'shop' && resetPolicy.version !== null ? (
              <span className="admin-status-pill">v{resetPolicy.version}</span>
            ) : null}
          </div>
          <p>{displaySettingValue(resetPolicy.value ?? 'BUSINESS_DAY')}</p>
          <p className="admin-field__help">
            Business-day reset is the approved numbering policy and is not changed mid-day.
          </p>
        </article>
      </div>
    </section>
  );
}
