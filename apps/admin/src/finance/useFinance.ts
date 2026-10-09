import type { FinanceAccountActivity, FinanceWorkspace } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';

export type FinanceCommandDraft =
  | {
      readonly type: 'finance.account.create';
      readonly shopId: string;
      readonly scope: 'SHOP' | 'BUSINESS';
      readonly name: string;
      readonly accountType: 'CASH' | 'BANK' | 'WALLET' | 'PENDING_SETTLEMENT';
      readonly openingBalanceMinor: number;
    }
  | {
      readonly type: 'finance.account.active';
      readonly shopId: string;
      readonly accountId: string;
      readonly expectedVersion: number;
      readonly active: boolean;
    }
  | {
      readonly type: 'finance.mapping.set';
      readonly shopId: string;
      readonly paymentMethodId: string;
      readonly financeAccountId: string | null;
      readonly expectedVersion: number;
    };

export type FinanceCommandResult = {
  readonly ok: true;
  readonly replayed?: boolean;
  readonly accountId?: string;
  readonly version?: number;
};

export function useFinance(
  shopId: string | undefined,
  accountId: string | null,
  movementId: string | null = null,
) {
  const session = useAdminSession();
  const client = useQueryClient();
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);

  const workspaceQuery = useQuery({
    queryKey: ['admin', 'finance', shopId, 'workspace'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<FinanceWorkspace>(`/api/admin/finance?shopId=${encodeURIComponent(shopId!)}`),
  });

  const historyQuery = useQuery({
    queryKey: ['admin', 'finance', shopId, 'history', accountId, movementId],
    enabled: Boolean(shopId && accountId),
    queryFn: () =>
      adminFetch<{ accountId: string; movements: FinanceAccountActivity[] }>(
        `/api/admin/finance?shopId=${encodeURIComponent(shopId!)}&view=account-history&accountId=${encodeURIComponent(accountId!)}${movementId ? `&movementId=${encodeURIComponent(movementId)}` : ''}`,
      ).then((response) => response.movements),
  });

  const command = useMutation({
    mutationFn: async (draft: FinanceCommandDraft) => {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const scope = draft.type;
      const commandId = commandIds.forIntent(scope, draft);
      try {
        const result = await adminFetch<FinanceCommandResult>(
          '/api/admin/finance',
          { method: 'POST', body: JSON.stringify({ ...draft, commandId }) },
          session.state.session.csrfToken,
        );
        commandIds.complete(scope, draft);
        return result;
      } catch (error) {
        if (error instanceof AdminApiError && error.status < 500) {
          commandIds.complete(scope, draft);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin', 'finance', shopId] });
    },
  });

  return { workspaceQuery, historyQuery, command };
}
