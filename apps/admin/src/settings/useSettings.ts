import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminSettingsWorkspace,
  CanonicalSettingsRowEditResult,
  OrderTypeEditInput,
  PaymentMethodEditInput,
  ReasonCodeWriteInput,
  ReasonCodeWriteResult,
  SettingWriteResult,
  SettingsCommand,
  SettingsPublishResult,
  ShopDeleteOrArchiveResult,
  ShopIdentityUpdateInput,
  ShopManagementWriteResult,
  ShopOperationalStateUpdateInput,
  ShopSpecialHoursUpsertInput,
  ShopWeeklyHoursUpsertInput,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class SettingsUiError extends Error {
  constructor(readonly code: string, readonly currentVersion?: number) {
    super(code);
    this.name = 'SettingsUiError';
  }
}

export type OrderTypeUpdateDraft = Omit<OrderTypeEditInput, 'shopId'>;
export type PaymentMethodUpdateDraft = Omit<PaymentMethodEditInput, 'shopId'>;
export type ReasonCodeUpdateDraft = Omit<ReasonCodeWriteInput, 'shopId'>;
export type ShopOperationalStateUpdateDraft = Omit<ShopOperationalStateUpdateInput, 'shopId'>;
export type ShopIdentityUpdateDraft = Omit<ShopIdentityUpdateInput, 'shopId'>;
export type ShopWeeklyHoursUpdateDraft = Omit<ShopWeeklyHoursUpsertInput, 'shopId'>;
export type ShopSpecialHoursUpdateDraft = Omit<ShopSpecialHoursUpsertInput, 'shopId'>;
export type SettingOverrideUpdateDraft = { settingKey: string; value: unknown; expectedVersion: number | null };

type OrderTypeUpdateCommand = Extract<SettingsCommand, { type: 'order-type.update' }>;
type PaymentMethodUpdateCommand = Extract<SettingsCommand, { type: 'payment-method.update' }>;
type SettingOverrideUpdateCommand = Extract<SettingsCommand, { type: 'setting.override.upsert' }>;

function settingsQueryKey(shopId: string) { return ['admin', 'settings', shopId] as const; }
function csrfTokenForMutation(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new SettingsUiError('session_required');
  return session.state.session.csrfToken;
}
function requireWorkspaceShop(shopId: string, workspace: AdminSettingsWorkspace): void {
  if (workspace.shop.id !== shopId) throw new SettingsUiError('settings_shop_mismatch');
}

export function buildOrderTypeUpdateCommand(shopId: string, workspace: AdminSettingsWorkspace, draft: OrderTypeUpdateDraft): OrderTypeUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  if (!workspace.orderTypes.some((row) => row.id === draft.orderTypeId)) throw new SettingsUiError('order_type_not_loaded');
  return { type: 'order-type.update', shopId, ...draft };
}

export function buildPaymentMethodUpdateCommand(shopId: string, workspace: AdminSettingsWorkspace, draft: PaymentMethodUpdateDraft): PaymentMethodUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  const row = workspace.paymentMethods.find((method) => method.id === draft.paymentMethodId);
  if (!row) throw new SettingsUiError('payment_method_not_loaded');
  // refundAllowed is an approved canonical policy but is deliberately preserved, not edited,
  // until the trusted refund boundary consumes the transaction's immutable payment snapshot.
  return { type: 'payment-method.update', shopId, ...draft, refundAllowed: row.refundAllowed };
}

export function buildSettingOverrideCommand(shopId: string, workspace: AdminSettingsWorkspace, draft: SettingOverrideUpdateDraft): SettingOverrideUpdateCommand {
  requireWorkspaceShop(shopId, workspace);
  return { type: 'setting.override.upsert', shopId, ...draft };
}

function requireCanonicalEditSuccess(result: CanonicalSettingsRowEditResult): void {
  if (result.ok) return;
  throw new SettingsUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
}
function requireSettingWriteSuccess(result: SettingWriteResult): void {
  if (result.ok) return;
  throw new SettingsUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
}
function requireReasonCodeWriteSuccess(result: ReasonCodeWriteResult): void {
  if (result.ok) return;
  throw new SettingsUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
}
function requirePublishSuccess(result: SettingsPublishResult): void {
  if (result.ok) return;
  throw new SettingsUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
}
function requireShopManagementSuccess(result: ShopManagementWriteResult): void {
  if (result.ok) return;
  throw new SettingsUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
}

