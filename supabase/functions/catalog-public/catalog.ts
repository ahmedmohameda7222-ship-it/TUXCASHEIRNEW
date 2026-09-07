import {
  isCanonicalUuid,
  parsePublicCatalogSnapshotV1,
  type PublicCatalogSnapshotV1,
} from '../../../packages/catalog-contracts/src/index.ts';

type Row = Readonly<Record<string, unknown>>;

export interface PublicCategoryRow extends Row {
  readonly id: string;
  readonly shop_id: string;
  readonly slug: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly sort_order: number;
}

export interface PublicProductRow extends Row {
  readonly id: string;
  readonly shop_id: string;
  readonly category_id: string;
  readonly slug: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly price_minor: number;
  readonly image_key: string | null;
  readonly best_seller: boolean;
  readonly active: boolean;
  readonly sold_out: boolean;
  readonly is_combo: boolean;
  readonly sort_order: number;
}

export interface PublicModifierRow extends Row {
  readonly id: string;
  readonly shop_id: string;
  readonly name: string;
  readonly price_minor: number;
  readonly active: boolean;
  readonly sort_order: number;
}

export interface PublicProductModifierRow extends Row {
  readonly shop_id: string;
  readonly product_id: string;
  readonly modifier_id: string;
  readonly max_quantity: number | null;
  readonly sort_order: number;
}

export interface PublicComboBeverageRow extends Row {
  readonly shop_id: string;
  readonly combo_product_id: string;
  readonly beverage_product_id: string;
  readonly sort_order: number;
}

export interface PublicCatalogStore {
  readonly getShop: (shopId: string) => Promise<{ readonly id: string; readonly active?: boolean } | null>;
  readonly listCategories: (shopId: string) => Promise<readonly PublicCategoryRow[]>;
  readonly listProducts: (shopId: string) => Promise<readonly PublicProductRow[]>;
  readonly listModifiers: (shopId: string) => Promise<readonly PublicModifierRow[]>;
  readonly listProductModifierLinks: (shopId: string) => Promise<readonly PublicProductModifierRow[]>;
  readonly listComboBeverageOptions: (shopId: string) => Promise<readonly PublicComboBeverageRow[]>;
  readonly resolveImageUrl: (imageKey: string | null) => string | null;
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'x-content-type-options': 'nosniff',
} as const;

class CatalogUnavailableError extends Error {}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=30, stale-while-revalidate=30' : 'no-store',
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { schemaVersion: 1, error: { code } });
}

function sortByOrderThenId<T extends { readonly sortOrder: number; readonly id?: string }>(left: T, right: T): number {
  return left.sortOrder - right.sortOrder || (left.id ?? '').localeCompare(right.id ?? '');
}

function requireSameShop(shopId: string, rows: readonly Row[]): void {
  if (rows.some((row) => row.shop_id !== shopId)) {
    throw new Error('catalog store violated shop isolation');
  }
}

function requireSlug(slug: string | null, label: string): string {
  if (slug === null || slug.trim() === '') throw new CatalogUnavailableError(`${label} missing public slug`);
  return slug;
}

function requireMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CatalogUnavailableError(`${label} has invalid money`);
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildPublicCatalogSnapshot(
  shopId: string,
  store: PublicCatalogStore,
): Promise<PublicCatalogSnapshotV1> {
  const [categoryRows, productRows, modifierRows, linkRows, comboRows] = await Promise.all([
    store.listCategories(shopId),
    store.listProducts(shopId),
    store.listModifiers(shopId),
    store.listProductModifierLinks(shopId),
    store.listComboBeverageOptions(shopId),
  ]);

  requireSameShop(shopId, categoryRows);
  requireSameShop(shopId, productRows);
  requireSameShop(shopId, modifierRows);
  requireSameShop(shopId, linkRows);
  requireSameShop(shopId, comboRows);

  const categories = categoryRows
    .map((row) => ({
      id: row.id,
      slug: requireSlug(row.slug, `category ${row.id}`),
      name: row.name,
      description: row.description,
      active: row.active,
      sortOrder: row.sort_order,
    }))
    .sort(sortByOrderThenId);

  const categoryIds = new Set(categories.map((category) => category.id));
  const products = productRows
    .map((row) => {
      if (!categoryIds.has(row.category_id)) {
        throw new CatalogUnavailableError(`product ${row.id} has unknown category`);
      }
      return {
        id: row.id,
        slug: requireSlug(row.slug, `product ${row.id}`),
        categoryId: row.category_id,
        name: row.name,
        description: row.description,
        priceMinor: requireMoney(row.price_minor, `product ${row.id}`),
        imageUrl: store.resolveImageUrl(row.image_key),
        bestSeller: row.best_seller,
        active: row.active,
        soldOut: row.sold_out,
        isCombo: row.is_combo,
        sortOrder: row.sort_order,
      };
    })
    .sort((left, right) =>
      left.categoryId.localeCompare(right.categoryId) || sortByOrderThenId(left, right),
    );

  const productIds = new Set(products.map((product) => product.id));
  const modifiers = modifierRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      priceMinor: requireMoney(row.price_minor, `modifier ${row.id}`),
      active: row.active,
      sortOrder: row.sort_order,
    }))
    .sort(sortByOrderThenId);

  const modifierIds = new Set(modifiers.map((modifier) => modifier.id));
  const productModifierLinks = linkRows
    .map((row) => {
      if (!productIds.has(row.product_id) || !modifierIds.has(row.modifier_id)) {
        throw new CatalogUnavailableError('product modifier link has unknown reference');
      }
      return {
        productId: row.product_id,
        modifierId: row.modifier_id,
        maxQuantity: row.max_quantity,
        sortOrder: row.sort_order,
      };
    })
    .sort((left, right) =>
      left.productId.localeCompare(right.productId) ||
      left.sortOrder - right.sortOrder ||
      left.modifierId.localeCompare(right.modifierId),
    );

  const comboBeverageOptions = comboRows
    .map((row) => {
      if (!productIds.has(row.combo_product_id) || !productIds.has(row.beverage_product_id)) {
        throw new CatalogUnavailableError('combo beverage option has unknown reference');
      }
      return {
        comboProductId: row.combo_product_id,
        beverageProductId: row.beverage_product_id,
        sortOrder: row.sort_order,
      };
    })
    .sort((left, right) =>
      left.comboProductId.localeCompare(right.comboProductId) ||
      left.sortOrder - right.sortOrder ||
      left.beverageProductId.localeCompare(right.beverageProductId),
    );

  const canonicalProjection = {
    schemaVersion: 1 as const,
    shopId,
    categories,
    products,
    modifiers,
    productModifierLinks,
    comboBeverageOptions,
  };
  const revision = await sha256Hex(JSON.stringify(canonicalProjection));
  return parsePublicCatalogSnapshotV1({ ...canonicalProjection, revision });
}

export async function handleCatalogPublicRequest(
  request: Request,
  store: PublicCatalogStore,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'GET') return errorResponse(405, 'method_not_allowed');

  const shopId = new URL(request.url).searchParams.get('shopId')?.trim() ?? '';
  if (!isCanonicalUuid(shopId)) return errorResponse(400, 'invalid_shop_id');

  try {
    const shop = await store.getShop(shopId);
    if (shop === null || shop.active === false) return errorResponse(404, 'shop_not_found');
    if (shop.id !== shopId) throw new Error('catalog store returned different shop');

    const snapshot = await buildPublicCatalogSnapshot(shopId, store);
    return jsonResponse(200, snapshot, { etag: `"${snapshot.revision}"` });
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return errorResponse(503, 'catalog_unavailable');
    console.error('catalog-public read failed', error instanceof Error ? error.name : 'unknown');
    return errorResponse(500, 'catalog_read_failed');
  }
}
