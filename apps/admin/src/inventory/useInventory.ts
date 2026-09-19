import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminInventoryCommand,
  AdminInventoryCommandResult,
  AdminInventoryWorkspace,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class InventoryUiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'InventoryUiError';
  }
}

function inventoryQueryKey(shopId: string) {
  return ['admin', 'inventory', shopId] as const;
}

function csrfTokenForMutation(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new InventoryUiError('session_required');
  return session.state.session.csrfToken;
}

function commandId(): string {
  return crypto.randomUUID();
}

export function useInventory(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: shopId ? inventoryQueryKey(shopId) : ['admin', 'inventory', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return adminFetch<AdminInventoryWorkspace>(
        `/api/admin/inventory?shopId=${encodeURIComponent(shopId)}`,
      );
    },
  });

  async function post(command: AdminInventoryCommand): Promise<AdminInventoryCommandResult> {
    const result = await adminFetch<AdminInventoryCommandResult>(
      '/api/admin/inventory',
      { method: 'POST', body: JSON.stringify(command) },
      csrfTokenForMutation(session),
    );
    if (!result.ok) throw new InventoryUiError(result.code);
    return result;
  }

  async function invalidate(): Promise<void> {
    if (shopId) await queryClient.invalidateQueries({ queryKey: inventoryQueryKey(shopId) });
  }

  const adjustStock = useMutation({
    mutationFn: async (input: {
      inventoryItemId: string;
      quantityDeltaMicros: number;
      reasonCodeId: string;
      note: string | null;
      emergencyNegativeOverride: boolean;
    }) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({ type: 'adjust', shopId, commandId: commandId(), ...input });
    },
    onSuccess: invalidate,
  });

  const recordWaste = useMutation({
    mutationFn: async (input: {
      inventoryItemId: string;
      quantityMicros: number;
      reasonCodeId: string;
      note: string | null;
      emergencyNegativeOverride: boolean;
    }) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({ type: 'waste', shopId, commandId: commandId(), ...input });
    },
    onSuccess: invalidate,
  });

  const beginStocktake = useMutation({
    mutationFn: async (inventoryItemIds: readonly string[]) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      const result = await post({
        type: 'stocktake.begin',
        shopId,
        inventoryItemIds,
        commandId: commandId(),
      });
      if (!result.ok || !result.stocktakeId || !result.lines) {
        throw new InventoryUiError('invalid_stocktake_snapshot');
      }
      return { stocktakeId: result.stocktakeId, lines: result.lines };
    },
  });

  const postStocktake = useMutation({
    mutationFn: async (input: {
      stocktakeId: string;
      lines: readonly { inventoryItemId: string; actualCountMicros: number }[];
    }) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({
        type: 'stocktake.post',
        shopId,
        stocktakeId: input.stocktakeId,
        commandId: commandId(),
        lines: input.lines,
      });
    },
    onSuccess: invalidate,
  });

  const updateReplenishment = useMutation({
    mutationFn: async (input: {
      inventoryItemId: string;
      parLevelMicros: number;
      reorderPointMicros: number;
      preferredPurchaseUnit: string | null;
      leadTimeDays: number;
      minimumOrderMicros: number | null;
      orderMultipleMicros: number | null;
    }) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({ type: 'replenishment.update', shopId, ...input });
    },
    onSuccess: invalidate,
  });

  const sendTransfer = useMutation({
    mutationFn: async (input: {
      destinationShopId: string;
      lines: readonly { inventoryItemId: string; quantityMicros: number }[];
    }) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({ type: 'transfer.send', shopId, commandId: commandId(), ...input });
    },
    onSuccess: invalidate,
  });

  const receiveTransfer = useMutation({
    mutationFn: async (transferId: string) => {
      if (!shopId) throw new InventoryUiError('concrete_shop_required');
      return post({ type: 'transfer.receive', shopId, transferId, commandId: commandId() });
    },
    onSuccess: invalidate,
  });

  return {
    workspaceQuery,
    adjustStock,
    recordWaste,
    beginStocktake,
    postStocktake,
    updateReplenishment,
    sendTransfer,
    receiveTransfer,
  };
}
