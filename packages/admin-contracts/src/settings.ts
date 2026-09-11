export const SHOP_LIFECYCLE_STATES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type ShopLifecycleState = (typeof SHOP_LIFECYCLE_STATES)[number];

export const PAYMENT_METHOD_CHANNELS = ['POS', 'ONLINE', 'BOTH'] as const;
export type PaymentMethodChannel = (typeof PAYMENT_METHOD_CHANNELS)[number];

export type SettingsChannelContext = {
  channel: Exclude<PaymentMethodChannel, 'BOTH'>;
};

export type AdminPaymentMethodConfiguration = {
  id: string;
  displayName: string;
  active: boolean;
  channel: PaymentMethodChannel;
};

export type ResolvedSetting<T = unknown> =
  | { source: 'shop'; value: T }
  | { source: 'business'; value: T }
  | { source: 'unset'; value: null };

export type ShopDeleteOrArchiveResult =
  | { ok: true; action: 'ARCHIVED' }
  | { ok: true; action: 'DELETED' };
