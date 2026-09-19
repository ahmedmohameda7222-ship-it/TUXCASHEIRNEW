import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPurchasingWorkspace, PurchasingCommandResult } from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class PurchasingUiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PurchasingUiError';
  }
}

function queryKey(shopId: string) {
  return ['admin', 'purchasing', shopId] as const;
}

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') {
    throw new PurchasingUiError('session_required');
  }
  return session.state.session.csrfToken;
}

function commandId(): string {
  return crypto.randomUUID();
}

export function usePurchasing(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspace = useQuery({
    queryKey: shopId ? queryKey(shopId) : ['admin', 'purchasing', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return adminFetch<AdminPurchasingWorkspace>(
        `/api/admin/purchasing?shopId=${encodeURIComponent(shopId)}`,
      );
    },
  });

  async function post(command: Record<string, unknown>): Promise<PurchasingCommandResult> {
    const result = await adminFetch<PurchasingCommandResult>(
      '/api/admin/purchasing',
      { method: 'POST', body: JSON.stringify(command) },
      csrfToken(session),
    );
    if (!result.ok) throw new PurchasingUiError(result.code);
    return result;
  }

  async function invalidate(): Promise<void> {
    if (shopId) await queryClient.invalidateQueries({ queryKey: queryKey(shopId) });
  }

  const createSupplier = useMutation({
    mutationFn: async (input: {
      name: string;
      contactName: string | null;
      phone: string | null;
      email: string | null;
    }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'supplier.create', shopId, ...input });
    },
    onSuccess: invalidate,
  });

  const createPurchaseOrder = useMutation({
    mutationFn: async (input: {
      supplierId: string;
      reference: string | null;
      expectedDeliveryDate: string | null;
      lines: readonly {
        inventoryItemId: string;
        purchaseUnitLabel: string;
        orderedBaseMicros: number;
        expectedUnitCostMinor: number;
      }[];
    }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'po.create', shopId, ...input, commandId: commandId() });
    },
    onSuccess: invalidate,
  });

  const updatePurchaseOrder = useMutation({
    mutationFn: async (input: {
      purchaseOrderId: string;
      expectedVersion: number;
      reference: string | null;
      expectedDeliveryDate: string | null;
    }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'po.update', shopId, ...input });
    },
    onSuccess: invalidate,
  });

  const orderPurchaseOrder = useMutation({
    mutationFn: async (input: { purchaseOrderId: string; expectedVersion: number }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'po.order', shopId, ...input, commandId: commandId() });
    },
    onSuccess: invalidate,
  });

  const receivePurchase = useMutation({
    mutationFn: async (input: {
      purchaseOrderId: string;
      supplierReference: string | null;
      lines: readonly {
        lineId: string;
        receivedBaseMicros: number;
        unitCostMinor: number;
      }[];
    }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'po.receive', shopId, ...input, commandId: commandId() });
    },
    onSuccess: invalidate,
  });

  const returnPurchase = useMutation({
    mutationFn: async (input: {
      purchaseOrderId: string;
      supplierReference: string | null;
      lines: readonly {
        lineId: string;
        returnedBaseMicros: number;
        unitCostMinor: number;
      }[];
    }) => {
      if (!shopId) throw new PurchasingUiError('concrete_shop_required');
      return post({ type: 'po.return', shopId, ...input, commandId: commandId() });
    },
    onSuccess: invalidate,
  });

  return {
    workspace,
    createSupplier,
    createPurchaseOrder,
    updatePurchaseOrder,
    orderPurchaseOrder,
    receivePurchase,
    returnPurchase,
  };
}
