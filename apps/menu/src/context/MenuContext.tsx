import type { PublicCatalogShopV2 } from '@tux/catalog-contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchPublicCatalog } from '@/lib/catalog-public';
import {
  projectPublishedCheckoutPolicy,
  type PublishedCheckoutPolicy,
} from '@/lib/published-checkout-policy';
import {
  projectPublicCatalog,
  type MenuExtraOption,
  type MenuModifier,
  type SupabaseProduct,
  type SupabaseSection,
} from './menuProjection';

export type {
  MenuExtraOption,
  MenuModifier,
  ProductSection,
  SupabaseProduct,
  SupabaseSection,
} from './menuProjection';

interface MenuContextValue {
  sections: SupabaseSection[];
  products: SupabaseProduct[];
  modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  extrasByProduct: Readonly<Record<string, readonly MenuExtraOption[]>>;
  comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;
  shop: PublicCatalogShopV2 | null;
  checkoutPolicy: PublishedCheckoutPolicy | null;
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
  const [extrasByProduct, setExtrasByProduct] = useState<
    Readonly<Record<string, readonly MenuExtraOption[]>>
  >({});
  const [comboBeveragesByProduct, setComboBeveragesByProduct] = useState<
    Readonly<Record<string, readonly SupabaseProduct[]>>
  >({});
  const [shop, setShop] = useState<PublicCatalogShopV2 | null>(null);
  const [checkoutPolicy, setCheckoutPolicy] = useState<PublishedCheckoutPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await fetchPublicCatalog();
      const projection = projectPublicCatalog(snapshot);
      setSections([...projection.sections]);
      setProducts([...projection.products]);
      setModifiersByProduct(projection.modifiersByProduct);
      setExtrasByProduct(projection.extrasByProduct);
      setComboBeveragesByProduct(projection.comboBeveragesByProduct);
      if (snapshot.schemaVersion === 2) {
        setShop(snapshot.shop);
        setCheckoutPolicy(projectPublishedCheckoutPolicy(snapshot.ordering));
      } else {
        // V1 is a browse-only rollout fallback. Never synthesize permissive checkout defaults.
        setShop(null);
        setCheckoutPolicy(null);
      }
    } catch (cause) {
      console.error('Failed to load canonical public catalog', cause);
      setSections([]);
      setProducts([]);
      setModifiersByProduct({});
      setExtrasByProduct({});
      setComboBeveragesByProduct({});
      setShop(null);
      setCheckoutPolicy(null);
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
      extrasByProduct,
      comboBeveragesByProduct,
      shop,
      checkoutPolicy,
      loading,
      error,
      refreshMenu,
    }),
    [
      sections,
      products,
      modifiersByProduct,
      extrasByProduct,
      comboBeveragesByProduct,
      shop,
      checkoutPolicy,
      loading,
      error,
      refreshMenu,
    ],
  );

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  const context = useContext(MenuContext);
  if (!context) throw new Error('useMenu must be used within MenuProvider');
  return context;
}
