import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OnlineOrderRequestV1 } from '../../../packages/order-intake-contracts/src/index.ts';
import {
  resolveDeliveryRouting,
  type DeliveryRoutingBoundary,
  type DeliveryRoutingHours,
  type DeliveryRoutingZone,
} from '../../../packages/domain/src/deliveryRouting.ts';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderCatalogCategory,
  type OnlineOrderCatalogModifier,
  type OnlineOrderCatalogProduct,
  type OnlineOrderComboBeverageOption,
  type OnlineOrderDeliveryRouteResult,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderProductModifierLink,
  type OnlineOrderPublishedCheckoutAuthority,
  type OnlineOrderStoredRequest,
} from './order-intake.ts';
import { collectAllPages } from './pagedSelect.ts';
import { projectPublishedCheckoutAuthority } from './published-checkout-authority.ts';

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid`);
  return value;
}

function moneyField(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} is invalid`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} is invalid`);
  return parsed;
}

function integerField(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function deliveryBoundary(value: unknown): DeliveryRoutingBoundary | null {
  if (value === null) return null;
  const source = record(value, 'delivery zone boundary');
  if (source.kind === 'RADIUS') {
    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    const radiusMeters = Number(source.radiusMeters);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(radiusMeters) ||
      radiusMeters <= 0
    ) {
      throw new Error('delivery zone radius boundary is invalid');
    }
    return { kind: 'RADIUS', latitude, longitude, radiusMeters };
  }
  if (source.kind === 'POLYGON' && Array.isArray(source.points) && source.points.length >= 3) {
    const points = source.points.map((value) => {
      const point = record(value, 'delivery zone polygon point');
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        throw new Error('delivery zone polygon point is invalid');
      }
      return { latitude, longitude };
    });
    return { kind: 'POLYGON', points };
  }
  throw new Error('delivery zone boundary is invalid');
}

function mapDeliveryZone(value: unknown): DeliveryRoutingZone {
  const row = record(value, 'delivery zone');
  return {
    id: stringField(row.id, 'delivery zone.id'),
    name: stringField(row.name, 'delivery zone.name'),
    feeMinor: moneyField(row.fee_minor, 'delivery zone.fee_minor'),
    minimumOrderMinor: moneyField(
      row.minimum_order_minor,
      'delivery zone.minimum_order_minor',
    ),
    priority: integerField(row.priority, 'delivery zone.priority'),
    active: booleanField(row.active, 'delivery zone.active'),
    boundary: deliveryBoundary(row.boundary_json),
    fallbackShopId:
      row.fallback_shop_id === null
        ? null
        : stringField(row.fallback_shop_id, 'delivery zone.fallback_shop_id'),
    fallbackEnabled: booleanField(row.fallback_enabled, 'delivery zone.fallback_enabled'),
    sortOrder: integerField(row.sort_order, 'delivery zone.sort_order'),
  };
}

function mapDeliveryHours(value: unknown): DeliveryRoutingHours {
  const row = record(value, 'delivery hours');
  return {
    dayOfWeek: integerField(row.day_of_week, 'delivery hours.day_of_week'),
    opensLocal: stringField(row.opens_local, 'delivery hours.opens_local'),
    closesLocal: stringField(row.closes_local, 'delivery hours.closes_local'),
    active: booleanField(row.active, 'delivery hours.active'),
  };
}

class SupabaseOnlineOrderIntakeStore implements OnlineOrderIntakeStore {
  constructor(private readonly client: SupabaseClient) {}

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    const [shopResult, categoriesRows, productsRows, modifiersRows, linksRows, combosRows] =
      await Promise.all([
        this.client.from('shops').select('id,active').eq('id', shopId).maybeSingle(),
        collectAllPages(async (from, to) => {
          const result = await this.client
            .from('menu_categories')
            .select('id,shop_id,active')
            .eq('shop_id', shopId)
            .range(from, to);
          if (result.error) throw result.error;
          return result.data ?? [];
        }),
        collectAllPages(async (from, to) => {
          const result = await this.client
            .from('products')
            .select('id,shop_id,category_id,name,price_minor,active,sold_out,is_combo')
            .eq('shop_id', shopId)
            .range(from, to);
          if (result.error) throw result.error;
          return result.data ?? [];
        }),
        collectAllPages(async (from, to) => {
          const result = await this.client
            .from('modifiers')
            .select('id,shop_id,name,price_minor,active,standalone_product_id')
            .eq('shop_id', shopId)
            .range(from, to);
          if (result.error) throw result.error;
          return result.data ?? [];
        }),
        collectAllPages(async (from, to) => {
          const result = await this.client
            .from('product_modifiers')
            .select('product_id,modifier_id,max_quantity')
            .eq('shop_id', shopId)
            .range(from, to);
          if (result.error) throw result.error;
          return result.data ?? [];
        }),
        collectAllPages(async (from, to) => {
          const result = await this.client
            .from('combo_beverage_options')
            .select('combo_product_id,beverage_product_id')
            .eq('shop_id', shopId)
            .range(from, to);
          if (result.error) throw result.error;
          return result.data ?? [];
        }),
      ]);

    if (shopResult.error) throw shopResult.error;
    if (!shopResult.data) return null;

    const shop = record(shopResult.data, 'shop');
    const categories: OnlineOrderCatalogCategory[] = categoriesRows.map((value) => {
      const row = record(value, 'category');
      return {
        id: stringField(row.id, 'category.id'),
        shopId: stringField(row.shop_id, 'category.shop_id'),
        active: booleanField(row.active, 'category.active'),
      };
    });
    const products: OnlineOrderCatalogProduct[] = productsRows.map((value) => {
      const row = record(value, 'product');
      return {
        id: stringField(row.id, 'product.id'),
        shopId: stringField(row.shop_id, 'product.shop_id'),
        categoryId: stringField(row.category_id, 'product.category_id'),
        name: stringField(row.name, 'product.name'),
        priceMinor: moneyField(row.price_minor, 'product.price_minor'),
        active: booleanField(row.active, 'product.active'),
        soldOut: booleanField(row.sold_out, 'product.sold_out'),
        isCombo: booleanField(row.is_combo, 'product.is_combo'),
      };
    });
    const modifiers: OnlineOrderCatalogModifier[] = modifiersRows.map((value) => {
      const row = record(value, 'modifier');
      return {
        id: stringField(row.id, 'modifier.id'),
        shopId: stringField(row.shop_id, 'modifier.shop_id'),
        name: stringField(row.name, 'modifier.name'),
        priceMinor: moneyField(row.price_minor, 'modifier.price_minor'),
        active: booleanField(row.active, 'modifier.active'),
        standaloneProductId:
          row.standalone_product_id === null
            ? null
            : stringField(row.standalone_product_id, 'modifier.standalone_product_id'),
      };
    });
    const productModifierLinks: OnlineOrderProductModifierLink[] = linksRows.map(
      (value) => {
        const row = record(value, 'product modifier link');
        return {
          productId: stringField(row.product_id, 'product modifier link.product_id'),
          modifierId: stringField(row.modifier_id, 'product modifier link.modifier_id'),
          maxQuantity: nullablePositiveInteger(
            row.max_quantity,
            'product modifier link.max_quantity',
          ),
        };
      },
    );
    const comboBeverageOptions: OnlineOrderComboBeverageOption[] = combosRows.map(
      (value) => {
        const row = record(value, 'combo beverage option');
        return {
          comboProductId: stringField(
            row.combo_product_id,
            'combo beverage option.combo_product_id',
          ),
          beverageProductId: stringField(
            row.beverage_product_id,
            'combo beverage option.beverage_product_id',
          ),
        };
      },
    );

    return {
      shop: {
        id: stringField(shop.id, 'shop.id'),
        active: booleanField(shop.active, 'shop.active'),
      },
      categories,
      products,
      modifiers,
      productModifierLinks,
      comboBeverageOptions,
    };
  }

  async loadPublishedCheckoutAuthority(
    shopId: string,
  ): Promise<OnlineOrderPublishedCheckoutAuthority | null> {
    const { data, error } = await this.client
      .from('operations_configuration_snapshots')
      .select('bundle_json')
      .eq('shop_id', shopId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = record(data, 'published Operations configuration');
    return projectPublishedCheckoutAuthority(row.bundle_json, shopId);
  }

  async resolveDeliveryRoute(input: {
    requestedShopId: string;
    latitude: number;
    longitude: number;
    subtotalMinor: number;
    at: string;
  }): Promise<OnlineOrderDeliveryRouteResult> {
    const membership = await this.client
      .from('business_shops')
      .select('business_id')
      .eq('shop_id', input.requestedShopId)
      .limit(1)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return { ok: false, code: 'delivery_unavailable' };
    const businessId = stringField(record(membership.data, 'business shop').business_id, 'business_id');

    const loadShop = async (shopId: string): Promise<boolean> => {
      const result = await this.client
        .from('shops')
        .select('active,lifecycle_state,temporary_closed')
        .eq('id', shopId)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return false;
      const row = record(result.data, 'delivery shop');
      return (
        booleanField(row.active, 'delivery shop.active') &&
        row.lifecycle_state !== 'ARCHIVED' &&
        !booleanField(row.temporary_closed, 'delivery shop.temporary_closed')
      );
    };
    const loadHours = async (shopId: string): Promise<DeliveryRoutingHours[]> => {
      const result = await this.client
        .from('shop_weekly_hours')
        .select('day_of_week,opens_local,closes_local,active')
        .eq('business_id', businessId)
        .eq('shop_id', shopId)
        .eq('service_kind', 'DELIVERY');
      if (result.error) throw result.error;
      return (result.data ?? []).map(mapDeliveryHours);
    };
    const loadZones = async (shopId: string): Promise<DeliveryRoutingZone[]> => {
      const result = await this.client
        .from('delivery_zones')
        .select(
          'id,name,fee_minor,minimum_order_minor,priority,active,boundary_json,fallback_shop_id,fallback_enabled,sort_order',
        )
        .eq('shop_id', shopId);
      if (result.error) throw result.error;
      return (result.data ?? []).map(mapDeliveryZone);
    };

    const [requestedShopAvailable, requestedShopHours, zones] = await Promise.all([
      loadShop(input.requestedShopId),
      loadHours(input.requestedShopId),
      loadZones(input.requestedShopId),
    ]);
    const fallbackIds = [
      ...new Set(
        zones
          .filter((zone) => zone.fallbackEnabled && zone.fallbackShopId !== null)
          .map((zone) => zone.fallbackShopId!),
      ),
    ];
    const fallbackShops: Record<
      string,
      {
        available: boolean;
        hours: DeliveryRoutingHours[];
        zones: DeliveryRoutingZone[];
      }
    > = {};
    if (fallbackIds.length > 0) {
      const allowed = await this.client
        .from('business_shops')
        .select('shop_id')
        .eq('business_id', businessId)
        .in('shop_id', fallbackIds);
      if (allowed.error) throw allowed.error;
      const allowedIds = new Set(
        (allowed.data ?? []).map((value) =>
          stringField(record(value, 'fallback membership').shop_id, 'fallback shop_id'),
        ),
      );
      await Promise.all(
        fallbackIds
          .filter((shopId) => allowedIds.has(shopId))
          .map(async (shopId) => {
            const [available, hours, fallbackZones] = await Promise.all([
              loadShop(shopId),
              loadHours(shopId),
              loadZones(shopId),
            ]);
            fallbackShops[shopId] = { available, hours, zones: fallbackZones };
          }),
      );
    }
    return resolveDeliveryRouting(
      {
        requestedShopAvailable,
        requestedShopHours,
        zones,
        fallbackShops,
      },
      input,
    );
  }

  async translateRequestToShop(input: {
    requestedShopId: string;
    targetShopId: string;
    request: OnlineOrderRequestV1;
  }): Promise<OnlineOrderRequestV1 | null> {
    if (input.requestedShopId === input.targetShopId) {
      return { ...input.request, shopId: input.targetShopId };
    }

    const productIds = new Set<string>();
    const modifierIds = new Set<string>();
    for (const item of input.request.items) {
      productIds.add(item.productId);
      for (const addonProductId of item.addonProductIds) productIds.add(addonProductId);
      if (item.comboBeverageProductId !== null) productIds.add(item.comboBeverageProductId);
      for (const selection of item.modifierSelections) modifierIds.add(selection.modifierId);
    }

    const sourceStandaloneByModifier = new Map<string, string>();
    const selectedModifierIds = [...modifierIds];
    for (let offset = 0; offset < selectedModifierIds.length; offset += 100) {
      const result = await this.client
        .from('modifiers')
        .select('id,standalone_product_id')
        .eq('shop_id', input.requestedShopId)
        .in('id', selectedModifierIds.slice(offset, offset + 100));
      if (result.error) throw result.error;
      for (const value of result.data ?? []) {
        const row = record(value, 'source modifier mapping');
        const id = stringField(row.id, 'source modifier mapping.id');
        if (row.standalone_product_id === null) return null;
        const standaloneProductId = stringField(
          row.standalone_product_id,
          'source modifier mapping.standalone_product_id',
        );
        sourceStandaloneByModifier.set(id, standaloneProductId);
        productIds.add(standaloneProductId);
      }
    }
    if (sourceStandaloneByModifier.size !== modifierIds.size) return null;

    const sourceProductIds = [...productIds];
    const masterBySourceProduct = new Map<string, string>();
    for (let offset = 0; offset < sourceProductIds.length; offset += 100) {
      const result = await this.client
        .from('catalog_product_shop_overrides')
        .select('master_product_id,canonical_product_id')
        .eq('shop_id', input.requestedShopId)
        .in('canonical_product_id', sourceProductIds.slice(offset, offset + 100));
      if (result.error) throw result.error;
      for (const value of result.data ?? []) {
        const row = record(value, 'source product master mapping');
        masterBySourceProduct.set(
          stringField(row.canonical_product_id, 'source product mapping.canonical_product_id'),
          stringField(row.master_product_id, 'source product mapping.master_product_id'),
        );
      }
    }
    if (masterBySourceProduct.size !== productIds.size) return null;

    const masterProductIds = [...new Set(masterBySourceProduct.values())];
    const targetProductByMaster = new Map<string, string>();
    for (let offset = 0; offset < masterProductIds.length; offset += 100) {
      const result = await this.client
        .from('catalog_product_shop_overrides')
        .select('master_product_id,canonical_product_id')
        .eq('shop_id', input.targetShopId)
        .in('master_product_id', masterProductIds.slice(offset, offset + 100));
      if (result.error) throw result.error;
      for (const value of result.data ?? []) {
        const row = record(value, 'target product master mapping');
        targetProductByMaster.set(
          stringField(row.master_product_id, 'target product mapping.master_product_id'),
          stringField(row.canonical_product_id, 'target product mapping.canonical_product_id'),
        );
      }
    }
    if (targetProductByMaster.size !== masterProductIds.length) return null;

    const translatedProduct = (sourceProductId: string): string | null => {
      const masterProductId = masterBySourceProduct.get(sourceProductId);
      return masterProductId === undefined
        ? null
        : (targetProductByMaster.get(masterProductId) ?? null);
    };

    const targetStandaloneIds = [
      ...new Set(
        [...sourceStandaloneByModifier.values()]
          .map((sourceProductId) => translatedProduct(sourceProductId))
          .filter((value): value is string => value !== null),
      ),
    ];
    if (targetStandaloneIds.length !== new Set(sourceStandaloneByModifier.values()).size) {
      return null;
    }

    const targetModifierByStandaloneProduct = new Map<string, string>();
    for (let offset = 0; offset < targetStandaloneIds.length; offset += 100) {
      const result = await this.client
        .from('modifiers')
        .select('id,standalone_product_id')
        .eq('shop_id', input.targetShopId)
        .in('standalone_product_id', targetStandaloneIds.slice(offset, offset + 100));
      if (result.error) throw result.error;
      for (const value of result.data ?? []) {
        const row = record(value, 'target modifier mapping');
        const standaloneProductId = stringField(
          row.standalone_product_id,
          'target modifier mapping.standalone_product_id',
        );
        if (targetModifierByStandaloneProduct.has(standaloneProductId)) return null;
        targetModifierByStandaloneProduct.set(
          standaloneProductId,
          stringField(row.id, 'target modifier mapping.id'),
        );
      }
    }
    if (targetModifierByStandaloneProduct.size !== targetStandaloneIds.length) return null;

    const translatedModifierBySource = new Map<string, string>();
    for (const [sourceModifierId, sourceStandaloneProductId] of sourceStandaloneByModifier) {
      const targetStandaloneProductId = translatedProduct(sourceStandaloneProductId);
      if (targetStandaloneProductId === null) return null;
      const targetModifierId = targetModifierByStandaloneProduct.get(targetStandaloneProductId);
      if (targetModifierId === undefined) return null;
      translatedModifierBySource.set(sourceModifierId, targetModifierId);
    }

    const translatedItems: OnlineOrderRequestV1['items'] = [];
    for (const item of input.request.items) {
      const productId = translatedProduct(item.productId);
      if (productId === null) return null;

      const addonProductIds: string[] = [];
      for (const addonProductId of item.addonProductIds) {
        const translated = translatedProduct(addonProductId);
        if (translated === null) return null;
        addonProductIds.push(translated);
      }

      const comboBeverageProductId =
        item.comboBeverageProductId === null
          ? null
          : translatedProduct(item.comboBeverageProductId);
      if (item.comboBeverageProductId !== null && comboBeverageProductId === null) return null;

      const modifierSelections = item.modifierSelections.map((selection) => {
        const modifierId = translatedModifierBySource.get(selection.modifierId);
        return modifierId === undefined ? null : { ...selection, modifierId };
      });
      if (modifierSelections.some((selection) => selection === null)) return null;

      translatedItems.push({
        ...item,
        productId,
        addonProductIds,
        modifierSelections: modifierSelections as OnlineOrderRequestV1['items'][number]['modifierSelections'],
        comboBeverageProductId,
      });
    }

    return {
      ...input.request,
      shopId: input.targetShopId,
      items: translatedItems,
    };
  }

  async findByIdempotency(
    requestedShopId: string,
    idempotencyKey: string,
  ): Promise<OnlineOrderStoredRequest | null> {
    const { data, error } = await this.client
      .from('online_order_requests')
      .select('id,shop_id,idempotency_key,request_sha256,status')
      .eq('idempotency_key', idempotencyKey)
      .or(
        `requested_shop_id.eq.${requestedShopId},and(requested_shop_id.is.null,shop_id.eq.${requestedShopId})`,
      )
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = record(data, 'online order request');
    const status = stringField(row.status, 'online order request.status');
    if (
      status !== 'PENDING' &&
      status !== 'PROCESSING' &&
      status !== 'ACCEPTED' &&
      status !== 'REJECTED'
    ) {
      throw new Error('online order request status is invalid');
    }
    return {
      id: stringField(row.id, 'online order request.id'),
      shopId: stringField(row.shop_id, 'online order request.shop_id'),
      idempotencyKey: stringField(row.idempotency_key, 'online order request.idempotency_key'),
      requestSha256: stringField(row.request_sha256, 'online order request.request_sha256'),
      status,
    };
  }

  async insertPending(recordToInsert: OnlineOrderPendingInsert): Promise<void> {
    const { error } = await this.client.from('online_order_requests').insert({
      id: recordToInsert.id,
      shop_id: recordToInsert.shopId,
      idempotency_key: recordToInsert.idempotencyKey,
      request_sha256: recordToInsert.requestSha256,
      source_fingerprint: recordToInsert.sourceFingerprint,
      catalog_revision: recordToInsert.catalogRevision,
      status: recordToInsert.status,
      fulfillment_preference: recordToInsert.fulfillmentPreference,
      payment_preference: recordToInsert.paymentPreference,
      customer_name: recordToInsert.customerName,
      normalized_phone: recordToInsert.normalizedPhone,
      delivery_address: recordToInsert.deliveryAddress,
      delivery_latitude: recordToInsert.deliveryLatitude,
      delivery_longitude: recordToInsert.deliveryLongitude,
      delivery_zone_id: recordToInsert.deliveryZoneId,
      delivery_zone_name: recordToInsert.deliveryZoneName,
      delivery_fee_minor: recordToInsert.deliveryFeeMinor,
      delivery_minimum_order_minor: recordToInsert.deliveryMinimumOrderMinor,
      delivery_fallback_used: recordToInsert.deliveryFallbackUsed,
      delivery_routing_snapshot: recordToInsert.deliveryRoutingSnapshot,
      requested_shop_id: recordToInsert.requestedShopId,
      trusted_items: recordToInsert.trustedItems,
      items_subtotal_minor: recordToInsert.itemsSubtotalMinor,
      order_note: recordToInsert.orderNote,
      promotion_id: recordToInsert.promotionId,
      loyalty_points_to_redeem: recordToInsert.loyaltyPointsToRedeem,
      accepted_order_id: recordToInsert.acceptedOrderId,
    });
    if (error) throw error;
  }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('order-intake is missing its trusted Supabase server configuration');
}

const client =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

Deno.serve((request) => {
  if (!client) {
    return new Response(
      JSON.stringify({ schemaVersion: 1, error: { code: 'intake_not_configured' } }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
        },
      },
    );
  }
  return handleOrderIntakeRequest(request, new SupabaseOnlineOrderIntakeStore(client));
});
