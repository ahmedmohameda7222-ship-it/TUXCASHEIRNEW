import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchPublicCatalog } from '@/lib/catalog-public';

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
  is_best_seller: boolean;
  is_active: boolean;
  is_sold_out: boolean;
  is_combo: boolean;
  sort_order: number;
}

interface MenuContextValue {
  sections: SupabaseSection[];
  products: SupabaseProduct[];
  modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;
  loading: boolean;
  error: string | null;
  refreshMenu: () => Promise<void>;
}

const MenuContext = createContext<MenuContextValue | undefined>(undefined);

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const [sections, setSections] = useState<SupabaseSection[]>([]);
  const [products, setProducts] = useState<SupabaseProduct[]>([]);
  const [modifiersByProduct, setModifiersByProduct] = useState<
    Readonly<Record<string, readonly MenuModifier[]>>
  >({});
  const [comboBeveragesByProduct, setComboBeveragesByProduct] = useState<
    Readonly<Record<string, readonly SupabaseProduct[]>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchPublicCatalog();
      const nextSections = snapshot.categories
        .map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
          description: category.description ?? undefined,
          sort_order: category.sortOrder,
          is_active: category.active,
        }))
        .sort((left, right) => left.sort_order - right.sort_order);
      const nextProducts = snapshot.products
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
          is_best_seller: product.bestSeller,
          is_active: product.active && !product.soldOut,
          is_sold_out: product.soldOut,
          is_combo: product.isCombo,
          sort_order: product.sortOrder,
        }))
        .sort((left, right) => left.sort_order - right.sort_order);
      const modifiersById = new Map(
        snapshot.modifiers.map((modifier) => [modifier.id, modifier] as const),
      );
      const nextModifiersByProduct: Record<string, MenuModifier[]> = {};
      for (const link of snapshot.productModifierLinks) {
        const modifier = modifiersById.get(link.modifierId);
        if (!modifier?.active) continue;
        (nextModifiersByProduct[link.productId] ??= []).push({
          id: modifier.id,
          name: modifier.name,
          price_minor: modifier.priceMinor,
          price: modifier.priceMinor / 100,
          is_active: modifier.active,
          max_quantity: link.maxQuantity,
          sort_order: link.sortOrder,
        });
      }
      for (const modifiers of Object.values(nextModifiersByProduct)) {
        modifiers.sort((left, right) => left.sort_order - right.sort_order);
      }
      const productsById = new Map(nextProducts.map((product) => [product.id, product] as const));
      const nextComboBeveragesByProduct: Record<string, SupabaseProduct[]> = {};
      for (const option of snapshot.comboBeverageOptions) {
        const beverage = productsById.get(option.beverageProductId);
        if (!beverage) continue;
        (nextComboBeveragesByProduct[option.comboProductId] ??= []).push(beverage);
      }
      setSections(nextSections);
      setProducts(nextProducts);
      setModifiersByProduct(nextModifiersByProduct);
      setComboBeveragesByProduct(nextComboBeveragesByProduct);
    } catch (cause) {
      console.error('Failed to load canonical public catalog', cause);
      setSections([]);
      setProducts([]);
      setModifiersByProduct({});
      setComboBeveragesByProduct({});
      setError('Menu temporarily unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMenu();
  }, [refreshMenu]);

  const value = useMemo(
    () => ({
      sections,
      products,
      modifiersByProduct,
      comboBeveragesByProduct,
      loading,
      error,
      refreshMenu,
    }),
    [sections, products, modifiersByProduct, comboBeveragesByProduct, loading, error, refreshMenu],
  );

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  const context = useContext(MenuContext);
  if (!context) throw new Error('useMenu must be used within MenuProvider');
  return context;
}
