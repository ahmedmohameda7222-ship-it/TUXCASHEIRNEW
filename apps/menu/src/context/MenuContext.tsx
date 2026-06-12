import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS as fallbackProducts, CATEGORIES as fallbackCategories, Product } from "@/lib/menu-data";

export interface ProductSection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sort_order: number;
  is_active: boolean;
}

export interface SupabaseProduct extends Omit<Product, 'category_id' | 'is_available'> {
  section_id: string;
  image_path?: string;
  is_active: boolean;
}

interface MenuContextType {
  sections: ProductSection[];
  products: SupabaseProduct[];
  loading: boolean;
  error: string | null;
  refreshMenu: () => Promise<void>;
}

const MenuContext = createContext<MenuContextType | undefined>(undefined);

export function MenuProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<ProductSection[]>(
    fallbackCategories.map(c => ({ ...c, is_active: true }))
  );
  
  const [products, setProducts] = useState<SupabaseProduct[]>(
    fallbackProducts.map(({ category_id, is_available, ...product }) => ({
      ...product,
      section_id: category_id,
      is_active: is_available,
    }))
  );
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMenu = async () => {
    if (!supabase) {
      setLoading(false);
      return; // Use fallbacks if no supabase
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch active sections
      const { data: sectionsData, error: sectionsError } = await supabase
        .from('product_sections')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (sectionsError) throw sectionsError;

      // Fetch active products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (productsError) throw productsError;

      if (sectionsData && sectionsData.length > 0) {
        setSections(sectionsData);
      }
      
      if (productsData && productsData.length > 0) {
        setProducts(productsData);
      }
    } catch (err: any) {
      console.error("Error fetching menu data:", err);
      setError(err.message || "Failed to load menu");
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
