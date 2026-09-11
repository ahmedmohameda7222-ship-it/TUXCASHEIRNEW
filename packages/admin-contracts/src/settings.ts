export const SHOP_LIFECYCLE_STATES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type ShopLifecycleState = (typeof SHOP_LIFECYCLE_STATES)[number];

export const PAYMENT_METHOD_CHANNELS = ['POS', 'ONLINE', 'BOTH'] as const;
export type PaymentMethodChannel = (typeof PAYMENT_METHOD_CHANNELS)[number];

export const ADMIN_REASON_FAMILIES = [
  'CANCELLATION',
  'REFUND_RETURN',
  'DISCOUNT_COMP',
  'WASTE',
  'STOCK_ADJUSTMENT',
  'CASH_VARIANCE',
  'PAY_IN',
  'PAY_OUT',
] as const;
export type AdminReasonFamily = (typeof ADMIN_REASON_FAMILIES)[number];

export const SHOP_HOURS_SERVICE_KINDS = ['OPEN', 'DELIVERY', 'ONLINE'] as const;
export type ShopHoursServiceKind = (typeof SHOP_HOURS_SERVICE_KINDS)[number];

export type SettingsChannelContext = {
  channel: Exclude<PaymentMethodChannel, 'BOTH'>;
};

export type AdminPaymentMethodConfiguration = {
  id: string;
  displayName: string;
  active: boolean;
  channel: PaymentMethodChannel;
};

export type AdminPaymentMethodDetail = AdminPaymentMethodConfiguration & {
  logicType: 'CASH' | 'CARD' | 'DIGITAL' | 'OTHER';
  requiresReconciliation: boolean;
  sortOrder: number;
  requiresReference: boolean;
  manualConfirmationRequired: boolean;
  refundAllowed: boolean;
  integrationReference: string | null;
};

export type AdminShopSettingsSummary = {
  id: string;
  name: string;
  lifecycleState: ShopLifecycleState;
  active: boolean;
  address: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: 'Africa/Cairo';
  temporaryClosed: boolean;
  onlineOrdersPaused: boolean;
};

export type AdminSettingValue = {
  key: string;
  value: unknown;
  version: number;
};

export type AdminOrderTypeConfiguration = {
  id: string;
  name: string;
  behavior: 'TAKE_AWAY' | 'DINE_IN' | 'DELIVERY' | 'OTHER';
  active: boolean;
  sortOrder: number;
};

export type AdminDeliveryZoneConfiguration = {
  id: string;
  name: string;
  feeMinor: number;
  active: boolean;
  sortOrder: number;
};

export type AdminReasonCodeConfiguration = {
  id: string;
  scope: 'BUSINESS' | 'SHOP';
  key: string;
  family: AdminReasonFamily;
  label: string;
  active: boolean;
  version: number;
};

export type AdminWeeklyHoursConfiguration = {
  id: string;
  serviceKind: ShopHoursServiceKind;
  dayOfWeek: number;
  timezone: 'Africa/Cairo';
  opensLocal: string;
  closesLocal: string;
  active: boolean;
};

export type AdminSpecialHoursConfiguration = {
  id: string;
  serviceDate: string;
  serviceKind: ShopHoursServiceKind;
  timezone: 'Africa/Cairo';
  closed: boolean;
  opensLocal: string | null;
  closesLocal: string | null;
  note: string | null;
};

export type AdminSettingsWorkspace = {
  shop: AdminShopSettingsSummary;
  settingsVersion: number;
  businessDefaults: AdminSettingValue[];
  shopOverrides: AdminSettingValue[];
  orderTypes: AdminOrderTypeConfiguration[];
  paymentMethods: AdminPaymentMethodDetail[];
  deliveryZones: AdminDeliveryZoneConfiguration[];
  reasonCodes: AdminReasonCodeConfiguration[];
  weeklyHours: AdminWeeklyHoursConfiguration[];
  specialHours: AdminSpecialHoursConfiguration[];
};

export type ResolvedSetting<T = unknown> =
  | { source: 'shop'; value: T }
  | { source: 'business'; value: T }
  | { source: 'unset'; value: null };

export type ShopDeleteOrArchiveResult =
  { ok: true; action: 'ARCHIVED' } | { ok: true; action: 'DELETED' } | { ok: false; code: string };

export type SettingsPublishResult =
  | {
      ok: true;
      settingsVersion: number;
      operationsConfigurationVersion: number;
    }
  | { ok: false; code: 'stale_settings_version'; currentVersion: number }
  | { ok: false; code: string };

export type SettingWriteResult =
  | { ok: true; version: number }
  | { ok: false; code: 'stale_setting_version'; currentVersion: number }
  | { ok: false; code: string };

export type SettingWriteInput = {
  shopId: string;
  settingKey: string;
  value: unknown;
  expectedVersion: number | null;
};

export type SettingsCommand =
  | ({ type: 'settings.publish' } & {
      shopId: string;
      expectedSettingsVersion: number;
    })
  | ({ type: 'shop.delete-or-archive' } & { shopId: string })
  | ({ type: 'setting.default.upsert' } & SettingWriteInput)
  | ({ type: 'setting.override.upsert' } & SettingWriteInput);
