import {
  ADMIN_REPORT_AREAS,
  type AdminReportArea,
  type AdminSessionPrincipal,
} from '@tux/admin-contracts';
import { AdminAuthorizationError } from '../authorization.js';
import { requireReportArea, requireReportContextPermissions } from './reportAuthorization.js';

export type ExportFact = {
  id: string;
  shopId: string;
  occurredAt: string;
  label: string;
  sourceKind: string;
  amountMinor: number | null;
  quantity: number;
  costMissing: boolean;
};
export type ExportSummary = {
  eventCount: number;
  orderCount: number;
  totalAmountMinor: number | null;
  totalQuantity: number;
  incompleteCostEvents: number;
  coverageNote: string | null;
};
export type ExportQueryArgs = {
  area: AdminReportArea;
  shopIds: readonly string[];
  fromDate: string;
  toDate: string;
  source: 'POS' | 'ONLINE' | null;
  context: Readonly<Record<string, string>>;
  pageSize: 100 | 1;
  offset: number;
};
export type ExportQueryResponse = {
  ok: boolean;
  summary: ExportSummary;
  rows: readonly ExportFact[];
  nextOffset: number | null;
};
export type ReportPdfExportInput = {
  kind: 'current' | 'all-authorized';
  area: AdminReportArea;
  shopIds: readonly string[];
  fromDate: string;
  toDate: string;
  source: 'POS' | 'ONLINE' | null;
  context: Readonly<Record<string, string>>;
  comparePrevious?: boolean;
  comparisonRange?: 'previous' | 'week' | 'month' | 'year';
};
export type ExportSection = {
  area: AdminReportArea;
  rows: ExportFact[];
  summary: ExportSummary;
  comparison?: {
    periodStart: string;
    periodEnd: string;
    summary: ExportSummary;
  };
};
export type AuthorizedExport = {
  sections: ExportSection[];
  selectedShops: readonly string[];
  fromDate: string;
  toDate: string;
  requestedAreaCount: number;
};

function previousWindow(
  fromDate: string,
  toDate: string,
  range: 'previous' | 'week' | 'month' | 'year',
): { fromDate: string; toDate: string } {
  const start = Date.parse(fromDate + 'T00:00:00.000Z');
  const end = Date.parse(toDate + 'T00:00:00.000Z');
  const day = 86400000;
  const dateLabel = (time: number) => new Date(time).toISOString().slice(0, 10);
  let previousFrom = start - (Math.round((end - start) / day) + 1) * day;
  let previousTo = start - day;
  if (range === 'week') previousFrom = start - 7 * day;
  else if (range === 'month') {
    const date = new Date(start);
    previousFrom = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
    previousTo = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - day;
  } else if (range === 'year') {
    const y = new Date(start).getUTCFullYear() - 1;
    previousFrom = Date.UTC(y, 0, 1);
    previousTo = Date.UTC(y, 11, 31);
  }
  return { fromDate: dateLabel(previousFrom), toDate: dateLabel(previousTo) };
}

export const REPORT_EXPORT_MAX_ROWS_PER_AREA = 1500;
export const REPORT_EXPORT_MAX_TOTAL_ROWS = 5000;

/**
 * Do not stream a partial report as a complete export. The canonical summary
 * remains authoritative and is never recomputed from paginated source rows.
 */
