export interface PublicCategoryIdentity {
  id: string;
  slug: string;
}

export interface PublicProductIdentity {
  id: string;
  categoryId: string;
  slug: string;
}

export interface PublicCatalogIdentityManifest {
  version: 1;
  shopId: string;
  categoryCount: number;
  productCount: number;
  categories: PublicCategoryIdentity[];
  products: PublicProductIdentity[];
}

export interface PublicIdentityInventory {
  categoryIds: readonly string[];
  products: readonly { readonly id: string; readonly categoryId: string }[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value) || value !== value.toLowerCase()) {
    throw new Error(`${label} must be a lowercase UUID`);
  }
}

function assertSlug(value: string, label: string): void {
  if (!SLUG_PATTERN.test(value)) throw new Error(`${label} has an invalid slug`);
}

function assertUnique(
  rows: readonly { readonly id: string; readonly slug: string }[],
  entity: 'category' | 'product',
): void {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`duplicate ${entity} UUID: ${row.id}`);
    if (slugs.has(row.slug)) throw new Error(`duplicate ${entity} slug: ${row.slug}`);
    ids.add(row.id);
    slugs.add(row.slug);
  }
}

export function validatePublicIdentityManifest(manifest: PublicCatalogIdentityManifest): void {
  if (manifest.version !== 1) throw new Error('unsupported public identity manifest version');
  assertUuid(manifest.shopId, 'shopId');

  if (
    manifest.categoryCount !== manifest.categories.length ||
    manifest.productCount !== manifest.products.length
  ) {
    throw new Error('public identity declared count parity failed');
  }

  assertUnique(manifest.categories, 'category');
  assertUnique(manifest.products, 'product');

  const categoryIds = new Set<string>();
  for (const category of manifest.categories) {
    assertUuid(category.id, 'category UUID');
    assertSlug(category.slug, `category ${category.id}`);
    categoryIds.add(category.id);
  }

  for (const product of manifest.products) {
    assertUuid(product.id, 'product UUID');
    assertUuid(product.categoryId, 'product category UUID');
    assertSlug(product.slug, `product ${product.id}`);
    if (!categoryIds.has(product.categoryId)) {
      throw new Error(`product ${product.id} references an unknown category UUID`);
    }
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function assertPublicIdentityInventory(
  manifest: PublicCatalogIdentityManifest,
  inventory: PublicIdentityInventory,
): void {
  validatePublicIdentityManifest(manifest);

  const manifestCategoryIds = sorted(manifest.categories.map((row) => row.id));
  const inventoryCategoryIds = sorted(inventory.categoryIds);
  const manifestProducts = sorted(manifest.products.map((row) => `${row.id}:${row.categoryId}`));
  const inventoryProducts = sorted(inventory.products.map((row) => `${row.id}:${row.categoryId}`));

  if (
    manifestCategoryIds.length !== inventoryCategoryIds.length ||
    manifestProducts.length !== inventoryProducts.length ||
    manifestCategoryIds.some((value, index) => value !== inventoryCategoryIds[index]) ||
    manifestProducts.some((value, index) => value !== inventoryProducts[index])
  ) {
    throw new Error('public identity inventory does not match the approved canonical UUID sets');
  }
}
