import type {
  AdminSettingValue,
  AdminSettingsWorkspace,
  ResolvedSetting,
} from '@tux/admin-contracts';

function resolveSetting(workspace: AdminSettingsWorkspace, key: string): ResolvedSetting {
  const shopOverride = workspace.shopOverrides.find((setting) => setting.key === key);
  if (shopOverride !== undefined) return { source: 'shop', value: shopOverride.value };

  const businessDefault = workspace.businessDefaults.find((setting) => setting.key === key);
  if (businessDefault !== undefined) return { source: 'business', value: businessDefault.value };

  return { source: 'unset', value: null };
}

function sourceLabel(source: ResolvedSetting['source']): string {
  switch (source) {
    case 'shop':
      return 'Shop override';
    case 'business':
      return 'Business default';
    case 'unset':
      return 'Not configured';
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not configured';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function settingVersion(settings: readonly AdminSettingValue[], key: string): number | null {
  return settings.find((setting) => setting.key === key)?.version ?? null;
}

function ReceiptSetting({
  workspace,
  settingKey,
  label,
}: {
  workspace: AdminSettingsWorkspace;
  settingKey: string;
  label: string;
}) {
  const resolved = resolveSetting(workspace, settingKey);
  const version =
    resolved.source === 'shop'
      ? settingVersion(workspace.shopOverrides, settingKey)
      : resolved.source === 'business'
        ? settingVersion(workspace.businessDefaults, settingKey)
        : null;

  return (
    <article className="admin-catalog-editor__section is-compact" data-setting-key={settingKey}>
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">{sourceLabel(resolved.source)}</p>
          <h3>{label}</h3>
        </div>
        {version === null ? null : <span className="admin-status-pill">v{version}</span>}
      </div>
      <p>{displayValue(resolved.value)}</p>
    </article>
  );
}

export function ReceiptsPage({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <section className="admin-settings-receipts" aria-labelledby="settings-receipts-heading">
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Receipts</p>
          <h2 id="settings-receipts-heading">Receipt identity and numbering</h2>
        </div>
      </div>
      <p className="admin-field__help">
        Effective values resolve the shop override first, then the business default. The source
        layer remains visible for every value.
      </p>
      <div className="admin-settings-receipts__grid">
        <ReceiptSetting
          workspace={workspace}
          settingKey="receipt.orderPrefix"
          label="Order prefix"
        />
        <ReceiptSetting workspace={workspace} settingKey="receipt.footer" label="Receipt footer" />
        <ReceiptSetting
          workspace={workspace}
          settingKey="receipt.sequenceStart"
          label="Sequence start"
        />
        <ReceiptSetting
          workspace={workspace}
          settingKey="receipt.sequenceResetPolicy"
          label="Sequence reset policy"
        />
      </div>
    </section>
  );
}
