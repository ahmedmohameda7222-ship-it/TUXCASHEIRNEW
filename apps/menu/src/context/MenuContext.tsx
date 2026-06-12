import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS as fallbackProducts, CATEGORIES as fallbackCategories, Product } from "@/lib/menu-data";
import { EXTRA_CATEGORY, EXTRA_PRODUCTS } from "@/lib/default-extras";

export interface ProductSection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sort_order: number;
  is_active: boolean;
  is_fallback?: boolean;
}

export interface SupabaseProduct extends Omit<Product, 'category_id' | 'is_available'> {
  section_id: string;
  image_path?: string;
  is_active: boolean;
  is_fallback?: boolean;
}

interface MenuContextType {
  sections: ProductSection[];
  products: SupabaseProduct[];
  loading: boolean;
  error: string | null;
  refreshMenu: () => Promise<void>;
}

const defaultSections: ProductSection[] = [...fallbackCategories, EXTRA_CATEGORY].map((category) => ({
  ...category,
  is_active: true,
  is_fallback: true,
}));

const defaultProducts: SupabaseProduct[] = [...fallbackProducts, ...EXTRA_PRODUCTS].map(({ category_id, is_available, ...product }) => ({
  ...product,
  section_id: category_id,
  is_active: is_available,
  is_fallback: true,
}));

const mergeSections = (remoteSections: ProductSection[] = []) => {
  const remoteIds = new Set(remoteSections.map((section) => section.id));
  return [
    ...remoteSections.map((section) => ({ ...section, is_fallback: false })),
    ...defaultSections.filter((section) => !remoteIds.has(section.id)),
  ].sort((a, b) => a.sort_order - b.sort_order);
};

const mergeProducts = (remoteProducts: SupabaseProduct[] = []) => {
  const remoteIds = new Set(remoteProducts.map((product) => product.id));
  return [
    ...remoteProducts.map((product) => ({ ...product, is_fallback: false })),
    ...defaultProducts.filter((product) => !remoteIds.has(product.id)),
  ].sort((a, b) => a.sort_order - b.sort_order);
};

const MenuContext = createContext<MenuContextType | undefined>(undefined);

export function MenuProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<ProductSection[]>(defaultSections);
  const [products, setProducts] = useState<SupabaseProduct[]>(defaultProducts);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMenu = async () => {
    if (!supabase) {
      setSections(defaultSections);
      setProducts(defaultProducts);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: sectionsData, error: sectionsError } = await supabase
        .from('product_sections')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (sectionsError) throw sectionsError;

      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (productsError) throw productsError;

      setSections(mergeSections(sectionsData || []));
      setProducts(mergeProducts(productsData || []));
    } catch (err: any) {
      console.error("Error fetching menu data:", err);
      setError(err.message || "Failed to load menu");
      setSections(defaultSections);
      setProducts(defaultProducts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenu();
  }, []);

  return (
    <MenuContext.Provider value={{ sections, products, loading, error, refreshMenu: fetchMenu }}>
      {children}
    </MenuContext.Provider>
  );
}

export function useMenu() {
  const context = useContext(MenuContext);
  if (context === undefined) {
    throw new Error("useMenu must be used within a MenuProvider");
  }
  return context;
}
