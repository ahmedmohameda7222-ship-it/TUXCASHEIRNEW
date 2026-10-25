import type {
  CatalogCategorySummary,
  CatalogJsonObject,
  CatalogJsonValue,
  CatalogProductDetail,
} from '@tux/admin-contracts';

export type CatalogBulkPatch =
  | { kind: 'price.fixed'; priceMinor: number }
  | { kind: 'price.adjust'; deltaMinor: number }
  | { kind: 'price.percentage'; percentage: number }
  | { kind: 'category.assign'; categoryId: string }
  | { kind: 'archive'; archived: boolean }
  | { kind: 'bestSeller'; enabled: boolean }
  | { kind: 'sortOrder.adjust'; delta: number };

export type CatalogBulkPreviewRow = {
  before: CatalogProductDetail;
  after: CatalogProductDetail;
};

export class CatalogBulkEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogBulkEditError';
  }
}

function isRecord(value: unknown): value is CatalogJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new CatalogBulkEditError('All selected products must have valid, non-negative prices.');
  return value;
}

function patchProduct(
  product: CatalogProductDetail,
  patch: CatalogBulkPatch,
  categories: readonly CatalogCategorySummary[],
  shopId: string,
): CatalogProductDetail {
  switch (patch.kind) {
    case 'price.fixed':
      return { ...product, priceMinor: safeMinor(patch.priceMinor) };
    case 'price.adjust':
      if (!Number.isSafeInteger(patch.deltaMinor))
        throw new CatalogBulkEditError('Fixed adjustment must use whole minor units.');
      return { ...product, priceMinor: safeMinor(product.priceMinor + patch.deltaMinor) };
    case 'price.percentage':
      if (
        !Number.isFinite(patch.percentage) ||
        patch.percentage < -100 ||
        patch.percentage > 1000
      ) {
        throw new CatalogBulkEditError('Percentage must be between -100 and 1000.');
      }
      return {
        ...product,
        priceMinor: safeMinor(Math.round(product.priceMinor * (1 + patch.percentage / 100))),
      };
    case 'category.assign': {
      if (
        !categories.some(
          (category) =>
            category.id === patch.categoryId && category.shopId === shopId && category.active,
        )
      ) {
        throw new CatalogBulkEditError('Selected category is not active in this shop.');
      }
      return { ...product, categoryId: patch.categoryId };
    }
    case 'archive':
      if (typeof patch.archived !== 'boolean')
        throw new CatalogBulkEditError('Invalid archive state.');
      return { ...product, active: !patch.archived };
    case 'bestSeller':
      if (typeof patch.enabled !== 'boolean')
        throw new CatalogBulkEditError('Invalid best-seller state.');
      return { ...product, bestSeller: patch.enabled };
    case 'sortOrder.adjust':
      if (!Number.isSafeInteger(patch.delta))
        throw new CatalogBulkEditError('Sort-order adjustment must be a whole number.');
      const nextOrder = product.sortOrder + patch.delta;
      if (!Number.isSafeInteger(nextOrder) || nextOrder < 0)
        throw new CatalogBulkEditError('Sort order cannot be negative or overflow.');
      return { ...product, sortOrder: nextOrder };
  }
}

export function previewCatalogBulkEdit(
  products: readonly CatalogProductDetail[],
  shopId: string,
  selectedIds: readonly string[],
  patch: CatalogBulkPatch,
  categories: readonly CatalogCategorySummary[],
): CatalogBulkPreviewRow[] {
  if (!shopId || selectedIds.length === 0 || selectedIds.length > 100) {
    throw new CatalogBulkEditError('Select 1–100 products from one shop.');
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new CatalogBulkEditError('The product selection contains duplicate IDs.');
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  if (byId.size !== products.length)
    throw new CatalogBulkEditError('Duplicate products in bundle.');
  return selectedIds.map((id) => {
    const before = byId.get(id);
    if (!before || before.shopId !== shopId)
      throw new CatalogBulkEditError('A selected product is missing or belongs to another shop.');
    const after = patchProduct(before, patch, categories, shopId);
    return { before, after };
  });
}

function readSnapshotProduct(value: CatalogJsonValue): CatalogProductDetail {
  if (!isRecord(value)) throw new CatalogBulkEditError('Invalid catalog snapshot.');
  const {
    id,
    shopId,
    categoryId,
    name,
    slug,
    description,
    priceMinor,
    imageKey,
    family,
    bestSeller,
    active,
    soldOut,
    isCombo,
    sortOrder,
  } = value;
  if (
    typeof id !== 'string' ||
    typeof shopId !== 'string' ||
    typeof categoryId !== 'string' ||
    typeof name !== 'string' ||
    typeof priceMinor !== 'number' ||
    typeof sortOrder !== 'number' ||
    typeof bestSeller !== 'boolean' ||
    typeof active !== 'boolean' ||
    typeof soldOut !== 'boolean' ||
    typeof isCombo !== 'boolean'
  ) {
    throw new CatalogBulkEditError('Invalid catalog product in saved draft.');
  }
  return {
    id,
    shopId,
    categoryId,
    name,
    slug: typeof slug === 'string' ? slug : null,
    description: typeof description === 'string' ? description : null,
    priceMinor,
    imageKey: typeof imageKey === 'string' ? imageKey : null,
    family: typeof family === 'string' ? family : null,
    bestSeller,
    active,
    soldOut,
    isCombo,
    sortOrder,
  };
}

export function stageCatalogBulkEditBundle(
  bundleJson: CatalogJsonObject,
  shopId: string,
  selectedIds: readonly string[],
  patch: CatalogBulkPatch,
  categories: readonly CatalogCategorySummary[],
): {
  bundleJson: CatalogJsonObject;
  preview: CatalogBulkPreviewRow[];
  changedPaths: string[];
} {
  const snapshot = bundleJson['snapshot'];
  if (!isRecord(snapshot) || !Array.isArray(snapshot['products']))
    throw new CatalogBulkEditError('Draft has no valid catalog product snapshot.');
  const originalRows = snapshot['products'];
  const products = originalRows.map(readSnapshotProduct);
  const preview = previewCatalogBulkEdit(products, shopId, selectedIds, patch, categories);
  const edits = new Map(preview.map(({ after }) => [after.id, after]));
  const nextProducts = originalRows.map((value) => {
    if (!isRecord(value)) throw new CatalogBulkEditError('Invalid catalog product in snapshot.');
    const id = value['id'];
    const edited = typeof id === 'string' ? edits.get(id) : undefined;
    return edited ? { ...value, ...edited } : value;
  });
  const changedField =
    patch.kind === 'price.fixed' ||
    patch.kind === 'price.adjust' ||
    patch.kind === 'price.percentage'
      ? 'priceMinor'
      : patch.kind === 'category.assign'
        ? 'categoryId'
        : patch.kind === 'archive'
          ? 'active'
          : patch.kind === 'bestSeller'
            ? 'bestSeller'
            : 'sortOrder';

  return {
    bundleJson: { ...bundleJson, snapshot: { ...snapshot, products: nextProducts } },
    preview,
    changedPaths: ['products', `products[].${changedField}`],
  };
}