export async function collectAuthorizedReportExport(
  input: ReportPdfExportInput,
  principal: AdminSessionPrincipal,
  query: (args: ExportQueryArgs) => Promise<ExportQueryResponse>,
): Promise<AuthorizedExport> {
  const fromMs = Date.parse(`${input.fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${input.toDate}T00:00:00.000Z`);
  const valid = (date: string, ms: number) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === date;
  if (
    !valid(input.fromDate, fromMs) ||
    !valid(input.toDate, toMs) ||
    fromMs > toMs ||
    toMs - fromMs > 730 * 86400000
  ) {
    throw new Error('report_range_invalid');
  }
  if (
    input.shopIds.length < 1 ||
    input.shopIds.length > 50 ||
    new Set(input.shopIds).size !== input.shopIds.length
  ) {
    throw new Error('report_shop_scope_invalid');
  }
  // A single unauthorized shop blocks the whole request, even for a
  // multi-domain or "all reports" export.
  for (const shopId of input.shopIds) {
    requireReportArea(principal, 'sales', shopId);
  }

  const areas = input.kind === 'all-authorized' ? ADMIN_REPORT_AREAS : [input.area];
  const sections: ExportSection[] = [];
  let totalRows = 0;
  for (const area of areas) {
    try {
      for (const shopId of input.shopIds) requireReportArea(principal, area, shopId);
    } catch (error) {
      if (input.kind === 'all-authorized' && error instanceof AdminAuthorizationError) {
        continue;
      }
      throw error;
    }
    const context = input.kind === 'current' ? input.context : {};
    const source = input.kind === 'current' ? input.source : null;
    for (const shopId of input.shopIds) {
      requireReportContextPermissions(principal, context, shopId);
    }

    const rows: ExportFact[] = [];
    let summary: ExportSummary | null = null;
    let offset = 0;
    while (true) {
      const result = await query({
        area,
        shopIds: input.shopIds,
        fromDate: input.fromDate,
        toDate: input.toDate,
        context,
        source,
        pageSize: 100,
        offset,
      });
      if (!result.ok || !result.summary || !Array.isArray(result.rows)) {
        throw new Error('report_export_query_failed');
      }
      if (!summary) {
        summary = result.summary;
        if (
          !Number.isSafeInteger(summary.eventCount) ||
          summary.eventCount > REPORT_EXPORT_MAX_ROWS_PER_AREA ||
          summary.eventCount + totalRows > REPORT_EXPORT_MAX_TOTAL_ROWS
        ) {
          throw new Error('report_export_too_large');
        }
      }
      if (
        result.rows.length > 100 ||
        rows.length + result.rows.length > REPORT_EXPORT_MAX_ROWS_PER_AREA ||
        totalRows + rows.length + result.rows.length > REPORT_EXPORT_MAX_TOTAL_ROWS
      ) {
        throw new Error('report_export_too_large');
      }
      rows.push(...result.rows);
      if (result.nextOffset === null) break;
      if (
        !Number.isSafeInteger(result.nextOffset) ||
        result.nextOffset <= offset ||
        result.nextOffset > 20000 ||
        result.rows.length === 0
      ) {
        throw new Error('report_export_pagination_invalid');
      }
      offset = result.nextOffset;
    }
    // The RPC summary is complete independently of pagination. Source
    // event counts must match the actually exported rows; do not hide drift.
    if (!summary || rows.length !== summary.eventCount) {
      throw new Error('report_export_count_mismatch');
    }
    let comparison: ExportSection['comparison'];
    if (input.kind === 'current' && input.comparePrevious) {
      const previous = previousWindow(
        input.fromDate,
        input.toDate,
        input.comparisonRange ?? 'previous',
      );
      const result = await query({
        area,
        shopIds: input.shopIds,
        fromDate: previous.fromDate,
        toDate: previous.toDate,
        context,
        source,
        pageSize: 1,
        offset: 0,
      });
      if (!result.ok || !result.summary) throw new Error('report_export_query_failed');
      comparison = {
        periodStart: previous.fromDate,
        periodEnd: previous.toDate,
        summary: result.summary,
      };
    }
    totalRows += rows.length;
    sections.push({ area, rows, summary, ...(comparison ? { comparison } : {}) });
  }
  if (sections.length === 0) {
    throw new AdminAuthorizationError('permission_forbidden');
  }
  return {
    sections,
    selectedShops: input.shopIds,
    fromDate: input.fromDate,
    toDate: input.toDate,
    requestedAreaCount: areas.length,
  };
}
