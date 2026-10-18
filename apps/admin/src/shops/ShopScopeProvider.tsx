import type { AdminSessionPrincipal, ShopScope } from '@tux/admin-contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

export function initialShopScope(principal: AdminSessionPrincipal): ShopScope {
  const firstShop = principal.shopIds[0];
  if (!firstShop) {
    if (principal.role === 'OWNER') return { kind: 'all-shops' };
    throw new Error('no_authorized_shop');
  }
  return { kind: 'shop', shopId: firstShop };
}

export function validateShopScope(principal: AdminSessionPrincipal, scope: ShopScope): ShopScope {
  if (scope.kind === 'all-shops') {
    if (principal.role !== 'OWNER') throw new Error('all_shops_forbidden');
    return scope;
  }
  if (!principal.shopIds.includes(scope.shopId)) throw new Error('shop_forbidden');
  return scope;
}

export function requireConcreteShop(scope: ShopScope): string {
  if (scope.kind !== 'shop') throw new Error('concrete_shop_required');
  return scope.shopId;
}

type ShopScopeContextValue = {
  scope: ShopScope;
  setScope(scope: ShopScope, options?: { discardUnsavedDrafts?: boolean }): boolean;
  hasUnsavedDrafts(): boolean;
  registerUnsavedDraftGuard(isDirty: () => boolean): () => void;
  principal: AdminSessionPrincipal;
};

const ShopScopeContext = createContext<ShopScopeContextValue | null>(null);

export function ShopScopeProvider({
  principal,
  children,
}: PropsWithChildren<{ principal: AdminSessionPrincipal }>) {
  const [scope, setRawScope] = useState<ShopScope>(() => initialShopScope(principal));
  const dirtyGuards = useRef(new Set<() => boolean>());
  const hasUnsavedDrafts = useCallback(
    () => Array.from(dirtyGuards.current).some((isDirty) => isDirty()),
    [],
  );
  const registerUnsavedDraftGuard = useCallback((isDirty: () => boolean) => {
    dirtyGuards.current.add(isDirty);
    return () => {
      dirtyGuards.current.delete(isDirty);
    };
  }, []);
  const value = useMemo<ShopScopeContextValue>(
    () => ({
      scope,
      principal,
      hasUnsavedDrafts,
      registerUnsavedDraftGuard,
      setScope(next, options) {
        const validated = validateShopScope(principal, next);
        if (
          validated.kind === scope.kind &&
          (validated.kind === 'all-shops' ||
            (scope.kind === 'shop' && validated.shopId === scope.shopId))
        ) {
          return true;
        }
        if (!options?.discardUnsavedDrafts && hasUnsavedDrafts()) return false;
        setRawScope(validated);
        return true;
      },
    }),
    [scope, principal, hasUnsavedDrafts, registerUnsavedDraftGuard],
  );
  return <ShopScopeContext.Provider value={value}>{children}</ShopScopeContext.Provider>;
}

export function useShopScope() {
  const value = useContext(ShopScopeContext);
  if (!value) throw new Error('useShopScope must be used within ShopScopeProvider');
  return value;
}

// A form opts in only while it actually holds unsaved, shop-specific edits.
// The guard is registered once; the ref keeps the latest dirty state without
// re-registering on every keystroke.
export function useUnsavedShopDraft(isDirty: boolean) {
  const { registerUnsavedDraftGuard } = useShopScope();
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(
    () => registerUnsavedDraftGuard(() => dirtyRef.current),
    [registerUnsavedDraftGuard],
  );
}
