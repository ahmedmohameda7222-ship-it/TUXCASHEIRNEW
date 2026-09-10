import type { AdminSessionPrincipal, ShopScope } from '@tux/admin-contracts';
import {
  createContext,
  useContext,
  useMemo,
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

export function validateShopScope(
  principal: AdminSessionPrincipal,
  scope: ShopScope,
): ShopScope {
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
  setScope(scope: ShopScope): void;
  principal: AdminSessionPrincipal;
};

const ShopScopeContext = createContext<ShopScopeContextValue | null>(null);

export function ShopScopeProvider({
  principal,
  children,
}: PropsWithChildren<{ principal: AdminSessionPrincipal }>) {
  const [scope, setRawScope] = useState<ShopScope>(() => initialShopScope(principal));
  const value = useMemo<ShopScopeContextValue>(
    () => ({
      scope,
      principal,
      setScope(next) {
        setRawScope(validateShopScope(principal, next));
      },
    }),
    [scope, principal],
  );
  return <ShopScopeContext.Provider value={value}>{children}</ShopScopeContext.Provider>;
}

export function useShopScope() {
  const value = useContext(ShopScopeContext);
  if (!value) throw new Error('useShopScope must be used within ShopScopeProvider');
  return value;
}
