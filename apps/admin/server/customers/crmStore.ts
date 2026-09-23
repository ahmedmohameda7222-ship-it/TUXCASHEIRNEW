import type {
  AdminLoyaltyAdjustmentResult,
  AdminLoyaltyLedgerEvent,
  AdminLoyaltyProgram,
  AdminPromotion,
  AdminPromotionMutationResult,
} from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import type { CrmCustomerFacts, CrmStore } from './crmService.js';

type CustomerRow = {
  id: string;
  normalized_phone: string;
  display_name: string | null;
};

type LinkRow = {
  shop_id: string;
  canonical_customer_id: string;
  legacy_customer_contact_id: string | null;
};

type ShopRow = {
  id: string;
  name: string;
};

type AddressRow = {
  id: string;
  shop_id: string | null;
  address_text: string;
  delivery_zone_id: string | null;
  last_used_at: string | null;
};

type OrderRow = {
  total_minor: number | string;
  created_at: string;
  order_type_behavior_snapshot: string;
};

type LedgerRow = {
  id: string;
  shop_id: string | null;
  order_id: string | null;
  event_type: AdminLoyaltyLedgerEvent['eventType'];
  points_delta: number | string;
  monetary_value_minor: number | string;
  earn_expires_at: string | null;
  reason_code_id: string | null;
  reason_code_key: string | null;
  reason_label_snapshot: string | null;
  reason_family_snapshot: string | null;
  reason_config_version: number | string | null;
  reason_note: string | null;
  source_event_id: string | null;
  created_at: string;
};

type ProgramRow = {
  business_id: string;
  enabled: boolean;
  earn_points_per_100_minor: number | string;
  redemption_minor_per_point: number | string;
  minimum_redemption_points: number | string;
  point_expiry_days: number | string | null;
  shop_ids: string[];
  version: number | string;
  updated_at: string;
};

type PromotionRow = {
  id: string;
  business_id: string;
  name: string;
  active: boolean;
  kind: AdminPromotion['kind'];
  percent_basis_points: number | string | null;
  fixed_discount_minor: number | string | null;
  free_product_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  minimum_order_minor: number | string;
  shop_ids: string[];
  channel: AdminPromotion['channel'];
  product_ids: string[];
  category_ids: string[];
  total_usage_limit: number | string | null;
  per_customer_usage_limit: number | string | null;
  stacking_policy: AdminPromotion['stackingPolicy'];
  version: number | string;
  updated_at: string;
};

const segmentPolicy = {
  vipMinOrders: 10,
  vipMinSpendMinor: 100_000,
  topSpenderMinSpendMinor: 120_000,
  frequentDeliveryMinOrders: 4,
} as const;

function safeInteger(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('crm_backend_contract_invalid');
  }
  return parsed;
}

function nullableInteger(value: number | string | null): number | null {
  return value === null ? null : safeInteger(value);
}

function inFilter(values: readonly string[]): string {
  return `in.(${values.join(',')})`;
}

function reasonFor(row: LedgerRow): AdminLoyaltyLedgerEvent['reason'] {
  if (
    !row.reason_code_id ||
    !row.reason_code_key ||
    !row.reason_label_snapshot ||
    !row.reason_family_snapshot ||
    row.reason_config_version === null
  ) {
    return null;
  }
  return {
    id: row.reason_code_id,
    key: row.reason_code_key,
    label: row.reason_label_snapshot,
    family: row.reason_family_snapshot,
    configurationVersion: safeInteger(row.reason_config_version),
  };
}

