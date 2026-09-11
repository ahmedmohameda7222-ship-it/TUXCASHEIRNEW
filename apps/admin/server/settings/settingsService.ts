import type {
  AdminDeliveryZoneConfiguration,
  AdminOrderTypeConfiguration,
  AdminPaymentMethodConfiguration,
  AdminPaymentMethodDetail,
  AdminReasonCodeConfiguration,
  AdminReasonFamily,
  AdminSessionPrincipal,
  AdminSettingsWorkspace,
  AdminShopSettingsSummary,
  AdminSpecialHoursConfiguration,
  AdminWeeklyHoursConfiguration,
  PaymentMethodChannel,
  ResolvedSetting,
  SettingWriteInput,
  SettingWriteResult,
  SettingsChannelContext,
  SettingsPublishResult,
  ShopDeleteOrArchiveResult,
  ShopHoursServiceKind,
  ShopLifecycleState,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import type { AdminSupabaseClient } from '../supabaseAdmin';

export class SettingsServiceError extends Error {
  constructor(readonly code: 'backend_contract_invalid') {
    super(code);
    this.name = 'SettingsServiceError';
  }
}

export type SettingLayers = {
  businessDefault: unknown | null;
  shopOverride: unknown | null;
};

export interface SettingsStore {
  getSettingLayers(input: {
    businessId: string;
    shopId: string;
    key: string;
  }): Promise<SettingLayers>;
  loadWorkspace(input: { businessId: string; shopId: string }): Promise<AdminSettingsWorkspace>;
  publish(input: {
    employeeId: string;
    shopId: string;
    expectedSettingsVersion: number;
  }): Promise<SettingsPublishResult>;
  deleteOrArchiveShop(input: {
    employeeId: string;
    shopId: string;
  }): Promise<ShopDeleteOrArchiveResult>;
  upsertBusinessDefault(input: {
    employeeId: string;
    shopId: string;
    settingKey: string;
    value: unknown;
    expectedVersion: number | null;
  }): Promise<SettingWriteResult>;
  upsertShopOverride(input: {
    employeeId: string;
    shopId: string;
    settingKey: string;
    value: unknown;
    expectedVersion: number | null;
  }): Promise<SettingWriteResult>;
}

type ShopRow = {
  id: string;
  name: string;
  lifecycle_state: string;
  active: boolean;
  address_text: string | null;
  contact_phone: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  timezone: string;
  temporary_closed: boolean;
  online_orders_paused: boolean;
};

type SettingRow = {
  setting_key: string;
  value_json: unknown;
  version: number | string;
};

type SettingsVersionRow = { settings_version: number | string };

type OrderTypeRow = {
  id: string;
  name: string;
  behavior: string;
  active: boolean;
  sort_order: number | string;
};

type PaymentMethodRow = {
  id: string;
  display_name: string;
  logic_type: string;
  requires_reconciliation: boolean;
  active: boolean;
  sort_order: number | string;
  channel: string;
  requires_reference: boolean;
  manual_confirmation_required: boolean;
  refund_allowed: boolean;
  integration_reference: string | null;
};

type DeliveryZoneRow = {
  id: string;
  name: string;
  fee_minor: number | string;
  active: boolean;
  sort_order: number | string;
};

type ReasonCodeRow = {
  id: string;
  shop_id: string | null;
  reason_key: string;
  family: string;
  label: string;
  active: boolean;
  version: number | string;
};

type WeeklyHoursRow = {
  id: string;
  service_kind: string;
  day_of_week: number | string;
  timezone: string;
  opens_local: string;
  closes_local: string;
  active: boolean;
};

type SpecialHoursRow = {
  id: string;
  service_date: string;
  service_kind: string;
  timezone: string;
  closed: boolean;
  opens_local: string | null;
  closes_local: string | null;
  note: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  return numeric;
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new SettingsServiceError('backend_contract_invalid');
  return numeric;
}

function readLifecycle(value: string): ShopLifecycleState {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'ARCHIVED') return value;
  throw new SettingsServiceError('backend_contract_invalid');
}

function readChannel(value: string): PaymentMethodChannel {
  if (value === 'POS' || value === 'ONLINE' || value === 'BOTH') return value;
  throw new SettingsServiceError('backend_contract_invalid');
}

function readLogicType(value: string): AdminPaymentMethodDetail['logicType'] {
  if (value === 'CASH' || value === 'CARD' || value === 'DIGITAL' || value === 'OTHER') {
    return value;
  }
  throw new SettingsServiceError('backend_contract_invalid');
}

