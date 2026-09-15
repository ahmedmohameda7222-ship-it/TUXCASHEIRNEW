import type { PublicCatalogSnapshotV1, PublicCatalogSnapshotV2 } from '@tux/catalog-contracts';

export interface SupabaseSection {
  id: string;
  slug: string;
  name: string;
  description?: string;
  sort_order: number;
  is_active: boolean;
}

export type ProductSection = SupabaseSection;

export interface MenuModifier {
  id: string;
  name: string;
  price_minor: number;
  price: number;
  is_active: boolean;
  max_quantity: number | null;
  sort_order: number;
}

export interface MenuExtraOption {
  id: string;
  name: string;
  price: number;
}

export interface SupabaseProduct {
  id: string;
  slug: string;
  section_id: string;
  name: string;
  description?: string;
  price_minor: number;
  price: number;
  image_url?: string;
  image_path?: string;
  family?: string;
  is_best_seller: boolean;
  is_active: boolean;
  is_sold_out: boolean;
  is_combo: boolean;
  sort_order: number;
}

export interface MenuProjection {
  readonly sections: readonly SupabaseSection[];
  readonly products: readonly SupabaseProduct[];
  readonly modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  readonly extrasByProduct: Readonly<Record<string, readonly MenuExtraOption[]>>;
  readonly comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;
}

export function projectPublicCatalog(
  snapshot: PublicCatalogSnapshotV1 | PublicCatalogSnapshotV2,
): MenuProjection {
  const activeCategoryIds = new Set(
    snapshot.categories.filter((category) => category.active).map((category) => category.id),
  );
  const sections = snapshot.categories
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description ?? undefined,
      sort_order: category.sortOrder,
      is_active: category.active,
    }))
    .sort((left, right) => left.sort_order - right.sort_order);

  const products = snapshot.products
    .map((product) => ({
      id: product.id,
      slug: product.slug,
      section_id: product.categoryId,
      name: product.name,
      description: product.description ?? undefined,
      price_minor: product.priceMinor,
      price: product.priceMinor / 100,
      image_url: product.imageUrl ?? undefined,
      image_path: undefined,
      family: product.family ?? undefined,
      is_best_seller: product.bestSeller,
      is_active: product.active && !product.soldOut && activeCategoryIds.has(product.categoryId),
      is_sold_out: product.soldOut,
      is_combo: product.isCombo,
      sort_order: product.sortOrder,
    }))
    .sort((left, right) => left.sort_order - right.sort_order);

  const modifiersById = new Map(
    snapshot.modifiers.map((modifier) => [modifier.id, modifier] as const),
  );
  const modifiersByProduct: Record<string, MenuModifier[]> = {};
  for (const link of snapshot.productModifierLinks) {
    const modifier = modifiersById.get(link.modifierId);
    if (!modifier?.active) continue;
    (modifiersByProduct[link.productId] ??= []).push({
      id: modifier.id,
      name: modifier.name,
      price_minor: modifier.priceMinor,
      price: modifier.priceMinor / 100,
      is_active: modifier.active,
      max_quantity: link.maxQuantity,
      sort_order: link.sortOrder,
    });
  }
  for (const modifiers of Object.values(modifiersByProduct)) {
    modifiers.sort((left, right) => left.sort_order - right.sort_order);
  }

  const productsById = new Map(products.map((product) => [product.id, product] as const));
  const customerProductAvailable = (
    product: SupabaseProduct | undefined,
  ): product is SupabaseProduct =>
    product !== undefined && product.is_active && activeCategoryIds.has(product.section_id);
  const extrasByProduct: Record<string, MenuExtraOption[]> = {};
  const sortedLinks = [...snapshot.productModifierLinks].sort(
    (left, right) =>
      left.productId.localeCompare(right.productId) ||
      left.sortOrder - right.sortOrder ||
      left.modifierId.localeCompare(right.modifierId),
  );
  for (const link of sortedLinks) {
    const modifier = modifiersById.get(link.modifierId);
    if (!modifier?.active || modifier.standaloneProductId === null) continue;
    const standaloneProduct = productsById.get(modifier.standaloneProductId);
    if (!customerProductAvailable(standaloneProduct)) continue;
    (extrasByProduct[link.productId] ??= []).push({
      id: standaloneProduct.id,
      name: modifier.name,
      price: modifier.priceMinor / 100,
    });
  }
  const comboBeveragesByProduct: Record<string, SupabaseProduct[]> = {};
  for (const option of snapshot.comboBeverageOptions) {
    const beverages = (comboBeveragesByProduct[option.comboProductId] ??= []);
    const beverage = productsById.get(option.beverageProductId);
    if (!customerProductAvailable(beverage)) continue;
    beverages.push(beverage);
  }

  const customerAvailableProducts = products.map((product) => {
    if (!product.is_combo) return product;
    const hasAvailableBeverage = (comboBeveragesByProduct[product.id]?.length ?? 0) > 0;
    return hasAvailableBeverage ? product : { ...product, is_active: false };
  });

  return {
    sections,
    products: customerAvailableProducts,
    modifiersByProduct,
    extrasByProduct,
    comboBeveragesByProduct,
  };
}
