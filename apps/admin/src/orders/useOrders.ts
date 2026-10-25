import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  AdminOrderCancellationResult,
  AdminOrderDetail,
  AdminOrderBusinessDaysResult,
  AdminOrderFinancialMutationResult,
  AdminOrderSearchInput,
  AdminOrderSearchResult,
  AdminOrderKpisResult,
  AdminOrderSource,
  AdminOrderStatus,
  AdminReasonCodeConfiguration,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { shouldReleaseOrdersCommandIdAfterFailure } from './orderCommandRetryPolicy';
import { createRetainedCommandIds, isPendingApprovalResult } from '../lib/retainedCommandIds';

// Cross-app changes must reach an open Admin order workspace without user refresh.
const ORDER_REFRESH_INTERVAL_MS = 20_000;

export class OrdersUiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OrdersUiError';
  }
}

export type OrderSearchFilters = {
  query: string;
  statuses: readonly AdminOrderStatus[];
  source: AdminOrderSource | null;
  businessDayId: string | null;
  from: string | null;
  to: string | null;
  limit: number;
};

export function buildOrderSearchUrl(input: AdminOrderSearchInput): string {
  const query = new URLSearchParams({ shopId: input.shopId });
  const term = input.query?.trim();
  if (term) query.set('q', term);
  for (const status of input.statuses ?? []) query.append('status', status);
  if (input.source) query.set('source', input.source);
  if (input.businessDayId) query.set('businessDayId', input.businessDayId);
  if (input.from) query.set('from', input.from);
  if (input.to) query.set('to', input.to);
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  return `/api/admin/orders?${query.toString()}`;
}

function listKey(shopId: string, filters: OrderSearchFilters) {
  return [
    'admin',
    'orders',
    shopId,
    filters.query,
    filters.statuses.join(','),
    filters.source ?? '',
    filters.businessDayId ?? '',
    filters.from ?? '',
    filters.to ?? '',
    filters.limit,
  ] as const;
}

function detailKey(shopId: string, orderId: string) {
  return ['admin', 'orders', shopId, 'detail', orderId] as const;
}

function reasonsKey(shopId: string) {
  return ['admin', 'orders', shopId, 'action-reasons'] as const;
}

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new OrdersUiError('session_required');
  return session.state.session.csrfToken;
}

