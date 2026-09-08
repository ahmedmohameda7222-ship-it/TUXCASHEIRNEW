import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchPublicCatalog } from '@/lib/catalog-public';
import {
  projectPublicCatalog,
  type MenuModifier,
  type SupabaseProduct,
  type SupabaseSection,
} from './menuProjection';

export type { MenuModifier, ProductSection, SupabaseProduct, SupabaseSection } from './menuProjection';

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
      const projection = projectPublicCatalog(snapshot);
      setSections([...projection.sections]);
      setProducts([...projection.products]);
      setModifiersByProduct(projection.modifiersByProduct);
      setComboBeveragesByProduct(projection.comboBeveragesByProduct);
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