function readOrderBehavior(value: string): AdminOrderTypeConfiguration['behavior'] {
  if (value === 'TAKE_AWAY' || value === 'DINE_IN' || value === 'DELIVERY' || value === 'OTHER') {
    return value;
  }
  throw new SettingsServiceError('backend_contract_invalid');
}

function readReasonFamily(value: string): AdminReasonFamily {
  if (
    value === 'CANCELLATION' ||
    value === 'REFUND_RETURN' ||
    value === 'DISCOUNT_COMP' ||
    value === 'WASTE' ||
    value === 'STOCK_ADJUSTMENT' ||
    value === 'CASH_VARIANCE' ||
    value === 'PAY_IN' ||
    value === 'PAY_OUT'
  ) {
    return value;
  }
  throw new SettingsServiceError('backend_contract_invalid');
}

function readServiceKind(value: string): ShopHoursServiceKind {
  if (value === 'OPEN' || value === 'DELIVERY' || value === 'ONLINE') return value;
  throw new SettingsServiceError('backend_contract_invalid');
}

function requireCairo(value: string): 'Africa/Cairo' {
  if (value !== 'Africa/Cairo') throw new SettingsServiceError('backend_contract_invalid');
  return value;
}

function mapShop(row: ShopRow): AdminShopSettingsSummary {
  return {
    id: row.id,
    name: row.name,
    lifecycleState: readLifecycle(row.lifecycle_state),
    active: row.active,
    address: row.address_text,
    contactPhone: row.contact_phone,
    latitude: nullableNumber(row.latitude),
    longitude: nullableNumber(row.longitude),
    timezone: requireCairo(row.timezone),
    temporaryClosed: row.temporary_closed,
    onlineOrdersPaused: row.online_orders_paused,
  };
}

function mapSetting(row: SettingRow) {
  return {
    key: row.setting_key,
    value: row.value_json,
    version: safeInteger(row.version, 1),
  };
}

function mapOrderType(row: OrderTypeRow): AdminOrderTypeConfiguration {
  return {
    id: row.id,
    name: row.name,
    behavior: readOrderBehavior(row.behavior),
    active: row.active,
    sortOrder: safeInteger(row.sort_order),
  };
}

function mapPaymentMethod(row: PaymentMethodRow): AdminPaymentMethodDetail {
  return {
    id: row.id,
    displayName: row.display_name,
    logicType: readLogicType(row.logic_type),
    requiresReconciliation: row.requires_reconciliation,
    active: row.active,
    sortOrder: safeInteger(row.sort_order),
    channel: readChannel(row.channel),
    requiresReference: row.requires_reference,
    manualConfirmationRequired: row.manual_confirmation_required,
    refundAllowed: row.refund_allowed,
    integrationReference: row.integration_reference,
  };
}

function mapDeliveryZone(row: DeliveryZoneRow): AdminDeliveryZoneConfiguration {
  return {
    id: row.id,
    name: row.name,
    feeMinor: safeInteger(row.fee_minor),
    active: row.active,
    sortOrder: safeInteger(row.sort_order),
  };
}

function mapReasonCode(row: ReasonCodeRow): AdminReasonCodeConfiguration {
  return {
    id: row.id,
    scope: row.shop_id === null ? 'BUSINESS' : 'SHOP',
    key: row.reason_key,
    family: readReasonFamily(row.family),
    label: row.label,
    active: row.active,
    version: safeInteger(row.version, 1),
  };
}

function mapWeeklyHours(row: WeeklyHoursRow): AdminWeeklyHoursConfiguration {
  return {
    id: row.id,
    serviceKind: readServiceKind(row.service_kind),
    dayOfWeek: safeInteger(row.day_of_week),
    timezone: requireCairo(row.timezone),
    opensLocal: row.opens_local,
    closesLocal: row.closes_local,
    active: row.active,
  };
}

function mapSpecialHours(row: SpecialHoursRow): AdminSpecialHoursConfiguration {
  return {
    id: row.id,
    serviceDate: row.service_date,
    serviceKind: readServiceKind(row.service_kind),
    timezone: requireCairo(row.timezone),
    closed: row.closed,
    opensLocal: row.opens_local,
    closesLocal: row.closes_local,
    note: row.note,
  };
}

function parseSettingWriteResult(value: unknown): SettingWriteResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  if (value['ok'] === true) {
    return { ok: true, version: safeInteger(value['version'], 1) };
  }
  if (typeof value['code'] !== 'string') throw new SettingsServiceError('backend_contract_invalid');
  if (value['code'] === 'stale_setting_version') {
    return {
      ok: false,
      code: 'stale_setting_version',
      currentVersion: safeInteger(value['currentVersion']),
    };
  }
  return { ok: false, code: value['code'] };
}

