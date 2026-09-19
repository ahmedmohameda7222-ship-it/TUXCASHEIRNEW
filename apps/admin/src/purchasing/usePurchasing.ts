import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminPurchasingWorkspace,
  PurchasingCommandResult,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class PurchasingUiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PurchasingUiError';
  }
}

function key(shopId: string) {
  return ['admin', 'purchasing', shopId] as const;
}

function csrf(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new PurchasingUiError('session_required');
  return session.state.session.csrfToken;
}

function commandId(): string {
  return crypto.randomUUID();
}

export function usePurchasing(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspace = useQuery({
    queryKey: shopId ? key(shopId) : ['admin', 'purchasing', 'none'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<AdminPurchasingWorkspace>(
        `/api/admin/purchasing?shopId=${encodeURIComponent(shopId ?? '')}`,
      ),
  });

  function mutation<TInput>(toCommand: (input: TInput) => Record<string, unknown>) {
    return useMutation({
      mutationFn: (input: TInput) =>
        adminFetch<PurchasingCommandResult>(
          '/api/admin/purchasing',
          {
            method: 'POST',
            body: JSON.stringify(toCommand(input)),
          },
          csrf(session),
        ),
      onSuccess: async () => {
        if (shopId) await queryClient.invalidateQueries({ queryKey: key(shopId) });
      },
    });
  }

  return {
    workspace,
    createSupplier: mutation<{
      name: string;
      contactName: string | null;
      phone: string | null;
      email: string | null;
    }>((input) => ({ type: 'supplier.create', shopId, ...input })),
    createPurchaseOrder: mutation<{
      supplierId: string;
      reference: string | null;
      expectedDeliveryDate: string | null;
      lines: readonly {
        inventoryItemId: string;
        purchaseUnitLabel: string;
        orderedBaseMicros: number;
        expectedUnitCostMinor: number;
      }[];
    }>((input) => ({ type: 'po.create', shopId, ...input, commandId: commandId() })),
    updatePurchaseOrder: mutation<{
      purchaseOrderId: string;
      expectedVersion: number;
      reference: string | null;
      expectedDeliveryDate: string | null;
    }>((input) => ({ type: 'po.update', shopId, ...input })),
    orderPurchaseOrder: mutation<{
      purchaseOrderId: string;
      expectedVersion: number;
    }>((input) => ({ type: 'po.order', shopId, ...input, commandId: commandId() })),
    receivePurchase: mutation<{
      purchaseOrderId: string;
      supplierReference: string | null;
      lines: readonly {
        lineId: string;
        receivedBaseMicros: number;
        unitCostMinor: number;
      }[];
    }>((input) => ({ type: 'po.receive', shopId, ...input, commandId: commandId() })),
    returnPurchase: mutation<{
      purchaseOrderId: string;
      supplierReference: string | null;
      lines: readonly {
        lineId: string;
        returnedBaseMicros: number;
        unitCostMinor: number;
      }[];
    }>((input) => ({ type: 'po.return', shopId, ...input, commandId: commandId() })),
  };
}
