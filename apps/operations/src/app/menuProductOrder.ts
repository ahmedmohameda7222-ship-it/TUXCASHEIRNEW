import type { MenuCategoryId, Product, ProductId, WorkerUiPreferences } from '@tux/domain';

export function reconcileProductOrder(
  products: readonly Product[],
  preference: WorkerUiPreferences | null,
): readonly Product[] {
  const canonical = products
    .filter((product) => product.active)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (preference === null || preference.productOrder.length === 0) return canonical;

  const byId = new Map(canonical.map((product) => [product.id, product]));
  const reconciled: Product[] = [];
  const seen = new Set<ProductId>();

  for (const productId of preference.productOrder) {
    const product = byId.get(productId);
    if (product === undefined || seen.has(productId)) continue;
    reconciled.push(product);
    seen.add(productId);
  }

  for (const product of canonical) {
    if (seen.has(product.id)) continue;
    reconciled.push(product);
    seen.add(product.id);
  }

  return reconciled;
}

export function moveProductWithinCategory(
  order: readonly ProductId[],
  categoryProductIds: readonly ProductId[],
  sourceId: ProductId,
  targetId: ProductId,
): readonly ProductId[] {
  if (sourceId === targetId) return order;

  const categorySet = new Set(categoryProductIds);
  if (!categorySet.has(sourceId) || !categorySet.has(targetId)) return order;

  const categoryOrder = order.filter((productId) => categorySet.has(productId));
  const sourceIndex = categoryOrder.indexOf(sourceId);
  const targetIndex = categoryOrder.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return order;

  const reorderedCategory = categoryOrder.slice();
  const [moved] = reorderedCategory.splice(sourceIndex, 1);
  if (moved === undefined) return order;
  reorderedCategory.splice(targetIndex, 0, moved);

  let categoryIndex = 0;
  return order.map((productId) => {
    if (!categorySet.has(productId)) return productId;
    const replacement = reorderedCategory[categoryIndex];
    categoryIndex += 1;
    return replacement ?? productId;
  });
}

export function filterProductsForMenu(
  products: readonly Product[],
  options: {
    readonly selectedCategoryId: MenuCategoryId | null;
    readonly selectedFamily: string | null;
    readonly search: string;
  },
  preference: WorkerUiPreferences | null = null,
): readonly Product[] {
  const ordered = reconcileProductOrder(products, preference);
  const query = options.search.trim().toLocaleLowerCase();

  if (query.length > 0) {
    return ordered.filter((product) => product.name.toLocaleLowerCase().includes(query));
  }

  if (options.selectedCategoryId === null) return [];

  return ordered
    .filter((product) => product.categoryId === options.selectedCategoryId)
    .filter(
      (product) => options.selectedFamily === null || product.family === options.selectedFamily,
    );
}
