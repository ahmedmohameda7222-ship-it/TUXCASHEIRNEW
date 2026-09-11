import type { DeliveryZoneId, PaymentMethodId, ShopId } from './ids';
import type { JsonValue } from './json';

export type PaymentMethodChannel = 'POS' | 'ONLINE' | 'BOTH';
export type ShopLifecycleState = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type SettingsHoursServiceKind = 'OPEN' | 'DELIVERY' | 'ONLINE';
export type ConfiguredReasonFamily =
  | 'CANCELLATION'
  | 'REFUND_RETURN'
  | 'DISCOUNT_COMP'
  | 'WASTE'
  | 'STOCK_ADJUSTMENT'
  | 'CASH_VARIANCE'
  | 'PAY_IN'
  | 'PAY_OUT';

export interface OperationsShopIdentitySettings {
  readonly shopId: ShopId;
  readonly displayName: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: 'Africa/Cairo';
  readonly lifecycleState: ShopLifecycleState;
  readonly temporaryClosed: boolean;
  readonly onlineOrdersPaused: boolean;
}

export interface OperationsWeeklyHoursSetting {
  readonly id: string;
  readonly serviceKind: SettingsHoursServiceKind;
  readonly dayOfWeek: number;
  readonly timezone: 'Africa/Cairo';
  readonly opensLocal: string;
  readonly closesLocal: string;
  readonly active: boolean;
}

export interface OperationsSpecialHoursSetting {
  readonly id: string;
  readonly serviceDate: string;
  readonly serviceKind: SettingsHoursServiceKind;
  readonly timezone: 'Africa/Cairo';
  readonly closed: boolean;
  readonly opensLocal: string | null;
  readonly closesLocal: string | null;
  readonly note: string | null;
}

export interface PaymentMethodZoneRuleSetting {
  readonly paymentMethodId: PaymentMethodId;
  readonly deliveryZoneId: DeliveryZoneId;
  readonly allowed: boolean;
}

export interface OperationsPublishedSettings {
  readonly version: number;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly shopIdentity: OperationsShopIdentitySettings;
  readonly weeklyHours: readonly OperationsWeeklyHoursSetting[];
  readonly specialHours: readonly OperationsSpecialHoursSetting[];
  readonly paymentMethodZoneRules: readonly PaymentMethodZoneRuleSetting[];
}

export interface ConfiguredReasonCode {
  readonly id: string;
  readonly key: string;
  readonly family: ConfiguredReasonFamily;
  readonly label: string;
  readonly active: boolean;
  readonly version: number;
  readonly scope: 'BUSINESS' | 'SHOP';
}
