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
