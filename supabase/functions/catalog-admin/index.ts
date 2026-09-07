import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CATALOG_ERROR_CODES, type CatalogAdminCommandV1, type CatalogErrorCodeV1 } from '../../../packages/catalog-contracts/src/index.ts';
import {
  handleCatalogAdminRequest,
  type CatalogAdminDependencies,
  type CatalogAdminEntity,
  type CatalogAdminStore,
} from './catalogAdmin.ts';

const IMAGE_BUCKET = 'catalog-product-images';

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

function tableForEntity(entity: CatalogAdminEntity): 'menu_categories' | 'products' | 'modifiers' {
  if (entity === 'category') return 'menu_categories';
  if (entity === 'product') return 'products';
  return 'modifiers';
}

function createStore(service: SupabaseClient): CatalogAdminStore {
  return {
    getMembership: async (userId, shopId) => {
      const { data, error } = await service
        .from('shop_memberships')
        .select('role,active')
        .eq('shop_id', shopId)
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (error) throw new Error('membership lookup failed');
      if (data === null) return null;
      if (data.role !== 'OWNER' && data.role !== 'ADMIN' && data.role !== 'OPERATIONS_DEVICE') {
        throw new Error('membership role invalid');
      }
      return { role: data.role, active: data.active === true };
    },

    getEntityShop: async (entity, id) => {
      const { data, error } = await service
        .from(tableForEntity(entity))
        .select('shop_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error('entity ownership lookup failed');
      return data?.shop_id ?? null;
    },

    applyAtomicCommand: async (userId: string, request: CatalogAdminCommandV1) => {
      const { data, error } = await service.rpc('apply_catalog_admin_command_v1', {
        p_auth_user_id: userId,
        p_shop_id: request.shopId,
        p_command_id: request.commandId,
        p_command: request.command,
      });
      if (error || typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false as const, code: 'command_failed' as const };
      }
      const record = data as Record<string, unknown>;
      if (typeof record.errorCode === 'string') {
        const code = CATALOG_ERROR_CODES.includes(record.errorCode as CatalogErrorCodeV1)
          ? (record.errorCode as CatalogErrorCodeV1)
          : 'command_failed';
        return { ok: false as const, code };
      }
      return { ok: true as const, result: record };
    },

    createSignedImageUpload: async (imageKey) => {
      const { data, error } = await service.storage.from(IMAGE_BUCKET).createSignedUploadUrl(imageKey, {
        upsert: false,
      });
      if (error || !data?.signedUrl || !data?.token) throw new Error('signed image upload creation failed');
      return { signedUrl: data.signedUrl, token: data.token };
    },

    imageObjectExists: async (imageKey) => {
      const slash = imageKey.indexOf('/');
      if (slash <= 0 || slash === imageKey.length - 1) return false;
      const folder = imageKey.slice(0, slash);
      const filename = imageKey.slice(slash + 1);
      const { data, error } = await service.storage.from(IMAGE_BUCKET).list(folder, {
        limit: 2,
        search: filename,
      });
      if (error) throw new Error('image object lookup failed');
      return (data ?? []).some((entry) => entry.name === filename);
    },

    countImageReferences: async (imageKey) => {
      const { count, error } = await service
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('image_key', imageKey);
      if (error) throw new Error('image reference lookup failed');
      return count ?? 0;
    },

    removeImageObject: async (imageKey) => {
      const { error } = await service.storage.from(IMAGE_BUCKET).remove([imageKey]);
      if (error) throw new Error('image cleanup failed');
    },
  };
}

function createDependencies(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
): CatalogAdminDependencies {
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    authenticate: async (token) => {
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    },
    store: createStore(service),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return unavailable();

  return await handleCatalogAdminRequest(
    request,
    createDependencies(supabaseUrl, anonKey, serviceRoleKey),
  );
});
