import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderCatalogCategory,
  type OnlineOrderCatalogModifier,
  type OnlineOrderCatalogProduct,
  type OnlineOrderComboBeverageOption,
  type OnlineOrderIntakeStore,
  type OnlineOrderPendingInsert,
  type OnlineOrderProductModifierLink,
  type OnlineOrderPublishedCheckoutAuthority,
  type OnlineOrderStoredRequest,
} from './order-intake.ts';
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

class SupabaseOnlineOrderIntakeStore implements OnlineOrderIntakeStore {
  constructor(private readonly client: SupabaseClient) {}

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    const [
      shopResult,
      categoriesResult,
      productsResult,
      modifiersResult,
      linksResult,
      combosResult,
    ] = await Promise.all([
      this.client.from('shops').select('id,active').eq('id', shopId).maybeSingle(),
      this.client.from('menu_categories').select('id,shop_id,active').eq('shop_id', shopId),
      this.client
        .from('products')
        .select('id,shop_id,category_id,name,price_minor,active,sold_out,is_combo')
        .eq('shop_id', shopId),
      this.client
        .from('modifiers')
        .select('id,shop_id,name,price_minor,active,standalone_product_id')
        .eq('shop_id', shopId),
      this.client
        .from('product_modifiers')
        .select('product_id,modifier_id,max_quantity')
        .eq('shop_id', shopId),
      this.client
        .from('combo_beverage_options')
        .select('combo_product_id,beverage_product_id')
        .eq('shop_id', shopId),
    ]);

    for (const result of [
      shopResult,
      categoriesResult,
      productsResult,
      modifiersResult,
      linksResult,
      combosResult,
    ]) {
      if (result.error) throw result.error;
    }
    if (!shopResult.data) return null;

    const shop = record(shopResult.data, 'shop');
    const categories: OnlineOrderCatalogCategory[] = (categoriesResult.data ?? []).map((value) => {
      const row = record(value, 'category');
      return {
        id: stringField(row.id, 'category.id'),
        shopId: stringField(row.shop_id, 'category.shop_id'),
        active: booleanField(row.active, 'category.active'),
      };
    });
    const products: OnlineOrderCatalogProduct[] = (productsResult.data ?? []).map((value) => {
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
    const modifiers: OnlineOrderCatalogModifier[] = (modifiersResult.data ?? []).map((value) => {
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
    const productModifierLinks: OnlineOrderProductModifierLink[] = (linksResult.data ?? []).map(
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
    const comboBeverageOptions: OnlineOrderComboBeverageOption[] = (combosResult.data ?? []).map(
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

  async findByIdempotency(
    shopId: string,
    idempotencyKey: string,
  ): Promise<OnlineOrderStoredRequest | null> {
    const { data, error } = await this.client
      .from('online_order_requests')
      .select('id,shop_id,idempotency_key,request_sha256,status')
      .eq('shop_id', shopId)
      .eq('idempotency_key', idempotencyKey)
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
      trusted_items: recordToInsert.trustedItems,
      items_subtotal_minor: recordToInsert.itemsSubtotalMinor,
      order_note: recordToInsert.orderNote,
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
