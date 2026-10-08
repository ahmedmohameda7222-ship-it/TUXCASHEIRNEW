import type { AdminReportArea } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';

export type ReportFact = {
  readonly id: string;
  readonly shopId: string;
  readonly sourceKind: string;
  readonly occurredAt: string;
  readonly label: string;
  readonly amountMinor: number | null;
  readonly quantity: number;
  readonly orderSource: 'POS' | 'ONLINE' | null;
  readonly costMissing: boolean;
};
export type ReportSummary = {
  readonly eventCount: number;
  readonly orderCount: number;
  readonly totalAmountMinor: number | null;
  readonly totalQuantity: number;
  readonly incompleteCostEvents: number;
  readonly coverageNote: string | null;
};
export type ReportResponse = {
  readonly ok: true;
  readonly area: AdminReportArea;
  readonly summary: ReportSummary;
  readonly rows: readonly ReportFact[];
  readonly nextOffset: number | null;
  readonly comparison?: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly summary: ReportSummary;
  };
};
export type SavedReportViewRow = {
  readonly id: string;
  readonly name: string;
  readonly shopId: string | null;
  readonly reportArea: AdminReportArea;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly layout: Readonly<Record<string, unknown>>;
  readonly version: number;
};
export type ReportTargetRow = {
  readonly id: string;
  readonly shopId: string;
  readonly metric: 'NET_SALES' | 'ORDER_COUNT' | 'FOOD_COST_PERCENT' | 'WASTE';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly targetValue: number;
  readonly version: number;
};
export type ReportConfigResponse = {
  readonly savedViews: readonly SavedReportViewRow[];
  readonly targets: readonly ReportTargetRow[];
};
export type ReportFilters = {
  readonly area: AdminReportArea;
  readonly fromDate: string;
  readonly toDate: string;
  readonly source: 'POS' | 'ONLINE' | null;
  readonly shopIds: readonly string[];
  readonly comparePrevious: boolean;
  readonly offset: number;
};
export type ReportConfigDraft =
  | {
      readonly type: 'report.view.save';
      readonly shopId: string;
      readonly id: string | null;
      readonly expectedVersion: number;
      readonly name: string;
      readonly reportArea: AdminReportArea;
      readonly filters: Readonly<Record<string, unknown>>;
      readonly layout: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'report.view.delete';
      readonly shopId: string;
      readonly id: string;
      readonly expectedVersion: number;
    }
  | {
      readonly type: 'report.target.set';
      readonly shopId: string;
      readonly metric: ReportTargetRow['metric'];
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly targetValue: number;
      readonly expectedVersion: number;
    };

export function useReports(shopId: string | undefined, filters: ReportFilters) {
  const session = useAdminSession();
  const cache = useQueryClient();
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);
  const reportQuery = useQuery({
    queryKey: ['admin', 'reports', namespace, 'report', shopId, filters],
    enabled: Boolean(shopId && filters.shopIds.length > 0),
    queryFn: () => {
      const params = new URLSearchParams({
        shopId: shopId!,
        area: filters.area,
        from: filters.fromDate,
        to: filters.toDate,
        pageSize: '50',
        offset: String(filters.offset),
      });
      if (filters.source) params.set('source', filters.source);
      if (filters.comparePrevious) params.set('compare', 'previous');
      for (const selected of filters.shopIds) params.append('reportShopId', selected);
      return adminFetch<ReportResponse>(`/api/admin/reports?${params}`);
    },
  });
  const configQuery = useQuery({
    queryKey: ['admin', 'reports', namespace, 'config', shopId],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<ReportConfigResponse>(
        `/api/admin/reports?view=configuration&shopId=${encodeURIComponent(shopId!)}`,
      ),
  });
  const command = useMutation({
    mutationFn: async (draft: ReportConfigDraft) => {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const scope = draft.type;
      const commandId = commandIds.forIntent(scope, draft);
      try {
        const result = await adminFetch<{ ok: true; id: string; version: number }>(
          '/api/admin/reports',
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
    onSuccess: async () =>
      cache.invalidateQueries({
        queryKey: ['admin', 'reports', namespace, 'config', shopId],
      }),
  });
  return { reportQuery, configQuery, command };
}
