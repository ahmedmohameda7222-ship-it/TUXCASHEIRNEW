import {
  CatalogContractError,
  isCanonicalUuid,
  isShopScopedImageKey,
  parseCatalogAdminCommandV1,
  type CatalogAdminCommandV1,
  type CatalogErrorCodeV1,
} from '../../../packages/catalog-contracts/src/index.ts';

export type CatalogAdminRole = 'OWNER' | 'ADMIN' | 'OPERATIONS_DEVICE';
export type CatalogAdminEntity = 'category' | 'product' | 'modifier';

export interface CatalogAdminStore {
  readonly getMembership: (
    userId: string,
    shopId: string,
  ) => Promise<{ readonly role: CatalogAdminRole; readonly active: boolean } | null>;
  readonly getEntityShop: (entity: CatalogAdminEntity, id: string) => Promise<string | null>;
  readonly hasComboBeverageOptions?: (shopId: string, productId: string) => Promise<boolean>;
  readonly applyAtomicCommand: (
    userId: string,
    request: CatalogAdminCommandV1,
  ) => Promise<
    | { readonly ok: true; readonly result: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly code: CatalogErrorCodeV1 }
  >;
  readonly createSignedImageUpload: (
    imageKey: string,
    contentType: string,
  ) => Promise<{ readonly signedUrl: string; readonly token: string }>;
  readonly imageObjectExists: (imageKey: string) => Promise<boolean>;
  readonly countImageReferences: (imageKey: string) => Promise<number>;
  readonly removeImageObject: (imageKey: string) => Promise<void>;
}

export interface CatalogAdminDependencies {
  readonly authenticate: (bearerToken: string) => Promise<string | null>;
  readonly store: CatalogAdminStore;
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'x-content-type-options': 'nosniff',
} as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function errorStatus(code: CatalogErrorCodeV1): number {
  switch (code) {
    case 'invalid_request':
    case 'invalid_shop_id':
      return 400;
    case 'authentication_required':
    case 'invalid_identity':
      return 401;
    case 'membership_required':
    case 'membership_inactive':
    case 'role_forbidden':
    case 'cross_shop_forbidden':
    case 'image_key_forbidden':
      return 403;
    case 'entity_not_found':
      return 404;
    case 'command_conflict':
      return 409;
    case 'catalog_unavailable':
    case 'storage_failed':
      return 503;
    default:
      return 500;
  }
}

function errorResponse(code: CatalogErrorCodeV1): Response {
  return jsonResponse(errorStatus(code), { schemaVersion: 1, error: { code } });
}

