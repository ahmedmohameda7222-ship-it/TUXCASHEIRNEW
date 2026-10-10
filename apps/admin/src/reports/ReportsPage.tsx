import type { AdminReportArea } from '@tux/admin-contracts';
import { useState } from 'react';

import { ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { TargetsPanel } from '../dashboard/TargetsPanel';
import { OwnerSummaryCard } from '../dashboard/OwnerSummaryCard';
import { useShopScope } from '../shops/ShopScopeProvider';

import { REPORT_LABELS, ReportFilters } from './ReportFilters';
import { ReportView } from './ReportView';
import { SavedViews } from './SavedViews';
import {
  useReports,
  type ReportFilters as ReportFilterState,
  type SavedReportViewRow,
} from './useReports';
import './reports.css';

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (kind: string) => parts.find((item) => item.type === kind)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function ReportsPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : principal.shopIds[0];
  const [filters, setFilters] = useState<ReportFilterState>(() => ({
    area: 'sales',
    fromDate: cairoToday(),
    toDate: cairoToday(),
    source: null,
    shopIds: scope.kind === 'all-shops' ? principal.shopIds : shopId ? [shopId] : [],
    comparePrevious: false,
    comparisonRange: 'previous',
    context: {},
    offset: 0,
  }));
  const [filterOptionsExpanded, setFilterOptionsExpanded] = useState(false);
  const hasContextFilters = Object.values(filters.context ?? {}).some(Boolean);
  const reports = useReports(shopId, filters, filterOptionsExpanded || hasContextFilters);
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
      fromDate: typeof fromDate === 'string' && iso.test(fromDate) ? fromDate : cairoToday(),
      toDate: typeof toDate === 'string' && iso.test(toDate) ? toDate : cairoToday(),
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
      description="Canonical performance reports with saved filters, targets and source activity."
    >
      <ReportFilters
        value={filters}
        onChange={setFilters}
        canCompareShops={principal.role === 'OWNER'}
        allShopIds={principal.shopIds}
        options={reports.optionsQuery.data?.options ?? {}}
        onExpand={() => setFilterOptionsExpanded(true)}
      />
      <ReportView
        data={reports.reportQuery.data}
        filters={filters}
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
          filters={filters}
          summary={reports.reportQuery.data?.summary}
        />
      ) : null}
      {principal.permissions.includes('finance.view') ? <OwnerSummaryCard shopId={shopId} /> : null}
      {config ? (
        <SavedViews
          shopId={shopId}
          views={config.savedViews}
          targets={config.targets}
          filters={filters}
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