export function useOrders(
  shopId: string | undefined,
  selectedOrderId: string | null,
  filters: OrderSearchFilters,
  searchEnabled = true,
) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const commandNamespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(commandNamespace), [commandNamespace]);

  const searchQuery = useInfiniteQuery({
    queryKey: shopId ? listKey(shopId, filters) : ['admin', 'orders', 'no-shop'],
    enabled: Boolean(shopId) && searchEnabled,
    initialPageParam: null as string | null,
    refetchInterval: ORDER_REFRESH_INTERVAL_MS,
    queryFn: async ({ pageParam }) => {
      if (!shopId) throw new OrdersUiError('concrete_shop_required');
      return adminFetch<AdminOrderSearchResult>(
        buildOrderSearchUrl({
          shopId,
          query: filters.query,
          statuses: filters.statuses,
          source: filters.source,
          businessDayId: filters.businessDayId,
          from: filters.from,
          to: filters.to,
          cursor: pageParam,
          limit: filters.limit,
        }),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Separately authorized complete-population aggregation. Never derive KPI values
  // from the cursor-paginated orders search (initial list limit: 50).
  const kpiQuery = useQuery({
    queryKey: ['admin', 'orders', shopId, 'kpis', filters.from, filters.to],
    enabled: Boolean(shopId) && searchEnabled,
    refetchInterval: ORDER_REFRESH_INTERVAL_MS,
    queryFn: () => {
      if (!shopId) throw new OrdersUiError('concrete_shop_required');
      const params = new URLSearchParams({ shopId, view: 'kpis' });
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      return adminFetch<AdminOrderKpisResult>(`/api/admin/orders?${params}`);
    },
  });

  const businessDaysQuery = useQuery({
    queryKey: shopId
      ? ['admin', 'orders', shopId, 'business-days']
      : ['admin', 'orders', 'no-business-days'],
    enabled: Boolean(shopId),
    queryFn: () => {
      if (!shopId) throw new OrdersUiError('concrete_shop_required');
      return adminFetch<AdminOrderBusinessDaysResult>(
        `/api/admin/orders?shopId=${encodeURIComponent(shopId)}&view=business-days`,
      );
    },
  });

  const detailQuery = useQuery({
    queryKey:
      shopId && selectedOrderId
        ? detailKey(shopId, selectedOrderId)
        : ['admin', 'orders', 'no-detail'],
    enabled: Boolean(shopId && selectedOrderId),
    refetchInterval: ORDER_REFRESH_INTERVAL_MS,
    queryFn: async () => {
      if (!shopId || !selectedOrderId) throw new OrdersUiError('order_required');
      return adminFetch<AdminOrderDetail>(
        `/api/admin/orders?shopId=${encodeURIComponent(shopId)}&orderId=${encodeURIComponent(selectedOrderId)}`,
      );
    },
  });

  const actionReasonsQuery = useQuery({
    queryKey: shopId ? reasonsKey(shopId) : ['admin', 'orders', 'no-action-reasons'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new OrdersUiError('concrete_shop_required');
      return adminFetch<{ reasons: AdminReasonCodeConfiguration[] }>(
        `/api/admin/orders?shopId=${encodeURIComponent(shopId)}&view=action-reasons`,
      );
    },
  });

  async function invalidateOrderState(orderId: string): Promise<void> {
    if (!shopId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders', shopId] }),
      queryClient.invalidateQueries({ queryKey: detailKey(shopId, orderId) }),
    ]);
  }

  async function postRetained<T>(
    scope: string,
    intent: unknown,
    pin: string,
    command: (commandId: string) => Record<string, unknown>,
  ): Promise<T> {
    if (!shopId) throw new OrdersUiError('concrete_shop_required');
    const token = csrfToken(session);
    await session.reauthenticate(pin);
    const retainedIntent = { shopId, intent };
    const commandId = commandIds.forIntent(scope, retainedIntent);
    try {
      const result = await adminFetch<T>(
        '/api/admin/orders',
        { method: 'POST', body: JSON.stringify(command(commandId)) },
        token,
      );
      if (!isPendingApprovalResult(result)) {
        commandIds.complete(scope, retainedIntent);
      }
      return result;
    } catch (error) {
      if (shouldReleaseOrdersCommandIdAfterFailure(error)) {
        commandIds.complete(scope, retainedIntent);
      }
      throw error;
    }
  }

  const cancelOrder = useMutation({
    mutationFn: async (input: {
      orderId: string;
      expectedOperationalRevision: number;
      reasonCodeId: string;
      note: string | null;
      pin: string;
    }) => {
      const { pin, ...intent } = input;
      return postRetained<AdminOrderCancellationResult>(
        'order.cancel',
        intent,
        pin,
        (commandId) => ({ type: 'order.cancel', shopId, ...intent, commandId }),
      );
    },
    onSettled: (_result, _error, input) => invalidateOrderState(input.orderId),
  });

  const refundOrder = useMutation({
    mutationFn: async (input: {
      orderId: string;
      paymentId: string;
      amountMinor: number;
      reasonCodeId: string;
      note: string | null;
      pin: string;
    }) => {
      const { pin, ...intent } = input;
      return postRetained<AdminOrderFinancialMutationResult>(
        'order.refund',
        intent,
        pin,
        (commandId) => ({ type: 'order.refund', shopId, ...intent, commandId }),
      );
    },
    onSettled: (_result, _error, input) => invalidateOrderState(input.orderId),
  });

  const returnOrderItems = useMutation({
    mutationFn: async (input: {
      orderId: string;
      items: readonly { orderItemId: string; quantity: number }[];
      reasonCodeId: string;
      note: string | null;
      pin: string;
    }) => {
      const { pin, ...intent } = input;
      return postRetained<AdminOrderFinancialMutationResult>(
        'order.return',
        intent,
        pin,
        (commandId) => ({ type: 'order.return', shopId, ...intent, commandId }),
      );
    },
    onSettled: (_result, _error, input) => invalidateOrderState(input.orderId),
  });

  return {
    searchQuery,
    kpiQuery,
    businessDaysQuery,
    detailQuery,
    actionReasonsQuery,
    cancelOrder,
    refundOrder,
    returnOrderItems,
  };
}
