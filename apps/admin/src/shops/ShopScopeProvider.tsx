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

const SHOP_SCOPE_STORAGE_PREFIX = 'tux-admin-shop-scope:v1';

function scopeStorageKey(principal: AdminSessionPrincipal): string {
  return `${SHOP_SCOPE_STORAGE_PREFIX}:${principal.businessId}:${principal.employeeId}`;
}

/** Remember a display choice, never authorization. The session principal remains authoritative. */
function readRememberedScope(principal: AdminSessionPrincipal): ShopScope {
  if (typeof window === 'undefined') return initialShopScope(principal);
  try {
    const stored = window.sessionStorage.getItem(scopeStorageKey(principal));
    if (!stored) return initialShopScope(principal);
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return initialShopScope(principal);
    const candidate = parsed as { kind?: unknown; shopId?: unknown };
    if (candidate.kind === 'all-shops') {
      return validateShopScope(principal, { kind: 'all-shops' });
    }
    if (candidate.kind === 'shop' && typeof candidate.shopId === 'string') {
      return validateShopScope(principal, { kind: 'shop', shopId: candidate.shopId });
    }
  } catch {
    // Removed assignments, malformed storage, and restricted browser storage
    // all recover through the current authenticated principal.
  }
  return initialShopScope(principal);
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
  const [scope, setRawScope] = useState<ShopScope>(() => readRememberedScope(principal));
  const dirtyGuards = useRef(new Set<() => boolean>());
  useEffect(() => {
    try {
      validateShopScope(principal, scope);
    } catch {
      setRawScope(initialShopScope(principal));
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(scopeStorageKey(principal), JSON.stringify(scope));
    } catch {
      // Optional session persistence must not block shop selection.
    }
  }, [principal, scope]);
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
  // Editors also render standalone in isolated component tests. The guard is
  // active only when the real authenticated shell provides shop context.
  const context = useContext(ShopScopeContext);
  const registerUnsavedDraftGuard = context?.registerUnsavedDraftGuard;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(() => {
    if (!registerUnsavedDraftGuard) return;
    return registerUnsavedDraftGuard(() => dirtyRef.current);
  }, [registerUnsavedDraftGuard]);
}
