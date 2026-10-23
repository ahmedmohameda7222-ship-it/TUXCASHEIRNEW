import type { PublicCatalogShopV2 } from '@tux/catalog-contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchPublicCatalog } from '@/lib/catalog-public';
import { startMenuRefreshLifecycle } from './menuRefreshLifecycle';
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

  const hasLoadedSnapshotRef = useRef(false);
  const mountedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Promise<void> | null>(null);

  const refreshMenu = useCallback((): Promise<void> => {
    // A timer, focus event, and reconnect can arrive together. Never issue overlapping
    // reads or let an older response roll back a newly published menu.
    if (pendingRef.current) return pendingRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    if (!hasLoadedSnapshotRef.current) setLoading(true);

    const pending = (async () => {
      try {
        const snapshot = await fetchPublicCatalog(controller.signal);
        if (controller.signal.aborted || !mountedRef.current) return;
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
          // V1 is browse-only. Do not invent checkout permissions.
          setShop(null);
          setCheckoutPolicy(null);
        }
        hasLoadedSnapshotRef.current = true;
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted || !mountedRef.current) return;
        console.error('Failed to refresh canonical public catalog', cause);
        // Keep a previously loaded catalog browsable during transient failures,
        // but never allow an order using an unverified old checkout policy.
        if (!hasLoadedSnapshotRef.current) {
          setSections([]);
          setProducts([]);
          setModifiersByProduct({});
          setExtrasByProduct({});
          setComboBeveragesByProduct({});
        }
        setShop(null);
        setCheckoutPolicy(null);
        setError('Menu temporarily unavailable. Please try again.');
      } finally {
        if (!controller.signal.aborted && mountedRef.current) setLoading(false);
      }
    })();

    pendingRef.current = pending;
    void pending.then(() => {
      if (pendingRef.current === pending) {
        pendingRef.current = null;
        controllerRef.current = null;
      }
    });
    return pending;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshMenu();

    const stopRefresh = startMenuRefreshLifecycle(window, document, () => {
      void refreshMenu();
    });

    return () => {
      mountedRef.current = false;
      stopRefresh();
      controllerRef.current?.abort();
      controllerRef.current = null;
      pendingRef.current = null;
    };
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
