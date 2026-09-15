import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleCatalogPublicRequest,
  type PublicCatalogStore,
  type PublicCategoryRow,
  type PublicComboBeverageRow,
  type PublicModifierRow,
  type PublicProductModifierRow,
  type PublicProductRow,
} from './catalog.ts';
import type { PublishedPublicOrderingProjection } from './published-ordering.ts';

const IMAGE_BUCKET = 'catalog-product-images';

interface RpcPayload {
  readonly shop: { readonly id: string; readonly active: boolean } | null;
  readonly categories: readonly PublicCategoryRow[];
  readonly products: readonly PublicProductRow[];
  readonly modifiers: readonly PublicModifierRow[];
  readonly productModifierLinks: readonly PublicProductModifierRow[];
  readonly comboBeverageOptions: readonly PublicComboBeverageRow[];
}

function unavailable(): Response {
  return new Response(JSON.stringify({ schemaVersion: 1, error: { code: 'catalog_unavailable' } }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}

function createStore(client: SupabaseClient): PublicCatalogStore {
  let cachedShopId: string | null = null;
  let cached: Promise<RpcPayload | null> | null = null;
  let cachedOrderingShopId: string | null = null;
  let cachedOrdering: Promise<PublishedPublicOrderingProjection | null> | null = null;

  const load = (shopId: string): Promise<RpcPayload | null> => {
    if (cached === null || cachedShopId !== shopId) {
      cachedShopId = shopId;
      cached = (async () => {
        const { data, error } = await client.rpc('read_catalog_public_v1', { p_shop_id: shopId });
        if (error) throw new Error('catalog public read RPC failed');
        if (data === null) return null;
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('catalog public read RPC returned invalid payload');
        return data as RpcPayload;
      })();
    }
    return cached;
  };

  const loadPublishedOrdering = (
    shopId: string,
  ): Promise<PublishedPublicOrderingProjection | null> => {
    if (cachedOrdering === null || cachedOrderingShopId !== shopId) {
      cachedOrderingShopId = shopId;
      cachedOrdering = (async () => {
        const { data, error } = await client.rpc('read_catalog_public_ordering_v2', {
          p_shop_id: shopId,
        });
        if (error) throw new Error('catalog public ordering RPC failed');
        if (data === null) return null;
        if (typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('catalog public ordering RPC returned invalid payload');
        }
        return data as unknown as PublishedPublicOrderingProjection;
      })();
    }
    return cachedOrdering;
  };

  return {
    getShop: async (shopId) => (await load(shopId))?.shop ?? null,
    listCategories: async (shopId) => (await load(shopId))?.categories ?? [],
    listProducts: async (shopId) => (await load(shopId))?.products ?? [],
    listModifiers: async (shopId) => (await load(shopId))?.modifiers ?? [],
    listProductModifierLinks: async (shopId) => (await load(shopId))?.productModifierLinks ?? [],
    listComboBeverageOptions: async (shopId) => (await load(shopId))?.comboBeverageOptions ?? [],
    resolveImageUrl: (imageKey) => {
      if (imageKey === null) return null;
      return client.storage.from(IMAGE_BUCKET).getPublicUrl(imageKey).data.publicUrl;
    },
    getPublishedOrderingProjection: loadPublishedOrdering,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return unavailable();

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return await handleCatalogPublicRequest(request, createStore(client));
});