function parsePublishResult(value: unknown): SettingsPublishResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  if (value['ok'] === true) {
    return {
      ok: true,
      settingsVersion: safeInteger(value['settingsVersion'], 1),
      operationsConfigurationVersion: safeInteger(value['operationsConfigurationVersion'], 1),
    };
  }
  if (typeof value['code'] !== 'string') throw new SettingsServiceError('backend_contract_invalid');
  if (value['code'] === 'stale_settings_version') {
    return {
      ok: false,
      code: 'stale_settings_version',
      currentVersion: safeInteger(value['currentVersion']),
    };
  }
  return { ok: false, code: value['code'] };
}

function parseDeleteResult(value: unknown): ShopDeleteOrArchiveResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new SettingsServiceError('backend_contract_invalid');
  }
  if (value['ok'] === true) {
    if (value['action'] !== 'ARCHIVED' && value['action'] !== 'DELETED') {
      throw new SettingsServiceError('backend_contract_invalid');
    }
    return { ok: true, action: value['action'] };
  }
  if (typeof value['code'] !== 'string') throw new SettingsServiceError('backend_contract_invalid');
  return { ok: false, code: value['code'] };
}

export function resolveAllowedPaymentMethods<T extends AdminPaymentMethodConfiguration>(
  methods: readonly T[],
  context: SettingsChannelContext,
): T[] {
  return methods.filter(
    (method) => method.active && (method.channel === 'BOTH' || method.channel === context.channel),
  );
}