async function hydrateCustomerFacts(
  client: AdminSupabaseClient,
  businessId: string,
  customer: CustomerRow,
): Promise<CrmCustomerFacts> {
  const [links, addresses, ledger] = await Promise.all([
    client.select<LinkRow[]>(
      'customer_shop_links',
      new URLSearchParams({
        select: 'shop_id,canonical_customer_id,legacy_customer_contact_id',
        business_id: `eq.${businessId}`,
        canonical_customer_id: `eq.${customer.id}`,
        order: 'created_at.asc,id.asc',
      }),
    ),
    client.select<AddressRow[]>(
      'customer_addresses',
      new URLSearchParams({
        select: 'id,shop_id,address_text,delivery_zone_id,last_used_at',
        business_id: `eq.${businessId}`,
        canonical_customer_id: `eq.${customer.id}`,
        order: 'last_used_at.desc.nullslast,created_at.desc,id.desc',
      }),
    ),
    client.select<LedgerRow[]>(
      'loyalty_ledger',
      new URLSearchParams({
        select:
          'id,shop_id,order_id,event_type,points_delta,monetary_value_minor,earn_expires_at,reason_code_id,reason_code_key,reason_label_snapshot,reason_family_snapshot,reason_config_version,reason_note,source_event_id,created_at',
        business_id: `eq.${businessId}`,
        customer_id: `eq.${customer.id}`,
        order: 'created_at.desc,id.desc',
        limit: '250',
      }),
    ),
  ]);

  const shopIds = [...new Set(links.map((link) => link.shop_id))];
  const contactIds = links
    .map((link) => link.legacy_customer_contact_id)
    .filter((value): value is string => Boolean(value));

  const [shops, orders] = await Promise.all([
    shopIds.length === 0
      ? Promise.resolve([] as ShopRow[])
      : client.select<ShopRow[]>(
          'shops',
          new URLSearchParams({
            select: 'id,name',
            id: inFilter(shopIds),
            order: 'name.asc,id.asc',
          }),
        ),
    contactIds.length === 0
      ? Promise.resolve([] as OrderRow[])
      : client.select<OrderRow[]>(
          'orders',
          new URLSearchParams({
            select: 'total_minor,created_at,order_type_behavior_snapshot',
            customer_contact_id: inFilter(contactIds),
            order: 'created_at.desc,id.desc',
          }),
        ),
  ]);

  const lifetimeSpendMinor = orders.reduce((sum, order) => sum + safeInteger(order.total_minor), 0);
  const loyaltyBalance = ledger.reduce((sum, event) => sum + safeInteger(event.points_delta), 0);

  return {
    id: customer.id,
    normalizedPhone: customer.normalized_phone,
    displayName: customer.display_name,
    orderCount: orders.length,
    lifetimeSpendMinor,
    lastOrderAt: orders[0]?.created_at ?? null,
    deliveryOrderCount: orders.filter((order) => order.order_type_behavior_snapshot === 'DELIVERY')
      .length,
    loyaltyBalance,
    linkedShops: shops.map((shop) => ({
      shopId: shop.id,
      shopName: shop.name,
    })),
    addresses: addresses.map((address) => ({
      id: address.id,
      shopId: address.shop_id,
      address: address.address_text,
      deliveryZoneId: address.delivery_zone_id,
      lastUsedAt: address.last_used_at,
    })),
    loyaltyHistory: ledger.map((event) => ({
      id: event.id,
      shopId: event.shop_id,
      orderId: event.order_id,
      eventType: event.event_type,
      pointsDelta: safeInteger(event.points_delta),
      monetaryValueMinor: safeInteger(event.monetary_value_minor),
      earnExpiresAt: event.earn_expires_at,
      reason: reasonFor(event),
      note: event.reason_note,
      sourceEventId: event.source_event_id,
      createdAt: event.created_at,
    })),
    segmentPolicy,
  };
}

function promotionFor(row: PromotionRow): AdminPromotion {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    active: row.active,
    kind: row.kind,
    percentBasisPoints: nullableInteger(row.percent_basis_points),
    fixedDiscountMinor: nullableInteger(row.fixed_discount_minor),
    freeProductId: row.free_product_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minimumOrderMinor: safeInteger(row.minimum_order_minor),
    shopIds: row.shop_ids,
    channel: row.channel,
    productIds: row.product_ids,
    categoryIds: row.category_ids,
    totalUsageLimit: nullableInteger(row.total_usage_limit),
    perCustomerUsageLimit: nullableInteger(row.per_customer_usage_limit),
    stackingPolicy: row.stacking_policy,
    version: safeInteger(row.version),
    updatedAt: row.updated_at,
  };
}

