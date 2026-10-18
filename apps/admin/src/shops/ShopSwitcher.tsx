import { useState } from 'react';
import type { AdminShopIdentitySummary, ShopScope } from '@tux/admin-contracts';

import { ConfirmationDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from './ShopScopeProvider';

function scopeValue(scope: ShopScope): string {
  return scope.kind === 'all-shops' ? '__all__' : scope.shopId;
}

function shopOptionLabel(shop: AdminShopIdentitySummary | undefined): string {
  if (!shop) return 'Shop name unavailable';
  if (!shop.active) return `${shop.name} · Inactive`;
  if (shop.temporaryClosed) return `${shop.name} · Temporarily closed`;
  return shop.name;
}

export function ShopSwitcher() {
  const { principal, scope, setScope, hasUnsavedDrafts } = useShopScope();
  const [pendingScope, setPendingScope] = useState<ShopScope | null>(null);

  // Only the authenticated principal provides display names. Never re-query
  // Settings or accept a label for a shop outside principal.shopIds.
  const authorizedMetadata = new Map(
    (principal.shopSummaries ?? [])
      .filter((shop) => principal.shopIds.includes(shop.id))
      .map((shop) => [shop.id, shop]),
  );
  if (principal.shopIds.length <= 1 && principal.role !== 'OWNER') return null;

  return (
    <>
      <label className="shop-switcher">
        <span>Shop</span>
        <select
          value={scopeValue(scope)}
          onChange={(event) => {
            const nextScope: ShopScope =
              event.currentTarget.value === '__all__'
                ? { kind: 'all-shops' }
                : { kind: 'shop', shopId: event.currentTarget.value };
            if (hasUnsavedDrafts()) {
              // Keep the controlled select on its actual scope until the operator decides.
              event.currentTarget.value = scopeValue(scope);
              setPendingScope(nextScope);
              return;
            }
            setScope(nextScope);
          }}
        >
          {principal.role === 'OWNER' ? <option value="__all__">All Shops</option> : null}
          {principal.shopIds.map((shopId) => {
            const label = shopOptionLabel(authorizedMetadata.get(shopId));
            return (
              <option key={shopId} value={shopId}>
                {label}
              </option>
            );
          })}
        </select>
      </label>
      <ConfirmationDialog
        open={pendingScope !== null}
        title="Discard unsaved changes?"
        description="You have unsaved changes in this shop. Switching shops will discard these edits."
        confirmLabel="Discard and switch"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          if (pendingScope) setScope(pendingScope, { discardUnsavedDrafts: true });
          setPendingScope(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingScope(null);
        }}
      />
    </>
  );
}
