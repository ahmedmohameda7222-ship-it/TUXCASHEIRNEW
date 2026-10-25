import { useQuery } from '@tanstack/react-query';
import type { AdminPurchaseOrderHistory } from '@tux/admin-contracts';

import { adminFetch } from '../lib/adminApi';

export const purchaseHistoryKey = (shopId: string, purchaseOrderId: string) =>
  ['admin', 'purchasing-history', shopId, purchaseOrderId] as const;

/** Separate lazy history query avoids the Inventory-owned usePurchasing hook. */
export function usePurchaseHistory(
  shopId: string | undefined,
  purchaseOrderId: string | null,
) {
  return useQuery({
    queryKey: shopId && purchaseOrderId
      ? purchaseHistoryKey(shopId, purchaseOrderId)
      : ['admin', 'purchasing-history', 'not-selected'],
    enabled: Boolean(shopId && purchaseOrderId),
    queryFn: async (): Promise<AdminPurchaseOrderHistory> => {
      if (!shopId || !purchaseOrderId) throw new Error('concrete_purchase_order_required');
      return adminFetch<AdminPurchaseOrderHistory>(
        `/api/admin/purchasing?shopId=${encodeURIComponent(shopId)}&purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`,
      );
    },
  });
}
