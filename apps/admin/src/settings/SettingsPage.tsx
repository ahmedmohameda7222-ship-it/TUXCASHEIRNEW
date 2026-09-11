import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { ReasonCodesPage } from './ReasonCodesPage';
import { ReceiptsPage } from './ReceiptsPage';

export type SettingsSection =
  | 'overview'
  | 'shop'
  | 'order-types'
  | 'payments'
  | 'checkout'
  | 'receipts'
  | 'reason-codes';

export type SettingsWorkspaceViewProps = {
  workspace: AdminSettingsWorkspace;
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
  onPublish(): void | Promise<void>;
  publishing: boolean;
};

const sections: readonly { id: SettingsSection; label: string }[] = [
  { id: 'shop', label: 'Shop' },
  { id: 'order-types', label: 'Order types' },
  { id: 'payments', label: 'Payments' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'reason-codes', label: 'Reason codes' },
];

function Overview({ workspace }: { workspace: AdminSettingsWorkspace }) {
  return (
    <div className="admin-settings-overview">
      <section className="admin-catalog-editor__section" aria-labelledby="settings-shop-summary">
        <p className="admin-catalog-editor__eyebrow">Shop</p>
        <h2 id="settings-shop-summary">{workspace.shop.name}</h2>
        <p className="admin-field__help">
          {workspace.shop.address ?? 'No address configured'} · {workspace.shop.timezone}
        </p>
      </section>

      <section className="admin-catalog-editor__section" aria-labelledby="settings-operations-summary">
        <p className="admin-catalog-editor__eyebrow">Operations</p>
        <h2 id="settings-operations-summary">Published configuration</h2>
        <p className="admin-field__help">
          {workspace.orderTypes.length} order types · {workspace.paymentMethods.length} payment methods ·{' '}
          {workspace.deliveryZones.length} delivery zones
        </p>
      </section>
    </div>
  );
}

function PlaceholderSection({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="admin-catalog-editor__section">
      <p className="admin-catalog-editor__eyebrow">Settings</p>
      <h2>{title}</h2>
      <p className="admin-field__help">{detail}</p>
    </section>
  );
}

function SectionContent({
  section,
  workspace,
}: {
  section: SettingsSection;
  workspace: AdminSettingsWorkspace;
}) {
  switch (section) {
    case 'overview':
      return <Overview workspace={workspace} />;
    case 'receipts':
      return <ReceiptsPage workspace={workspace} />;
    case 'reason-codes':
      return <ReasonCodesPage workspace={workspace} />;
    case 'shop':
      return (
        <PlaceholderSection
          title="Shop"
          detail={`${workspace.shop.lifecycleState} · ${workspace.shop.temporaryClosed ? 'Temporarily closed' : 'Open according to schedule'}`}
        />
      );
    case 'order-types':
      return (
        <PlaceholderSection
          title="Order types"
          detail={`${workspace.orderTypes.length} configured order types`}
        />
      );
    case 'payments':
      return (
        <PlaceholderSection
          title="Payments"
          detail={`${workspace.paymentMethods.length} configured payment methods`}
        />
      );
    case 'checkout':
      return (
        <PlaceholderSection
          title="Checkout"
          detail={`${workspace.deliveryZones.length} configured delivery zones`}
        />
      );
  }
}

export function SettingsWorkspaceView({
  workspace,
  section,
  onSectionChange,
  onPublish,
  publishing,
}: SettingsWorkspaceViewProps) {
  return (
    <main className="admin-settings-workspace" data-settings-version={workspace.settingsVersion}>
      <header className="admin-settings-workspace__header">
        <div>
          <p className="admin-catalog-editor__eyebrow">Settings</p>
          <h1>{workspace.shop.name}</h1>
          <p className="admin-field__help">Live settings version {workspace.settingsVersion}</p>
        </div>
        <div>
          <button
            className="admin-primary-button"
            type="button"
            disabled={publishing}
            onClick={() => void onPublish()}
          >
            {publishing ? 'Publishing…' : 'Publish settings'}
          </button>
          <p className="admin-field__help">Changes become live only after publishing.</p>
        </div>
      </header>

      <nav className="admin-settings-workspace__nav" aria-label="Settings sections">
        <button
          type="button"
          aria-current={section === 'overview' ? 'page' : undefined}
          onClick={() => onSectionChange('overview')}
        >
          Overview
        </button>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <SectionContent section={section} workspace={workspace} />
    </main>
  );
}