export function createSettingsService(store: SettingsStore) {
  return {
    async resolveSetting(
      key: string,
      context: { businessId: string; shopId: string },
    ): Promise<ResolvedSetting<unknown>> {
      const layers = await store.getSettingLayers({ ...context, key });
      if (layers.shopOverride !== null) return { source: 'shop', value: layers.shopOverride };
      if (layers.businessDefault !== null) {
        return { source: 'business', value: layers.businessDefault };
      }
      return { source: 'unset', value: null };
    },

    async loadSettingsWorkspace(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<AdminSettingsWorkspace> {
      requirePermission(principal, 'settings.manage', shopId);
      return store.loadWorkspace({ businessId: principal.businessId, shopId });
    },

    async publishSettings(
      shopId: string,
      expectedSettingsVersion: number,
      principal: AdminSessionPrincipal,
    ): Promise<SettingsPublishResult> {
      requirePermission(principal, 'settings.manage', shopId);
      return store.publish({
        employeeId: principal.employeeId,
        shopId,
        expectedSettingsVersion,
      });
    },

    async upsertBusinessDefault(
      input: SettingWriteInput,
      principal: AdminSessionPrincipal,
    ): Promise<SettingWriteResult> {
      requirePermission(principal, 'settings.manage', input.shopId);
      return store.upsertBusinessDefault({ employeeId: principal.employeeId, ...input });
    },

    async upsertShopOverride(
      input: SettingWriteInput,
      principal: AdminSessionPrincipal,
    ): Promise<SettingWriteResult> {
      requirePermission(principal, 'settings.manage', input.shopId);
      return store.upsertShopOverride({ employeeId: principal.employeeId, ...input });
    },

    async deleteOrArchiveShop(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<ShopDeleteOrArchiveResult> {
      requirePermission(principal, 'shops.manage', shopId);
      return store.deleteOrArchiveShop({ employeeId: principal.employeeId, shopId });
    },
  };
}

export function createSupabaseSettingsStore(client: AdminSupabaseClient): SettingsStore {
  return {
    async getSettingLayers({ businessId, shopId, key }) {
      const [businessRows, shopRows] = await Promise.all([
        client.select<SettingRow[]>(
          'business_setting_defaults',
          new URLSearchParams({
            select: 'setting_key,value_json,version',
            business_id: `eq.${businessId}`,
            setting_key: `eq.${key}`,
            limit: '1',
          }),
        ),
        client.select<SettingRow[]>(
          'shop_setting_overrides',
          new URLSearchParams({
            select: 'setting_key,value_json,version',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            setting_key: `eq.${key}`,
            limit: '1',
          }),
        ),
      ]);
      return {
        businessDefault: businessRows[0]?.value_json ?? null,
        shopOverride: shopRows[0]?.value_json ?? null,
      };
    },

    async loadWorkspace({ businessId, shopId }) {
      const [
        shops,
        versions,
        businessDefaults,
        shopOverrides,
        orderTypes,
        paymentMethods,
        deliveryZones,
        reasonCodes,
        weeklyHours,
        specialHours,
      ] = await Promise.all([
        client.select<ShopRow[]>(
          'shops',
          new URLSearchParams({
            select:
              'id,name,lifecycle_state,active,address_text,contact_phone,latitude,longitude,timezone,temporary_closed,online_orders_paused',
            id: `eq.${shopId}`,
            limit: '1',
          }),
        ),
        client.select<SettingsVersionRow[]>(
          'shop_settings_versions',
          new URLSearchParams({
            select: 'settings_version',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'settings_version.desc',
            limit: '1',
          }),
        ),
        client.select<SettingRow[]>(
          'business_setting_defaults',
          new URLSearchParams({
            select: 'setting_key,value_json,version',
            business_id: `eq.${businessId}`,
            order: 'setting_key.asc',
          }),
        ),
        client.select<SettingRow[]>(
          'shop_setting_overrides',
          new URLSearchParams({
            select: 'setting_key,value_json,version',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'setting_key.asc',
          }),
        ),
        client.select<OrderTypeRow[]>(
          'order_types',
          new URLSearchParams({
            select: 'id,name,behavior,active,sort_order',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
        client.select<PaymentMethodRow[]>(
          'payment_methods',
          new URLSearchParams({
            select:
              'id,display_name,logic_type,requires_reconciliation,active,sort_order,channel,requires_reference,manual_confirmation_required,refund_allowed,integration_reference',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
        client.select<DeliveryZoneRow[]>(
          'delivery_zones',
          new URLSearchParams({
            select: 'id,name,fee_minor,active,sort_order',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
        client.select<ReasonCodeRow[]>(
          'admin_reason_codes',
          new URLSearchParams({
            select: 'id,shop_id,reason_key,family,label,active,version',
            business_id: `eq.${businessId}`,
            or: `(shop_id.is.null,shop_id.eq.${shopId})`,
            order: 'family.asc,reason_key.asc,shop_id.desc.nullslast',
          }),
        ),
        client.select<WeeklyHoursRow[]>(
          'shop_weekly_hours',
          new URLSearchParams({
            select: 'id,service_kind,day_of_week,timezone,opens_local,closes_local,active',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'service_kind.asc,day_of_week.asc,opens_local.asc',
          }),
        ),
        client.select<SpecialHoursRow[]>(
          'shop_special_hours',
          new URLSearchParams({
            select: 'id,service_date,service_kind,timezone,closed,opens_local,closes_local,note',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'service_date.asc,service_kind.asc',
          }),
        ),
      ]);

      if (shops.length !== 1 || !shops[0]) {
        throw new SettingsServiceError('backend_contract_invalid');
      }
      const settingsVersion =
        versions.length === 0 ? 0 : safeInteger(versions[0]?.settings_version, 1);

      return {
        shop: mapShop(shops[0]),
        settingsVersion,
        businessDefaults: businessDefaults.map(mapSetting),
        shopOverrides: shopOverrides.map(mapSetting),
        orderTypes: orderTypes.map(mapOrderType),
        paymentMethods: paymentMethods.map(mapPaymentMethod),
        deliveryZones: deliveryZones.map(mapDeliveryZone),
        reasonCodes: reasonCodes.map(mapReasonCode),
        weeklyHours: weeklyHours.map(mapWeeklyHours),
        specialHours: specialHours.map(mapSpecialHours),
      };
    },

    async publish({ employeeId, shopId, expectedSettingsVersion }) {
      const result = await client.rpc<unknown>('publish_shop_settings_v1', {
        p_employee_id: employeeId,
        p_shop_id: shopId,
        p_expected_settings_version: expectedSettingsVersion,
      });
      return parsePublishResult(result);
    },

    async deleteOrArchiveShop({ employeeId, shopId }) {
      const result = await client.rpc<unknown>('delete_or_archive_shop_v1', {
        p_employee_id: employeeId,
        p_shop_id: shopId,
      });
      return parseDeleteResult(result);
    },

    async upsertBusinessDefault({ employeeId, shopId, settingKey, value, expectedVersion }) {
      const result = await client.rpc<unknown>('upsert_business_setting_default_v1', {
        p_employee_id: employeeId,
        p_shop_id: shopId,
        p_setting_key: settingKey,
        p_value_json: value,
        p_expected_version: expectedVersion,
      });
      return parseSettingWriteResult(result);
    },

    async upsertShopOverride({ employeeId, shopId, settingKey, value, expectedVersion }) {
      const result = await client.rpc<unknown>('upsert_shop_setting_override_v1', {
        p_employee_id: employeeId,
        p_shop_id: shopId,
        p_setting_key: settingKey,
        p_value_json: value,
        p_expected_version: expectedVersion,
      });
      return parseSettingWriteResult(result);
    },
  };
}
