import type { AdminReportArea } from '@tux/admin-contracts';
import { useEffect, useRef, useState } from 'react';

import { ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { useAdminSession } from '../auth/useAdminSession';
import { PageScaffold } from '../components/layout/PageScaffold';
import { TargetsPanel } from '../dashboard/TargetsPanel';
import { OwnerSummaryCard } from '../dashboard/OwnerSummaryCard';
import { useShopScope } from '../shops/ShopScopeProvider';

import { REPORT_LABELS, ReportFilters } from './ReportFilters';
import { ReportExportActions } from './ReportExportActions';
import { cairoReportToday, reportDatePreset, validReportDateRange } from './reportDateRange';
import { scopeReportFilters } from './reportScope';
import { ReportView } from './ReportView';
import { SavedViews } from './SavedViews';
import {
  useReports,
  type ReportFilters as ReportFilterState,
  type SavedReportViewRow,
} from './useReports';
import './reports.css';

export function ReportsPage() {
  const session = useAdminSession();
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : principal.shopIds[0];
  const [filters, setFilters] = useState<ReportFilterState>(() => ({
    area: 'sales',
    ...reportDatePreset(cairoReportToday(), 7),
    source: null,
    shopIds: scope.kind === 'all-shops' ? principal.shopIds : shopId ? [shopId] : [],
    comparePrevious: false,
    comparisonRange: 'previous',
    context: {},
    offset: 0,
  }));
  const [filterOptionsExpanded, setFilterOptionsExpanded] = useState(false);
  const scopeKey = scope.kind === 'shop' ? `shop:${scope.shopId}` : 'all-shops';
  const previousScopeKey = useRef(scopeKey);
  const scopeChanged = previousScopeKey.current !== scopeKey;
  const scopedFilters = scopeReportFilters(
    filters,
    scope.kind === 'shop' ? { kind: 'shop', shopId: scope.shopId } : { kind: 'all-shops' },
    principal.shopIds,
    scopeChanged,
    principal.role === 'OWNER',
  );
  useEffect(() => {
    if (!scopeChanged) return;
    previousScopeKey.current = scopeKey;
    setFilters(scopedFilters);
  }, [scopeChanged, scopeKey, scopedFilters]);
  const hasContextFilters = Object.values(scopedFilters.context ?? {}).some(Boolean);
  const reports = useReports(shopId, scopedFilters, filterOptionsExpanded || hasContextFilters);
  const config = reports.configQuery.data;

  if (!shopId)
    return (
      <PageScaffold
        eyebrow="Business intelligence"
        title="Reports"
        description="No authorized shop is available to view reports."
      />
    );

  function applySavedView(view: SavedReportViewRow) {
    const source = view.filters['source'];
    const rawShopIds = view.filters['shopIds'];
    const savedShops = Array.isArray(rawShopIds)
      ? rawShopIds.filter(
          (id): id is string => typeof id === 'string' && principal.shopIds.includes(id),
        )
      : [shopId!];
    const area = view.reportArea;
    if (!(area in REPORT_LABELS)) return;
    const fromDate = view.filters['fromDate'];
    const toDate = view.filters['toDate'];
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    setFilters({
      area: area as AdminReportArea,
      fromDate: typeof fromDate === 'string' && iso.test(fromDate) ? fromDate : cairoReportToday(),
      toDate: typeof toDate === 'string' && iso.test(toDate) ? toDate : cairoReportToday(),
      source: source === 'POS' || source === 'ONLINE' ? source : null,
      shopIds: savedShops.length > 0 ? savedShops : [shopId!],
      comparePrevious: view.filters['comparePrevious'] === true,
      comparisonRange:
        view.filters['comparisonRange'] === 'week' ||
        view.filters['comparisonRange'] === 'month' ||
        view.filters['comparisonRange'] === 'year'
          ? view.filters['comparisonRange']
          : 'previous',
      context: Object.fromEntries(
        Object.entries(
          view.filters['context'] &&
            typeof view.filters['context'] === 'object' &&
            !Array.isArray(view.filters['context'])
            ? (view.filters['context'] as Record<string, unknown>)
            : {},
        ).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && /^(?:[0-9a-f-]{36}|[A-Z_]{2,40})$/i.test(entry[1]),
        ),
      ),
      offset: 0,
    });
  }

  return (
    <PageScaffold
      eyebrow="Business intelligence"
      title="Reports"
      description="See what's changing, understand why, and open the original source records."
    >
      <ReportFilters
        value={scopedFilters}
        onChange={setFilters}
        canCompareShops={principal.role === 'OWNER'}
        allShopIds={principal.shopIds}
        options={reports.optionsQuery.data?.options ?? {}}
        onExpand={() => setFilterOptionsExpanded(true)}
      />
      {!validReportDateRange(scopedFilters.fromDate, scopedFilters.toDate) ? (
        <p className="admin-inline-error" role="alert">
          Select a valid From/To date range in ascending order, no longer than 730 days.
        </p>
      ) : null}
      <ReportExportActions
        filters={scopedFilters}
        shopId={shopId}
        csrfToken={session.state.status === 'authenticated' ? session.state.session.csrfToken : null}
      />
      <ReportView
        data={reports.reportQuery.data}
        filters={scopedFilters}
        loading={reports.reportQuery.isLoading}
        error={reports.reportQuery.isError}
        retry={() => void reports.reportQuery.refetch()}
        onOffset={(offset) => setFilters((previous) => ({ ...previous, offset }))}
      />
      {reports.configQuery.isLoading ? (
        <LoadingState title="Loading saved report settings" />
      ) : null}
      {reports.configQuery.isError ? (
        <ErrorState
          title="Saved report settings unavailable"
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void reports.configQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {config ? (
        <TargetsPanel
          targets={config.targets}
          filters={scopedFilters}
          summary={reports.reportQuery.data?.summary}
        />
      ) : null}
      {principal.permissions.includes('finance.view') ? <OwnerSummaryCard shopId={shopId} /> : null}
      {config ? (
        <SavedViews
          shopId={shopId}
          views={config.savedViews}
          targets={config.targets}
          filters={scopedFilters}
          canSetTargets={principal.permissions.includes('settings.manage')}
          pending={reports.command.isPending}
          error={reports.command.error}
          onCommand={(draft) => reports.command.mutate(draft)}
          onApply={applySavedView}
        />
      ) : null}
    </PageScaffold>
  );
}
