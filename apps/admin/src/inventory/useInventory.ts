import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  AdminInventoryCommand,
  AdminInventoryCommandResult,
  AdminInventoryWorkspace,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';

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


export function useInventory(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const commandIds = useMemo(() => createRetainedCommandIds(), []);

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

  async function post(
    command: AdminInventoryCommand,
    onAuthoritativeResponse?: () => void,
  ): Promise<AdminInventoryCommandResult> {
    const result = await adminFetch<AdminInventoryCommandResult>(
      '/api/admin/inventory',
      { method: 'POST', body: JSON.stringify(command) },
      csrfTokenForMutation(session),
    );
    onAuthoritativeResponse?.();
    if (!result.ok) throw new InventoryUiError(result.code);
    return result;
  }

  async function postRetained(
    scope: string,
    intent: unknown,
    buildCommand: (retainedCommandId: string) => AdminInventoryCommand,
  ): Promise<AdminInventoryCommandResult> {
    if (!shopId) throw new InventoryUiError('concrete_shop_required');
    const retainedIntent = { shopId, intent };
    const retainedCommandId = commandIds.forIntent(scope, retainedIntent);
    return post(buildCommand(retainedCommandId), () => commandIds.complete(scope, retainedIntent));
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
      return postRetained('adjust', input, (retainedCommandId) => ({
        type: 'adjust',
        shopId: shopId!,
        commandId: retainedCommandId,
        ...input,
      }));
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
      return postRetained('waste', input, (retainedCommandId) => ({
        type: 'waste',
        shopId: shopId!,
        commandId: retainedCommandId,
        ...input,
      }));
    },
    onSuccess: invalidate,
  });

  const beginStocktake = useMutation({
    mutationFn: async (inventoryItemIds: readonly string[]) => {
      const result = await postRetained('stocktake.begin', inventoryItemIds, (retainedCommandId) => ({
        type: 'stocktake.begin',
        shopId: shopId!,
        inventoryItemIds,
        commandId: retainedCommandId,
      }));
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
      return postRetained('stocktake.post', input, (retainedCommandId) => ({
        type: 'stocktake.post',
        shopId: shopId!,
        stocktakeId: input.stocktakeId,
        commandId: retainedCommandId,
        lines: input.lines,
      }));
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
      return postRetained('transfer.send', input, (retainedCommandId) => ({
        type: 'transfer.send',
        shopId: shopId!,
        commandId: retainedCommandId,
        ...input,
      }));
    },
    onSuccess: invalidate,
  });

  const receiveTransfer = useMutation({
    mutationFn: async (transferId: string) => {
      return postRetained('transfer.receive', transferId, (retainedCommandId) => ({
        type: 'transfer.receive',
        shopId: shopId!,
        transferId,
        commandId: retainedCommandId,
      }));
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
