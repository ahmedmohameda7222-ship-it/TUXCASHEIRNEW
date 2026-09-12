import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminSettingsWorkspace,
  CanonicalSettingsRowEditResult,
  OrderTypeEditInput,
  PaymentMethodEditInput,
  SettingsCommand,
  SettingsPublishResult,
  SettingWriteResult,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class SettingsUiError extends Error {
  constructor(
    readonly code: string,
    readonly currentVersion?: number,
  ) {
    super(code);
    this.name = 'SettingsUiError';
  }
}

export type OrderTypeUpdateDraft = Omit<
  OrderTypeEditInput,
  'shopId' | 'expectedSettingsVersion' | 'expectedEditVersion'
>;

export type PaymentMethodUpdateDraft = Omit<
  PaymentMethodEditInput,
  'shopId' | 'expectedSettingsVersion' | 'expectedEditVersion'
>;

export type SettingOverrideUpdateDraft = {
  settingKey: string;
  value: unknown;
};

type OrderTypeUpdateCommand = Extract<SettingsCommand, { type: 'order-type.update' }>;
type PaymentMethodUpdateCommand = Extract<SettingsCommand, { type: 'payment-method.update' }>;
type SettingOverrideUpdateCommand = Extract<SettingsCommand, { type: 'setting.override.upsert' }>;

function settingsQueryKey(shopId: string) {
  return ['admin', 'settings', shopId] as const;
}

function csrfTokenForMutation(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new SettingsUiError('session_required');
  return session.state.session.csrfToken;
}

function requireWorkspaceShop(shopId: string, workspace: AdminSettingsWorkspace): void {
  if (workspace.shop.id !== shopId) throw new SettingsUiError('settings_shop_mismatch');
}

export function buildOrderTypeUpdateCommand(
  shopId: string,
  workspace: AdminSettingsWorkspace,
  draft: OrderTypeUpdateDraft,
): OrderTypeUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  const row = workspace.orderTypes.find((orderType) => orderType.id === draft.orderTypeId);
  if (!row) throw new SettingsUiError('order_type_not_loaded');

  return {
    type: 'order-type.update',
    shopId,
    orderTypeId: draft.orderTypeId,
    name: draft.name,
    behavior: draft.behavior,
    active: draft.active,
    sortOrder: draft.sortOrder,
    expectedSettingsVersion: workspace.settingsVersion,
    expectedEditVersion: row.editVersion,
  };
}

export function buildPaymentMethodUpdateCommand(
  shopId: string,
  workspace: AdminSettingsWorkspace,
  draft: PaymentMethodUpdateDraft,
): PaymentMethodUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  const row = workspace.paymentMethods.find((method) => method.id === draft.paymentMethodId);
  if (!row) throw new SettingsUiError('payment_method_not_loaded');

  return {
    type: 'payment-method.update',
    shopId,
    paymentMethodId: draft.paymentMethodId,
    displayName: draft.displayName,
    active: draft.active,
    sortOrder: draft.sortOrder,
    channel: draft.channel,
    requiresReference: draft.requiresReference,
    manualConfirmationRequired: draft.manualConfirmationRequired,
    refundAllowed: draft.refundAllowed,
    expectedSettingsVersion: workspace.settingsVersion,
    expectedEditVersion: row.editVersion,
  };
}

export function buildSettingOverrideCommand(
  shopId: string,
  workspace: AdminSettingsWorkspace,
  draft: SettingOverrideUpdateDraft,
): SettingOverrideUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  const currentOverride = workspace.shopOverrides.find((row) => row.key === draft.settingKey);
  return {
    type: 'setting.override.upsert',
    shopId,
    settingKey: draft.settingKey,
    value: draft.value,
    expectedVersion: currentOverride?.version ?? null,
  };
}

function requireCanonicalEditSuccess(result: CanonicalSettingsRowEditResult): void {
  if (result.ok) return;
  throw new SettingsUiError(
    result.code,
    'currentVersion' in result ? result.currentVersion : undefined,
  );
}

function requireSettingWriteSuccess(result: SettingWriteResult): void {
  if (result.ok) return;
  throw new SettingsUiError(
    result.code,
    'currentVersion' in result ? result.currentVersion : undefined,
  );
}

export function useSettings(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: shopId ? settingsQueryKey(shopId) : ['admin', 'settings', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      return adminFetch<AdminSettingsWorkspace>(
        `/api/admin/settings?shopId=${encodeURIComponent(shopId)}&view=workspace`,
      );
    },
  });

  function latestWorkspace(): AdminSettingsWorkspace {
    if (!shopId) throw new SettingsUiError('concrete_shop_required');
    const workspace =
      queryClient.getQueryData<AdminSettingsWorkspace>(settingsQueryKey(shopId)) ??
      workspaceQuery.data;
    if (!workspace) throw new SettingsUiError('settings_not_loaded');
    requireWorkspaceShop(shopId, workspace);
    return workspace;
  }

  async function invalidateWorkspace(): Promise<void> {
    if (!shopId) return;
    await queryClient.invalidateQueries({ queryKey: settingsQueryKey(shopId) });
  }

  const publish = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const workspace = latestWorkspace();

      const result = await adminFetch<SettingsPublishResult>(
        '/api/admin/settings',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'settings.publish',
            shopId,
            expectedSettingsVersion: workspace.settingsVersion,
          }),
        },
        csrfTokenForMutation(session),
      );

      if (!result.ok) {
        throw new SettingsUiError(
          result.code,
          'currentVersion' in result ? result.currentVersion : undefined,
        );
      }
    },
    onSuccess: invalidateWorkspace,
  });

  const updateSettingOverride = useMutation({
    mutationFn: async (draft: SettingOverrideUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const command = buildSettingOverrideCommand(shopId, latestWorkspace(), draft);
      const result = await adminFetch<SettingWriteResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(command) },
        csrfTokenForMutation(session),
      );
      requireSettingWriteSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updateOrderType = useMutation({
    mutationFn: async (draft: OrderTypeUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const command = buildOrderTypeUpdateCommand(shopId, latestWorkspace(), draft);
      const result = await adminFetch<CanonicalSettingsRowEditResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(command) },
        csrfTokenForMutation(session),
      );
      requireCanonicalEditSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updatePaymentMethod = useMutation({
    mutationFn: async (draft: PaymentMethodUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const command = buildPaymentMethodUpdateCommand(shopId, latestWorkspace(), draft);
      const result = await adminFetch<CanonicalSettingsRowEditResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(command) },
        csrfTokenForMutation(session),
      );
      requireCanonicalEditSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  return {
    workspaceQuery,
    publish,
    updateSettingOverride,
    updateOrderType,
    updatePaymentMethod,
  };
}