export function useSettings(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: shopId ? settingsQueryKey(shopId) : ['admin', 'settings', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      return adminFetch<AdminSettingsWorkspace>(`/api/admin/settings?shopId=${encodeURIComponent(shopId)}&view=workspace`);
    },
  });

  function latestWorkspace(): AdminSettingsWorkspace {
    if (!shopId) throw new SettingsUiError('concrete_shop_required');
    const workspace = queryClient.getQueryData<AdminSettingsWorkspace>(settingsQueryKey(shopId)) ?? workspaceQuery.data;
    if (!workspace) throw new SettingsUiError('settings_not_loaded');
    requireWorkspaceShop(shopId, workspace);
    return workspace;
  }
  async function invalidateWorkspace(): Promise<void> {
    if (shopId) await queryClient.invalidateQueries({ queryKey: settingsQueryKey(shopId) });
  }
  async function postShopManagement(command: SettingsCommand): Promise<void> {
    const result = await adminFetch<ShopManagementWriteResult>(
      '/api/admin/settings',
      { method: 'POST', body: JSON.stringify(command) },
      csrfTokenForMutation(session),
    );
    requireShopManagementSuccess(result);
  }

  const publish = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<SettingsPublishResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify({ type: 'settings.publish', shopId, expectedSettingsVersion: latestWorkspace().settingsVersion }) },
        csrfTokenForMutation(session),
      );
      requirePublishSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updateOperationalState = useMutation({
    mutationFn: async (draft: ShopOperationalStateUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      requireWorkspaceShop(shopId, latestWorkspace());
      const result = await adminFetch<SettingsPublishResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify({ type: 'shop.operational-state.update', shopId, ...draft }) },
        csrfTokenForMutation(session),
      );
      requirePublishSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updateShopIdentityMutation = useMutation({
    mutationFn: async (draft: ShopIdentityUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      requireWorkspaceShop(shopId, latestWorkspace());
      await postShopManagement({ type: 'shop.identity.update', shopId, ...draft });
    },
    onSuccess: invalidateWorkspace,
  });

  const upsertWeeklyHours = useMutation({
    mutationFn: async (draft: ShopWeeklyHoursUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      requireWorkspaceShop(shopId, latestWorkspace());
      await postShopManagement({ type: 'shop.weekly-hours.upsert', shopId, ...draft });
    },
    onSuccess: invalidateWorkspace,
  });

  const upsertSpecialHours = useMutation({
    mutationFn: async (draft: ShopSpecialHoursUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      requireWorkspaceShop(shopId, latestWorkspace());
      await postShopManagement({ type: 'shop.special-hours.upsert', shopId, ...draft });
    },
    onSuccess: invalidateWorkspace,
  });

  const updateSettingOverride = useMutation({
    mutationFn: async (draft: SettingOverrideUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<SettingWriteResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(buildSettingOverrideCommand(shopId, latestWorkspace(), draft)) },
        csrfTokenForMutation(session),
      );
      requireSettingWriteSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const upsertReasonCode = useMutation({
    mutationFn: async (draft: ReasonCodeUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<ReasonCodeWriteResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify({ type: 'reason-code.upsert', shopId, ...draft }) },
        csrfTokenForMutation(session),
      );
      requireReasonCodeWriteSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updateOrderType = useMutation({
    mutationFn: async (draft: OrderTypeUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<CanonicalSettingsRowEditResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(buildOrderTypeUpdateCommand(shopId, latestWorkspace(), draft)) },
        csrfTokenForMutation(session),
      );
      requireCanonicalEditSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const updatePaymentMethod = useMutation({
    mutationFn: async (draft: PaymentMethodUpdateDraft): Promise<void> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<CanonicalSettingsRowEditResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify(buildPaymentMethodUpdateCommand(shopId, latestWorkspace(), draft)) },
        csrfTokenForMutation(session),
      );
      requireCanonicalEditSuccess(result);
    },
    onSuccess: invalidateWorkspace,
  });

  const deleteOrArchiveShop = useMutation({
    mutationFn: async (): Promise<ShopDeleteOrArchiveResult> => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const result = await adminFetch<ShopDeleteOrArchiveResult>(
        '/api/admin/settings',
        { method: 'POST', body: JSON.stringify({ type: 'shop.delete-or-archive', shopId }) },
        csrfTokenForMutation(session),
      );
      if (!result.ok) throw new SettingsUiError(result.code);
      return result;
    },
    onSuccess: invalidateWorkspace,
  });

  return {
    workspaceQuery,
    publish,
    updateOperationalState,
    updateShopIdentity: updateShopIdentityMutation,
    upsertWeeklyHours,
    upsertSpecialHours,
    updateSettingOverride,
    upsertReasonCode,
    updateOrderType,
    updatePaymentMethod,
    deleteOrArchiveShop,
  };
}