import type {
  AdminSettingsWorkspace,
  PaymentMethodCreateResult,
  PaymentMethodUpdateResult,
  SettingsPublishApprovalResult,
} from '@tux/admin-contracts';
import { useState } from 'react';
import { useLocation } from 'wouter';

import { PageScaffold } from '../components/layout/PageScaffold';
import { ConfirmationDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { BusinessDefaultsPage } from './BusinessDefaultsPage';
import { CreateShopPanel } from './CreateShopPanel';
import { CheckoutPage } from './CheckoutPage';
import { OrderTypesPage } from './OrderTypesPage';
import { PaymentsPage } from './PaymentsPage';
import { ReasonCodesPage } from './ReasonCodesPage';
import { ReceiptsPage } from './ReceiptsPage';
import { SettingsScheduleActionProvider } from './SettingsSchedulePanel';
import { ShopCopyPreviewPanel } from './ShopCopyPreviewPanel';
import { ShopsPage } from './ShopsPage';
import './settings.css';
import {
  useSettings,
  type OrderTypeCreateDraft,
  type OrderTypeUpdateDraft,
  type PaymentMethodCreateDraft,
  type PaymentMethodUpdateDraft,
  type ReasonCodeUpdateDraft,
  type SettingOverrideUpdateDraft,
  type SettingRestoreDraft,
  type ShopIdentityUpdateDraft,
  type ShopLifecycleUpdateDraft,
  type ShopOperationalStateUpdateDraft,
  type ShopSpecialHoursUpdateDraft,
  type ShopWeeklyHoursUpdateDraft,
} from './useSettings';

export type SettingsSection =
  | 'overview'
  | 'shop'
  | 'business-defaults'
  | 'order-types'
  | 'payments'
  | 'checkout'
  | 'receipts'
  | 'reason-codes';

export type SettingsWorkspaceViewProps = {
  workspace: AdminSettingsWorkspace;
  section: SettingsSection;
  canAssignStaff?: boolean;
  canCreateShop?: boolean;
  shopCopySourceIds?: readonly string[];
  canManageShopLifecycle?: boolean;
  onUpdateShopLifecycle?: (draft: ShopLifecycleUpdateDraft) => void | Promise<void>;
  shopLifecycleUpdating?: boolean;
  shopLifecycleApprovalPending?: boolean;
  canManageBusinessDefaults?: boolean;
  canManagePaymentZones?: boolean;
  onUpdateBusinessDefault?: (draft: SettingOverrideUpdateDraft) => void | Promise<void>;
  businessDefaultUpdating?: boolean;
  onSectionChange(section: SettingsSection): void;
  onPublish(
    requesterPin?: string,
  ): void | SettingsPublishApprovalResult | Promise<void | SettingsPublishApprovalResult>;
  publishing: boolean;
  onUpdateOperationalState(draft: ShopOperationalStateUpdateDraft): void | Promise<void>;
  operationalStateUpdating: boolean;
  onUpdateShopIdentity(draft: ShopIdentityUpdateDraft): void | Promise<void>;
  onUpsertWeeklyHours(draft: ShopWeeklyHoursUpdateDraft): void | Promise<void>;
  onUpsertSpecialHours(draft: ShopSpecialHoursUpdateDraft): void | Promise<void>;
  shopManagementUpdating: boolean;
  onDeleteOrArchiveShop(): void | Promise<void>;
  deletingOrArchivingShop: boolean;
  onUpdateSettingOverride(draft: SettingOverrideUpdateDraft): void | Promise<void>;
  onRestoreSettingOverride?: (draft: SettingRestoreDraft) => void | Promise<void>;
  settingOverrideUpdating: boolean;
  onUpsertReasonCode(draft: ReasonCodeUpdateDraft): void | Promise<void>;
  reasonCodeUpdating: boolean;
  onCreateOrderType(draft: OrderTypeCreateDraft): void | Promise<void>;
  onUpdateOrderType(draft: OrderTypeUpdateDraft): void | Promise<void>;
  orderTypeUpdating: boolean;
  onCreatePaymentMethod(
    draft: PaymentMethodCreateDraft,
  ): void | PaymentMethodCreateResult | Promise<void | PaymentMethodCreateResult>;
  onUpdatePaymentMethod(
    draft: PaymentMethodUpdateDraft,
  ): void | PaymentMethodUpdateResult | Promise<void | PaymentMethodUpdateResult>;
  paymentMethodUpdating: boolean;
};

const sections: readonly { id: SettingsSection; label: string }[] = [
  { id: 'shop', label: 'Shop' },
  { id: 'business-defaults', label: 'Business defaults' },
  { id: 'order-types', label: 'Order types' },
  { id: 'payments', label: 'Payments' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'reason-codes', label: 'Reason codes' },
];

const settingsSectionIds = new Set<SettingsSection>([
  'shop',
  'business-defaults',
  'order-types',
  'payments',
  'checkout',
  'receipts',
  'reason-codes',
]);

export function settingsSectionForLocation(location: string): SettingsSection {
  if (location === '/settings' || location === '/settings/') return 'overview';
  if (!location.startsWith('/settings/')) return 'overview';
  const candidate = location.slice('/settings/'.length).split('/')[0] as SettingsSection;
  return settingsSectionIds.has(candidate) ? candidate : 'overview';
}

export function settingsLocationForSection(section: SettingsSection): string {
  return section === 'overview' ? '/settings' : `/settings/${section}`;
}

function effectiveSetting(workspace: AdminSettingsWorkspace, key: string): unknown {
  return (
    workspace.shopOverrides.find((setting) => setting.key === key)?.value ??
    workspace.businessDefaults.find((setting) => setting.key === key)?.value ??
    null
  );
}

function Overview({ workspace }: { workspace: AdminSettingsWorkspace }) {
  const receiptPrefix = effectiveSetting(workspace, 'receipt.orderPrefix');
  const firstActiveReason = workspace.reasonCodes.find((reason) => reason.active);
  return (
    <div className="admin-settings-overview">
      <section className="admin-form-section" aria-labelledby="settings-shop-summary">
        <p className="admin-catalog-editor__eyebrow">Shop</p>
        <h2 id="settings-shop-summary">Shop identity</h2>
        <p className="admin-field__help">
          {workspace.shop.name} · {workspace.shop.address ?? 'No address configured'} ·{' '}
          {workspace.shop.timezone}
        </p>
      </section>
      <section
        className="admin-form-section"
        aria-labelledby="settings-operations-summary"
      >
        <p className="admin-catalog-editor__eyebrow">Operations</p>
        <h2 id="settings-operations-summary">Order setup</h2>
        <p className="admin-field__help">
          {workspace.orderTypes.length} order types · {workspace.paymentMethods.length} payment
          methods · {workspace.deliveryZones.length} delivery zones
        </p>
      </section>
      <section className="admin-form-section" aria-labelledby="settings-live-summary">
        <p className="admin-catalog-editor__eyebrow">Live controls</p>
        <h2 id="settings-live-summary">Receipt and reason settings</h2>
        <p className="admin-field__help">
          Receipt prefix: {receiptPrefix === null ? 'Not configured' : String(receiptPrefix)}
        </p>
        <p className="admin-field__help">
          {firstActiveReason?.label ?? 'No active reason codes configured'}
        </p>
      </section>
    </div>
  );
}

function SectionContent(
  props: Omit<SettingsWorkspaceViewProps, 'onSectionChange' | 'onPublish' | 'publishing'>,
) {
  const {
    section,
    workspace,
    onUpdateOperationalState,
    operationalStateUpdating,
    onUpdateShopIdentity,
    onUpsertWeeklyHours,
    onUpsertSpecialHours,
    shopManagementUpdating,
    canAssignStaff,
    canCreateShop,
    shopCopySourceIds,
    canManageShopLifecycle,
    onUpdateShopLifecycle,
    shopLifecycleUpdating,
    shopLifecycleApprovalPending,
    canManageBusinessDefaults,
    canManagePaymentZones,
    onUpdateBusinessDefault,
    businessDefaultUpdating,
    onDeleteOrArchiveShop,
    deletingOrArchivingShop,
    onUpdateSettingOverride,
    onRestoreSettingOverride,
    settingOverrideUpdating,
    onUpsertReasonCode,
    reasonCodeUpdating,
    onCreateOrderType,
    onUpdateOrderType,
    orderTypeUpdating,
    onCreatePaymentMethod,
    onUpdatePaymentMethod,
    paymentMethodUpdating,
  } = props;
  switch (section) {
    case 'overview':
      return <Overview workspace={workspace} />;
    case 'shop':
      return (
        <>
          {canCreateShop ? <CreateShopPanel contextShopId={workspace.shop.id} /> : null}
          {shopCopySourceIds && shopCopySourceIds.length > 0 ? (
            <ShopCopyPreviewPanel
              key={`${workspace.shop.id}:${workspace.settingsVersion}`}
              targetShopId={workspace.shop.id}
              expectedTargetSettingsVersion={workspace.settingsVersion}
              sourceShopIds={shopCopySourceIds}
            />
          ) : null}
          <ShopsPage
            workspace={workspace}
            canAssignStaff={canAssignStaff === true}
            canManageLifecycle={canManageShopLifecycle === true}
            onUpdateLifecycle={onUpdateShopLifecycle}
            lifecycleUpdating={shopLifecycleUpdating === true}
            lifecycleApprovalPending={shopLifecycleApprovalPending === true}
            onUpdateOperationalState={(draft) => void onUpdateOperationalState(draft)}
            onUpdateIdentity={onUpdateShopIdentity}
            onUpsertWeeklyHours={onUpsertWeeklyHours}
            onUpsertSpecialHours={onUpsertSpecialHours}
            {...(canManageShopLifecycle === true
              ? { onDeleteOrArchive: () => void onDeleteOrArchiveShop() }
              : {})}
            busy={operationalStateUpdating || shopManagementUpdating || deletingOrArchivingShop}
          />
        </>
      );
    case 'business-defaults':
      return canManageBusinessDefaults && onUpdateBusinessDefault ? (
        <BusinessDefaultsPage
          workspace={workspace}
          onUpdate={onUpdateBusinessDefault}
          updating={businessDefaultUpdating === true}
        />
      ) : (
        <p role="alert">Business defaults require business-wide settings management access.</p>
      );
    case 'order-types':
      return (
        <OrderTypesPage
          workspace={workspace}
          onUpdate={onUpdateOrderType}
          onCreate={onCreateOrderType}
          updating={orderTypeUpdating}
        />
      );
    case 'payments':
      return (
        <PaymentsPage
          workspace={workspace}
          onCreate={onCreatePaymentMethod}
          onUpdate={onUpdatePaymentMethod}
          updating={paymentMethodUpdating}
        />
      );
    case 'checkout':
      return (
        <CheckoutPage
          workspace={workspace}
          canManagePaymentZones={canManagePaymentZones === true}
          onUpdate={onUpdateSettingOverride}
          onRestore={onRestoreSettingOverride}
          updating={settingOverrideUpdating}
        />
      );
    case 'receipts':
      return (
        <ReceiptsPage
          workspace={workspace}
          onUpdate={onUpdateSettingOverride}
          onRestore={onRestoreSettingOverride}
          updating={settingOverrideUpdating}
        />
      );
    case 'reason-codes':
      return (
        <ReasonCodesPage
          workspace={workspace}
          onUpsert={onUpsertReasonCode}
          updating={reasonCodeUpdating}
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
  ...sectionProps
}: SettingsWorkspaceViewProps) {
  const [publishPin, setPublishPin] = useState('');
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  async function publish() {
    setPublishFeedback(null);
    try {
      const result = await onPublish(publishPin || undefined);
      setPublishPin('');
      if (result && 'state' in result && result.state === 'PENDING_APPROVAL') {
        setPublishFeedback(
          'Checkout rate publication requested. A second person must approve before the settings are published.',
        );
      } else {
        setPublishFeedback('Settings published.');
      }
    } catch (cause) {
      setPublishFeedback(cause instanceof Error ? cause.message : 'Unable to publish settings.');
    }
  }
  return (
    <main className="admin-settings-workspace" data-settings-version={workspace.settingsVersion}>
      <header className="admin-settings-workspace__header">
        <div>
          <p className="admin-catalog-editor__eyebrow">Settings</p>
          <h1>{workspace.shop.name}</h1>
          <p className="admin-field__help">Shop settings and operational controls</p>
        </div>
        <div className="admin-settings-workspace__publish">
          <label className="admin-field">
            <span>Requester PIN (if required for approval)</span>
            <input
              type="password"
              autoComplete="off"
              maxLength={64}
              value={publishPin}
              disabled={publishing}
              onChange={(event) => setPublishPin(event.currentTarget.value)}
            />
          </label>
          <button
            className="admin-primary-button"
            type="button"
            disabled={publishing}
            onClick={() => void publish()}
          >
            {publishing ? 'Publishing…' : 'Publish settings'}
          </button>
          {publishFeedback ? <p role="status">{publishFeedback}</p> : null}
          <p className="admin-field__help">
            Configuration edits publish here. Emergency shop controls publish immediately.
          </p>
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
        {sections
          .filter(
            (item) => item.id !== 'business-defaults' || sectionProps.canManageBusinessDefaults,
          )
          .map((item) => (
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
      <SectionContent section={section} workspace={workspace} {...sectionProps} />
    </main>
  );
}

export function SettingsPage() {
  const { scope, principal } = useShopScope();
  const [location, navigate] = useLocation();
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const section = settingsSectionForLocation(location);
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const settings = useSettings(shopId, section === 'shop');

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Settings"
        title="Select a shop"
        description="Select one shop before changing its settings."
      />
    );
  }
  if (settings.workspaceQuery.isPending) {
    return (
      <PageScaffold
        eyebrow="Settings"
        title="Loading settings"
        description="Loading this shop's current settings."
      />
    );
  }
  if (settings.workspaceQuery.isError || !settings.workspaceQuery.data) {
    return (
      <PageScaffold
        eyebrow="Settings"
        title="Settings unavailable"
        description="The settings workspace could not be loaded."
      />
    );
  }

  const canManageBusinessDefaults =
    (principal.role === 'OWNER' || principal.role === 'ADMIN') &&
    principal.permissions.includes('settings.manage');
  const workspace = {
    ...settings.workspaceQuery.data,
    shopConfigSchedules: settings.schedulesQuery.data?.schedules ?? [],
  };

  return (
    <>
      <SettingsScheduleActionProvider
        action={{
          schedule: (draft) => settings.scheduleSettingsChange.mutateAsync(draft),
          busy: settings.scheduleSettingsChange.isPending,
          historyLoading: settings.schedulesQuery.isPending,
          historyError: settings.schedulesQuery.isError,
          retryHistory: () => void settings.schedulesQuery.refetch(),
        }}
      >
        <SettingsWorkspaceView
          workspace={workspace}
          section={section}
          canAssignStaff={
            principal.permissions.includes('staff.manage') &&
            principal.permissions.includes('staff.view')
          }
          canManageShopLifecycle={principal.permissions.includes('shops.manage')}
          shopCopySourceIds={
            principal.permissions.includes('settings.manage')
              ? principal.shopIds.filter((id) => id !== workspace.shop.id)
              : []
          }
          canCreateShop={
            (principal.role === 'OWNER' || principal.role === 'ADMIN') &&
            principal.permissions.includes('shops.manage')
          }
          onUpdateShopLifecycle={(draft) =>
            settings.updateShopLifecycle.mutateAsync(draft).then(() => {})
          }
          shopLifecycleApprovalPending={
            settings.updateShopLifecycle.data?.ok === true &&
            'state' in settings.updateShopLifecycle.data &&
            settings.updateShopLifecycle.data.state === 'PENDING_APPROVAL'
          }
          shopLifecycleUpdating={settings.updateShopLifecycle.isPending}
          canManageBusinessDefaults={canManageBusinessDefaults}
          canManagePaymentZones={principal.permissions.includes('settings.manage')}
          onUpdateBusinessDefault={(draft) => settings.updateBusinessDefault.mutateAsync(draft)}
          businessDefaultUpdating={settings.updateBusinessDefault.isPending}
          onSectionChange={(nextSection) => navigate(settingsLocationForSection(nextSection))}
          onPublish={(pin) => settings.publish.mutateAsync(pin)}
          publishing={settings.publish.isPending}
          onUpdateOperationalState={(draft) => settings.updateOperationalState.mutateAsync(draft)}
          operationalStateUpdating={settings.updateOperationalState.isPending}
          onUpdateShopIdentity={(draft) => settings.updateShopIdentity.mutateAsync(draft)}
          onUpsertWeeklyHours={(draft) => settings.upsertWeeklyHours.mutateAsync(draft)}
          onUpsertSpecialHours={(draft) => settings.upsertSpecialHours.mutateAsync(draft)}
          shopManagementUpdating={
            settings.updateShopIdentity.isPending ||
            settings.upsertWeeklyHours.isPending ||
            settings.upsertSpecialHours.isPending
          }
          onDeleteOrArchiveShop={() => setArchiveConfirmOpen(true)}
          deletingOrArchivingShop={settings.deleteOrArchiveShop.isPending}
          onUpdateSettingOverride={(draft) => settings.updateSettingOverride.mutateAsync(draft)}
          onRestoreSettingOverride={(draft) => settings.restoreSettingOverride.mutateAsync(draft)}
          settingOverrideUpdating={settings.updateSettingOverride.isPending}
          onUpsertReasonCode={(draft) => settings.upsertReasonCode.mutateAsync(draft)}
          reasonCodeUpdating={settings.upsertReasonCode.isPending}
          onCreateOrderType={(draft) => settings.createOrderType.mutateAsync(draft)}
          onUpdateOrderType={(draft) => settings.updateOrderType.mutateAsync(draft)}
          orderTypeUpdating={
            settings.updateOrderType.isPending || settings.createOrderType.isPending
          }
          onCreatePaymentMethod={(draft) => settings.createPaymentMethod.mutateAsync(draft)}
          onUpdatePaymentMethod={(draft) => settings.updatePaymentMethod.mutateAsync(draft)}
          paymentMethodUpdating={
            settings.updatePaymentMethod.isPending || settings.createPaymentMethod.isPending
          }
        />
      </SettingsScheduleActionProvider>
      <ConfirmationDialog
        open={archiveConfirmOpen}
        title={`Delete unused shop ${workspace.shop.name}?`}
        description="Only unused shops can be deleted here. To archive a used shop, use the approval-aware Archive shop control in Shop lifecycle."
        confirmLabel="Delete unused shop"
        destructive
        pending={settings.deleteOrArchiveShop.isPending}
        onOpenChange={setArchiveConfirmOpen}
        onConfirm={async () => {
          await settings.deleteOrArchiveShop.mutateAsync();
          setArchiveConfirmOpen(false);
        }}
      />
    </>
  );
}