function successResponse(commandId: string, result: Readonly<Record<string, unknown>>): Response {
  return jsonResponse(200, { schemaVersion: 1, commandId, ok: true, result });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

async function ensureEntity(
  store: CatalogAdminStore,
  shopId: string,
  entity: CatalogAdminEntity,
  id: string,
): Promise<CatalogErrorCodeV1 | null> {
  const entityShop = await store.getEntityShop(entity, id);
  if (entityShop === null) return 'entity_not_found';
  return entityShop === shopId ? null : 'cross_shop_forbidden';
}

async function ensureNewEntity(
  store: CatalogAdminStore,
  shopId: string,
  entity: CatalogAdminEntity,
  id: string,
): Promise<CatalogErrorCodeV1 | null> {
  const entityShop = await store.getEntityShop(entity, id);
  if (entityShop === null) return null;
  return entityShop === shopId ? 'command_conflict' : 'cross_shop_forbidden';
}

async function validateImageKey(
  store: CatalogAdminStore,
  shopId: string,
  imageKey: string,
): Promise<CatalogErrorCodeV1 | null> {
  if (!isShopScopedImageKey(shopId, imageKey)) return 'image_key_forbidden';
  return (await store.imageObjectExists(imageKey)) ? null : 'invalid_request';
}

async function preflightCommand(
  request: CatalogAdminCommandV1,
  store: CatalogAdminStore,
): Promise<CatalogErrorCodeV1 | null> {
  const { shopId, command } = request;
  switch (command.type) {
    case 'category.create':
      return await ensureNewEntity(store, shopId, 'category', command.category.id);
    case 'category.update':
    case 'category.retire':
    case 'category.reorder':
      return await ensureEntity(store, shopId, 'category', command.categoryId);
    case 'product.create': {
      const duplicate = await ensureNewEntity(store, shopId, 'product', command.product.id);
      if (duplicate) return duplicate;
      const category = await ensureEntity(store, shopId, 'category', command.product.categoryId);
      if (category) return category;
      if (command.product.imageKey !== null) {
        return await validateImageKey(store, shopId, command.product.imageKey);
      }
      return null;
    }
    case 'product.update': {
      const product = await ensureEntity(store, shopId, 'product', command.productId);
      if (product) return product;
      if (
        command.patch.isCombo === false &&
        store.hasComboBeverageOptions !== undefined &&
        (await store.hasComboBeverageOptions(shopId, command.productId))
      ) {
        return 'command_conflict';
      }
      return null;
    }
    case 'product.retire':
    case 'product.reorder':
      return await ensureEntity(store, shopId, 'product', command.productId);
    case 'product.move': {
      const product = await ensureEntity(store, shopId, 'product', command.productId);
      if (product) return product;
      return await ensureEntity(store, shopId, 'category', command.categoryId);
    }
    case 'modifier.create':
      return await ensureNewEntity(store, shopId, 'modifier', command.modifier.id);
    case 'modifier.update':
    case 'modifier.retire':
      return await ensureEntity(store, shopId, 'modifier', command.modifierId);
    case 'product_modifier_link.set':
    case 'product_modifier_link.remove': {
      const product = await ensureEntity(store, shopId, 'product', command.productId);
      if (product) return product;
      return await ensureEntity(store, shopId, 'modifier', command.modifierId);
    }
    case 'combo_beverage_option.set':
    case 'combo_beverage_option.remove': {
      if (command.comboProductId === command.beverageProductId) return 'invalid_request';
      const combo = await ensureEntity(store, shopId, 'product', command.comboProductId);
      if (combo) return combo;
      return await ensureEntity(store, shopId, 'product', command.beverageProductId);
    }
    case 'image.prepare':
    case 'image.remove':
      return await ensureEntity(store, shopId, 'product', command.productId);
    case 'image.replace': {
      const product = await ensureEntity(store, shopId, 'product', command.productId);
      if (product) return product;
      return await validateImageKey(store, shopId, command.imageKey);
    }
  }
}

async function cleanupPreviousImage(
  store: CatalogAdminStore,
  result: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const previousImageKey = result.previousImageKey;
  const currentImageKey = result.imageKey;
  if (
    typeof previousImageKey !== 'string' ||
    previousImageKey === '' ||
    (typeof currentImageKey === 'string' && currentImageKey === previousImageKey)
  ) {
    return result;
  }

  try {
    const references = await store.countImageReferences(previousImageKey);
    if (references === 0) await store.removeImageObject(previousImageKey);
    return result;
  } catch (error) {
    console.error(
      'catalog-admin image cleanup deferred',
      error instanceof Error ? error.name : 'unknown',
    );
    return { ...result, cleanupPending: true };
  }
}

export async function handleCatalogAdminRequest(
  request: Request,
  dependencies: CatalogAdminDependencies,
): Promise<Response> {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return errorResponse('method_not_allowed');

  const token = bearerToken(request);
  if (token === null) return errorResponse('authentication_required');

  let userId: string | null;
  try {
    userId = await dependencies.authenticate(token);
  } catch (error) {
    console.error(
      'catalog-admin identity lookup failed',
      error instanceof Error ? error.name : 'unknown',
    );
    userId = null;
  }
  if (userId === null || !isCanonicalUuid(userId)) return errorResponse('invalid_identity');

  let parsed: CatalogAdminCommandV1;
  try {
    parsed = parseCatalogAdminCommandV1(await request.json());
  } catch (error) {
    if (!(error instanceof CatalogContractError) && !(error instanceof SyntaxError)) {
      console.error(
        'catalog-admin request parse failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    return errorResponse('invalid_request');
  }

  let membership: Awaited<ReturnType<CatalogAdminStore['getMembership']>>;
  try {
    membership = await dependencies.store.getMembership(userId, parsed.shopId);
  } catch (error) {
    console.error(
      'catalog-admin membership lookup failed',
      error instanceof Error ? error.name : 'unknown',
    );
    return errorResponse('command_failed');
  }
  if (membership === null) return errorResponse('membership_required');
  if (!membership.active) return errorResponse('membership_inactive');
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN')
    return errorResponse('role_forbidden');

  try {
    const preflight = await preflightCommand(parsed, dependencies.store);
    if (preflight !== null) return errorResponse(preflight);

    if (parsed.command.type === 'image.prepare') {
      const imageKey = `${parsed.shopId}/${parsed.commandId}.${parsed.command.fileExtension}`;
      const upload = await dependencies.store.createSignedImageUpload(
        imageKey,
        parsed.command.contentType,
      );
      return successResponse(parsed.commandId, {
        imageKey,
        uploadUrl: upload.signedUrl,
        uploadToken: upload.token,
      });
    }

    const applied = await dependencies.store.applyAtomicCommand(userId, parsed);
    if (!applied.ok) return errorResponse(applied.code);

    const result =
      parsed.command.type === 'image.replace' || parsed.command.type === 'image.remove'
        ? await cleanupPreviousImage(dependencies.store, applied.result)
        : applied.result;
    return successResponse(parsed.commandId, result);
  } catch (error) {
    console.error(
      'catalog-admin command failed',
      error instanceof Error ? error.name : 'unknown',
    );
    return errorResponse('command_failed');
  }
}