export function createCrmStore(client: AdminSupabaseClient): CrmStore {
  return {
    async listCustomerFacts(input) {
      const links = await client.select<LinkRow[]>(
        'customer_shop_links',
        new URLSearchParams({
          select: 'shop_id,canonical_customer_id,legacy_customer_contact_id',
          business_id: `eq.${input.businessId}`,
          shop_id: `eq.${input.shopId}`,
          order: 'created_at.desc,id.desc',
          limit: '100',
        }),
      );
      const customerIds = [...new Set(links.map((link) => link.canonical_customer_id))];
      if (customerIds.length === 0) return [];

      const query = new URLSearchParams({
        select: 'id,normalized_phone,display_name',
        business_id: `eq.${input.businessId}`,
        id: inFilter(customerIds),
        merged_into_customer_id: 'is.null',
        order: 'updated_at.desc,id.desc',
      });
      const term = input.query
        .trim()
        .slice(0, 80)
        .replace(/[,*().%]/g, '');
      if (term) {
        query.set('or', `(display_name.ilike.*${term}*,normalized_phone.ilike.*${term}*)`);
      }
      const customers = await client.select<CustomerRow[]>('business_customers', query);
      return Promise.all(
        customers.map((customer) => hydrateCustomerFacts(client, input.businessId, customer)),
      );
    },

    async getCustomerFacts(input) {
      const links = await client.select<LinkRow[]>(
        'customer_shop_links',
        new URLSearchParams({
          select: 'shop_id,canonical_customer_id,legacy_customer_contact_id',
          business_id: `eq.${input.businessId}`,
          shop_id: `eq.${input.shopId}`,
          canonical_customer_id: `eq.${input.customerId}`,
          limit: '1',
        }),
      );
      if (links.length !== 1) return null;
      const rows = await client.select<CustomerRow[]>(
        'business_customers',
        new URLSearchParams({
          select: 'id,normalized_phone,display_name',
          business_id: `eq.${input.businessId}`,
          id: `eq.${input.customerId}`,
          merged_into_customer_id: 'is.null',
          limit: '1',
        }),
      );
      const customer = rows[0];
      return customer ? hydrateCustomerFacts(client, input.businessId, customer) : null;
    },

    async getLoyaltyProgram(input) {
      const rows = await client.select<ProgramRow[]>(
        'loyalty_programs',
        new URLSearchParams({
          select:
            'business_id,enabled,earn_points_per_100_minor,redemption_minor_per_point,minimum_redemption_points,point_expiry_days,shop_ids,version,updated_at',
          business_id: `eq.${input.businessId}`,
          limit: '1',
        }),
      );
      const row = rows[0];
      return row
        ? {
            businessId: row.business_id,
            enabled: row.enabled,
            earnPointsPer100Minor: safeInteger(row.earn_points_per_100_minor),
            redemptionMinorPerPoint: safeInteger(row.redemption_minor_per_point),
            minimumRedemptionPoints: safeInteger(row.minimum_redemption_points),
            pointExpiryDays: nullableInteger(row.point_expiry_days),
            shopIds: row.shop_ids,
            version: safeInteger(row.version),
            updatedAt: row.updated_at,
          }
        : null;
    },

    async listPromotions(input) {
      const rows = await client.select<PromotionRow[]>(
        'promotion_rules',
        new URLSearchParams({
          select:
            'id,business_id,name,active,kind,percent_basis_points,fixed_discount_minor,free_product_id,starts_at,ends_at,minimum_order_minor,shop_ids,channel,product_ids,category_ids,total_usage_limit,per_customer_usage_limit,stacking_policy,version,updated_at',
          business_id: `eq.${input.businessId}`,
          order: 'updated_at.desc,id.desc',
        }),
      );
      return rows.map(promotionFor);
    },

    upsertLoyaltyProgram(input) {
      return client.rpc('upsert_admin_loyalty_program_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_enabled: input.enabled,
        p_earn_points_per_100_minor: input.earnPointsPer100Minor,
        p_redemption_minor_per_point: input.redemptionMinorPerPoint,
        p_minimum_redemption_points: input.minimumRedemptionPoints,
        p_point_expiry_days: input.pointExpiryDays,
        p_shop_ids: input.shopIds,
        p_expected_version: input.expectedVersion,
      });
    },

    adjustLoyalty(input) {
      return client.rpc<AdminLoyaltyAdjustmentResult>('adjust_admin_customer_loyalty_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_customer_id: input.customerId,
        p_points_delta: input.pointsDelta,
        p_reason_code_id: input.reasonCodeId,
        p_note: input.note,
        p_command_id: input.commandId,
        p_business_id: input.businessId,
      });
    },

    upsertPromotion(input) {
      const promotion = input.promotion;
      return client.rpc<AdminPromotionMutationResult>('upsert_admin_promotion_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_promotion_id: promotion.id,
        p_name: promotion.name,
        p_active: promotion.active,
        p_kind: promotion.kind,
        p_percent_basis_points: promotion.percentBasisPoints,
        p_fixed_discount_minor: promotion.fixedDiscountMinor,
        p_free_product_id: promotion.freeProductId,
        p_starts_at: promotion.startsAt,
        p_ends_at: promotion.endsAt,
        p_minimum_order_minor: promotion.minimumOrderMinor,
        p_shop_ids: promotion.shopIds,
        p_channel: promotion.channel,
        p_product_ids: promotion.productIds,
        p_category_ids: promotion.categoryIds,
        p_total_usage_limit: promotion.totalUsageLimit,
        p_per_customer_usage_limit: promotion.perCustomerUsageLimit,
        p_stacking_policy: promotion.stackingPolicy,
        p_expected_version: promotion.expectedVersion,
        p_command_id: input.commandId,
      });
    },
  };
}
