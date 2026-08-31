import {
  parseEntityId,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from './ids';
import type { MenuCategory, Product } from './catalog';
import { instant, type Instant } from './time';
import type { CategoryAlignment } from './workerUiPreferences';

export type WorkerMenuLayoutSyncState = 'CLEAN' | 'DIRTY';
export type ProductOrderByCategory = Readonly<
  Partial<Record<MenuCategoryId, readonly ProductId[]>>
>;

export interface WorkerMenuLayout {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrderByCategory: ProductOrderByCategory;
  readonly layoutVersion: number;
  readonly updatedAt: Instant;
  readonly syncState: WorkerMenuLayoutSyncState;
}

export interface WorkerMenuLayoutUpdate {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrderByCategory: ProductOrderByCategory;
}

export interface WorkerMenuLayoutCatalog {
  readonly categories: readonly MenuCategory[];
  readonly products: readonly Product[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function alignment(value: unknown): CategoryAlignment {
  if (value !== 'left' && value !== 'center' && value !== 'right') {
    throw new TypeError('WorkerMenuLayout.categoryAlignment is invalid.');
  }
  return value;
}

function syncState(value: unknown): WorkerMenuLayoutSyncState {
  if (value !== 'CLEAN' && value !== 'DIRTY') {
    throw new TypeError('WorkerMenuLayout.syncState is invalid.');
  }
  return value;
}

function parseCategoryOrder(value: unknown): readonly MenuCategoryId[] {
  if (!Array.isArray(value)) {
    throw new TypeError('WorkerMenuLayout.categoryOrder must be an array.');
  }
  const parsed = value.map((raw, index) => {
    try {
      return parseEntityId<MenuCategoryId>(text(raw, `WorkerMenuLayout.categoryOrder[${index}]`));
    } catch (cause) {
      throw new TypeError(`WorkerMenuLayout.categoryOrder[${index}] is invalid.`, { cause });
    }
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError('WorkerMenuLayout.categoryOrder must not contain duplicate category IDs.');
  }
  return parsed;
}

function parseProductOrderByCategory(value: unknown): ProductOrderByCategory {
  const source = record(value, 'WorkerMenuLayout.productOrderByCategory');
  const result: Partial<Record<MenuCategoryId, readonly ProductId[]>> = {};
  const productsSeen = new Set<ProductId>();

  for (const [rawCategoryId, rawProducts] of Object.entries(source)) {
    let categoryId: MenuCategoryId;
    try {
      categoryId = parseEntityId<MenuCategoryId>(rawCategoryId);
    } catch (cause) {
      throw new TypeError(
        `WorkerMenuLayout.productOrderByCategory key ${rawCategoryId} is invalid.`,
        { cause },
      );
    }
    if (!Array.isArray(rawProducts)) {
      throw new TypeError(
        `WorkerMenuLayout.productOrderByCategory.${rawCategoryId} must be an array.`,
      );
    }
    const categoryProducts = rawProducts.map((rawProductId, index) => {
      let productId: ProductId;
      try {
        productId = parseEntityId<ProductId>(
          text(
            rawProductId,
            `WorkerMenuLayout.productOrderByCategory.${rawCategoryId}[${index}]`,
          ),
        );
      } catch (cause) {
        throw new TypeError(
          `WorkerMenuLayout.productOrderByCategory.${rawCategoryId}[${index}] is invalid.`,
          { cause },
        );
      }
      if (productsSeen.has(productId)) {
        throw new TypeError(
          `WorkerMenuLayout.productOrderByCategory must not contain product ${productId} more than once.`,
        );
      }
      productsSeen.add(productId);
      return productId;
    });
    result[categoryId] = categoryProducts;
  }

  return result;
}

export function parseWorkerMenuLayout(value: unknown): WorkerMenuLayout {
  const source = record(value, 'WorkerMenuLayout');
  const layoutVersion = source['layoutVersion'];
  if (
    typeof layoutVersion !== 'number' ||
    !Number.isSafeInteger(layoutVersion) ||
    layoutVersion < 0
  ) {
    throw new TypeError('WorkerMenuLayout.layoutVersion must be a non-negative safe integer.');
  }

  try {
    return {
      shopId: parseEntityId<ShopId>(text(source['shopId'], 'WorkerMenuLayout.shopId')),
      workerId: parseEntityId<WorkerId>(text(source['workerId'], 'WorkerMenuLayout.workerId')),
      categoryOrder: parseCategoryOrder(source['categoryOrder']),
      categoryAlignment: alignment(source['categoryAlignment']),
      productOrderByCategory: parseProductOrderByCategory(source['productOrderByCategory']),
      layoutVersion,
      updatedAt: instant(text(source['updatedAt'], 'WorkerMenuLayout.updatedAt')),
      syncState: syncState(source['syncState']),
    };
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith('WorkerMenuLayout.')) throw cause;
    throw new TypeError('WorkerMenuLayout is invalid.', { cause });
  }
}

function sameIds<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameWorkerMenuLayoutSnapshot(
  left: WorkerMenuLayout | null,
  right: WorkerMenuLayout | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.shopId !== right.shopId ||
    left.workerId !== right.workerId ||
    !sameIds(left.categoryOrder, right.categoryOrder) ||
    left.categoryAlignment !== right.categoryAlignment ||
    left.layoutVersion !== right.layoutVersion ||
    left.updatedAt !== right.updatedAt ||
    left.syncState !== right.syncState
  ) {
    return false;
  }
  const leftKeys = Object.keys(left.productOrderByCategory).sort();
  const rightKeys = Object.keys(right.productOrderByCategory).sort();
  if (!sameIds(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => {
    const categoryId = key as MenuCategoryId;
    return sameIds(
      left.productOrderByCategory[categoryId] ?? [],
      right.productOrderByCategory[categoryId] ?? [],
    );
  });
}

function activeCatalog(catalog: WorkerMenuLayoutCatalog) {
  const categories = catalog.categories
    .filter((category) => category.active)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const categoryIds = new Set(categories.map((category) => category.id));
  const products = catalog.products
    .filter((product) => product.active && categoryIds.has(product.categoryId))
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  return { categories, products, categoryIds };
}

export function reconcileWorkerMenuLayout(
  layout: WorkerMenuLayout,
  catalog: WorkerMenuLayoutCatalog,
): WorkerMenuLayout {
  const active = activeCatalog(catalog);
  const categoriesById = new Map(active.categories.map((category) => [category.id, category]));
  const productsById = new Map(active.products.map((product) => [product.id, product]));
  const categoryOrder: MenuCategoryId[] = [];
  const seenCategories = new Set<MenuCategoryId>();

  for (const categoryId of layout.categoryOrder) {
    if (!categoriesById.has(categoryId) || seenCategories.has(categoryId)) continue;
    categoryOrder.push(categoryId);
    seenCategories.add(categoryId);
  }
  for (const category of active.categories) {
    if (seenCategories.has(category.id)) continue;
    categoryOrder.push(category.id);
    seenCategories.add(category.id);
  }

  const productOrderByCategory: Partial<Record<MenuCategoryId, readonly ProductId[]>> = {};
  for (const categoryId of categoryOrder) {
    const ordered: ProductId[] = [];
    const seenProducts = new Set<ProductId>();
    for (const productId of layout.productOrderByCategory[categoryId] ?? []) {
      const product = productsById.get(productId);
      if (product === undefined || product.categoryId !== categoryId || seenProducts.has(productId)) {
        continue;
      }
      ordered.push(productId);
      seenProducts.add(productId);
    }
    for (const product of active.products) {
      if (product.categoryId !== categoryId || seenProducts.has(product.id)) continue;
      ordered.push(product.id);
      seenProducts.add(product.id);
    }
    productOrderByCategory[categoryId] = ordered;
  }

  return parseWorkerMenuLayout({
    ...layout,
    categoryOrder,
    productOrderByCategory,
  });
}

export function normalizeWorkerMenuLayoutUpdate(input: {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly update: WorkerMenuLayoutUpdate;
  readonly catalog: WorkerMenuLayoutCatalog;
  readonly layoutVersion: number;
  readonly updatedAt: Instant;
  readonly syncState: WorkerMenuLayoutSyncState;
}): WorkerMenuLayout {
  const candidate = parseWorkerMenuLayout({
    shopId: input.shopId,
    workerId: input.workerId,
    categoryOrder: input.update.categoryOrder,
    categoryAlignment: input.update.categoryAlignment,
    productOrderByCategory: input.update.productOrderByCategory,
    layoutVersion: input.layoutVersion,
    updatedAt: input.updatedAt,
    syncState: input.syncState,
  });

  const products = new Map(input.catalog.products.map((product) => [product.id, product]));
  for (const [rawCategoryId, productIds] of Object.entries(candidate.productOrderByCategory)) {
    const categoryId = rawCategoryId as MenuCategoryId;
    for (const productId of productIds ?? []) {
      const product = products.get(productId);
      if (product?.active === true && product.categoryId !== categoryId) {
        throw new TypeError(
          `WorkerMenuLayout product ${productId} belongs to category ${product.categoryId}, not ${categoryId}.`,
        );
      }
    }
  }

  return reconcileWorkerMenuLayout(candidate, input.catalog);
}

export function flattenWorkerMenuLayoutProductOrder(
  layout: WorkerMenuLayout,
): readonly ProductId[] {
  const result: ProductId[] = [];
  const categoriesSeen = new Set<MenuCategoryId>();
  for (const categoryId of layout.categoryOrder) {
    categoriesSeen.add(categoryId);
    result.push(...(layout.productOrderByCategory[categoryId] ?? []));
  }
  for (const rawCategoryId of Object.keys(layout.productOrderByCategory).sort()) {
    const categoryId = rawCategoryId as MenuCategoryId;
    if (categoriesSeen.has(categoryId)) continue;
    result.push(...(layout.productOrderByCategory[categoryId] ?? []));
  }
  return result;
}
