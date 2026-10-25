import { CatalogImageUploadError } from './catalogImageUpload.js';

export interface CatalogImageProductReader {
  select<T>(table: string, query: URLSearchParams): Promise<T>;
}

type LiveProductRow = { id: string; shop_id: string };
type DraftRow = {
  shop_id: string;
  business_id: string;
  status: string;
  working_bundle_json: unknown;
};

function hasDraftProduct(bundle: unknown, shopId: string, productId: string): boolean {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return false;
  const snapshot = (bundle as Record<string, unknown>)['snapshot'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const products = (snapshot as Record<string, unknown>)['products'];
  return (
    Array.isArray(products) &&
    products.some(
      (product) =>
        product !== null &&
        typeof product === 'object' &&
        !Array.isArray(product) &&
        product.id === productId &&
        product.shopId === shopId,
    )
  );
}

/**
 * Prevent an editor from uploading arbitrary files under invented product IDs.
 * A product must exist in the authorized shop or in a saved draft in that same
 * business and shop. Unsaved new products must be saved before image upload.
 */
export async function assertCatalogImageProductScope(
  client: CatalogImageProductReader,
  input: { businessId: string; shopId: string; productId: string },
): Promise<void> {
  const existing = await client.select<LiveProductRow[]>(
    'products',
    new URLSearchParams({
      select: 'id,shop_id',
      id: `eq.${input.productId}`,
      shop_id: `eq.${input.shopId}`,
      limit: '1',
    }),
  );
  if (existing.some((row) => row.id === input.productId && row.shop_id === input.shopId)) {
    return;
  }

  const drafts = await client.select<DraftRow[]>(
    'catalog_drafts',
    new URLSearchParams({
      select: 'shop_id,business_id,status,working_bundle_json',
      shop_id: `eq.${input.shopId}`,
      business_id: `eq.${input.businessId}`,
      status: 'eq.DRAFT',
      limit: '100',
    }),
  );
  if (
    drafts.some(
      (draft) =>
        draft.shop_id === input.shopId &&
        draft.business_id === input.businessId &&
        draft.status === 'DRAFT' &&
        hasDraftProduct(draft.working_bundle_json, input.shopId, input.productId),
    )
  ) {
    return;
  }
  throw new CatalogImageUploadError('image_product_not_staged');
}
