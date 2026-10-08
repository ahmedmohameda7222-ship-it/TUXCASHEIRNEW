import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';

export type FinanceDayRow = {
  readonly id: string;
  readonly shop_id: string;
  readonly status: 'OPEN' | 'CLOSED';
  readonly started_at: string;
  readonly ended_at: string | null;
};
export type FinanceDayReport = {
  readonly ok: true;
  readonly shopId: string;
  readonly businessDayId: string;
  readonly businessDayStatus: 'OPEN' | 'CLOSED';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly orderCount: number;
  readonly netSalesMinor: number;
  readonly postedRefundsMinor: number;
  readonly cashSalesNetMinor: number;
  readonly totalExpensesMinor: number;
  readonly cogsMinor: number | null;
  readonly estimatedOperatingProfitMinor: number | null;
  readonly missingInventoryCostCount: number;
  readonly unattributedPaymentCount: number;
  readonly missingCashierReconciliationCount: number;
  readonly paymentBreakdown: Readonly<Record<string, number>>;
  readonly cashierReconciliations: readonly {
    cashierWorkerId: string;
    expectedMinor: number;
    actualMinor: number;
    varianceMinor: number;
    reason: string | null;
    postedAt: string;
  }[];
  readonly financialFinalized: boolean;
};
export type FinanceOperationDraft = Readonly<Record<string, unknown>> & {
  readonly type: string;
  readonly shopId: string;
};

export function useFinanceOperations(
  shopId: string | undefined,
  businessDayId: string | undefined,
) {
  const session = useAdminSession();
  const cache = useQueryClient();
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commands = useMemo(() => createRetainedCommandIds(namespace), [namespace]);
  const path = (view: string, extra = '') =>
    `/api/admin/finance?shopId=${encodeURIComponent(shopId!)}&view=${view}${extra}`;

  const daysQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'days'],
    enabled: Boolean(shopId),
    queryFn: () => adminFetch<{ days: FinanceDayRow[] }>(path('days')),
  });
  const dayQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'day', businessDayId],
    enabled: Boolean(shopId && businessDayId),
    queryFn: () =>
      adminFetch<FinanceDayReport>(
        path('day', `&businessDayId=${encodeURIComponent(businessDayId!)}`),
      ),
  });
  const dayHistoryQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'day-history'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{
        snapshots: Array<{
          id: string;
          business_day_id: string;
          snapshot: FinanceDayReport;
          finalized_at: string;
        }>;
        adjustments: Array<{
          id: string;
          snapshot_id: string;
          amount_minor: number;
          reason: string;
          created_at: string;
        }>;
      }>(path('day-history')),
  });
  const expensesQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'expenses'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{
        expenses: Array<{
          id: string;
          shop_id: string;
          business_day_id: string;
          description: string;
          amount_minor: number;
          created_at: string;
        }>;
      }>(path('expenses')),
  });
  const categoriesQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'categories'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{ categories: Array<{ id: string; name: string }> }>(path('categories')),
  });
  const settlementsQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'settlements'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{
        settlements: Array<{
          id: string;
          source_account_id: string;
          destination_account_id: string;
          gross_minor: number;
          fee_minor: number;
          net_minor: number;
          settled_on: string;
        }>;
      }>(path('settlements')),
  });
  const cashierQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'cashiers', businessDayId],
    enabled: Boolean(shopId && businessDayId),
    queryFn: () =>
      adminFetch<{
        workers: Array<{ id: string; display_name: string }>;
        cashiers: Array<{ cashierWorkerId: string; displayName: string; expectedMinor: number; cashSalesExpectationMinor: number; recordedCashMovementMinor: number; openingFloatRecorded: boolean }>;
        reconciliations: Array<{ id: string; cashier_worker_id: string }>;
      }>(path('cashiers', `&businessDayId=${encodeURIComponent(businessDayId!)}`)),
  });
  const recurringQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'recurring'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{
        rules: Array<{
          id: string;
          categoryId: string | null;
          description: string;
          amountMinor: number;
          cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY';
          nextDueDate: string;
          active: boolean;
          version: number;
        }>;
        due: Array<{
          id: string;
          ruleId: string;
          dueOn: string;
          status: 'DUE';
          description: string;
          amountMinor: number;
          categoryId: string | null;
          ruleVersion: number;
        }>;
      }>(path('recurring')),
  });
  const ownerSummaryQuery = useQuery({
    queryKey: ['admin', 'finance-ops', namespace, shopId, 'owner-summary'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{
        summaries: Array<{
          id: string;
          business_day_id: string;
          summary: Readonly<Record<string, unknown>>;
          generated_at: string;
        }>;
      }>(path('owner-summary')),
  });

  const command = useMutation({
    mutationFn: async (input: { draft: FinanceOperationDraft; reauthPin?: string }) => {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const { draft, reauthPin } = input;
      const token = session.state.session.csrfToken;
      const commandId = commands.forIntent(draft.type, draft);
      try {
        if (reauthPin !== undefined) {
          await adminFetch<{ ok: true }>(
            '/api/admin/reauth',
            {
              method: 'POST',
              body: JSON.stringify({ pin: reauthPin }),
            },
            token,
          );
        }
        const result = await adminFetch<Readonly<Record<string, unknown>>>(
          '/api/admin/finance',
          {
            method: 'POST',
            body: JSON.stringify({ ...draft, commandId }),
          },
          token,
        );
        commands.complete(draft.type, draft);
        return result;
      } catch (error) {
        if (error instanceof AdminApiError && error.status < 500) {
          commands.complete(draft.type, draft);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['admin', 'finance-ops', namespace, shopId] }),
        cache.invalidateQueries({ queryKey: ['admin', 'finance', shopId] }),
        cache.invalidateQueries({ queryKey: ['admin', 'reports', namespace] }),
      ]);
    },
  });
  return {
    daysQuery,
    dayQuery,
    dayHistoryQuery,
    expensesQuery,
    categoriesQuery,
    settlementsQuery,
    cashierQuery,
    recurringQuery,
    ownerSummaryQuery,
    command,
  };
}
