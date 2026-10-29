import {
  ADMIN_REPORT_AREAS,
  type AdminReportArea,
  type AdminSessionPrincipal,
} from '@tux/admin-contracts';

import { AdminAuthorizationError, requirePermission } from '../authorization.js';
import { requireReportArea, requireReportContextPermissions } from './reportAuthorization.js';

/** Fixed-size pages prevent the browser's 50-row window from clipping exports. */
export const REPORT_EXPORT_PAGE_SIZE = 100;
export const REPORT_EXPORT_MAX_ROWS = 5_000;
export const REPORT_EXPORT_MAX_DAYS = 90;
export const REPORT_EXPORT_MAX_OFFSET = 20_000;

export class ReportExportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ReportExportError';
  }
}

export type ReportExportQuery = (input: {
  p_actor_employee_id: string;
  p_shop_ids: readonly string[];
  p_area: AdminReportArea;
  p_start_date: string;
  p_end_date: string;
  p_page_limit: number;
  p_offset: number;
  p_source: 'POS' | 'ONLINE' | null;
  p_context: Readonly<Record<string, unknown>>;
}) => Promise<Readonly<Record<string, unknown>>>;

export type ReportExportRow = Readonly<{
  id: string;
  shopId: string;
  sourceKind: string;
  occurredAt: string;
  label: string;
  amountMinor: number | null;
  quantity: number;
  orderSource: 'POS' | 'ONLINE' | null;
  costMissing: boolean;
}>;

export type ReportExportSummary = Readonly<{
  eventCount: number;
  orderCount: number;
  totalAmountMinor: number | null;
  totalQuantity: number;
  incompleteCostEvents: number;
  coverageNote: string | null;
}>;

export type ReportExportSection = Readonly<{
  area: AdminReportArea;
  summary: ReportExportSummary;
  rows: readonly ReportExportRow[];
}>;

export type ReportExportData = Readonly<{
  kind: 'current' | 'all-authorized';
  fromDate: string;
  toDate: string;
  shopIds: readonly string[];
  source: 'POS' | 'ONLINE' | null;
  context: Readonly<Record<string, unknown>>;
  totalCanonicalAreas: number;
  skippedUnauthorizedCount: number;
  sections: readonly ReportExportSection[];
}>;

export type ReportExportInput = Readonly<{
  kind: 'current' | 'all-authorized';
  area: AdminReportArea;
  principal: AdminSessionPrincipal;
  shopIds: readonly string[];
  fromDate: string;
  toDate: string;
  source: 'POS' | 'ONLINE' | null;
  context: Readonly<Record<string, unknown>>;
  query: ReportExportQuery;
}>;

function calendarMs(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const milliseconds = Date.parse(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === isoDate
    ? milliseconds
    : null;
}

function validateInput(input: ReportExportInput): void {
  const from = calendarMs(input.fromDate);
  const to = calendarMs(input.toDate);
  if (
    from === null ||
    to === null ||
    to < from ||
    to - from > (REPORT_EXPORT_MAX_DAYS - 1) * 86400000
  ) {
    throw new ReportExportError('report_export_range_invalid');
  }
  if (
    input.shopIds.length === 0 ||
    input.shopIds.length > 50 ||
    new Set(input.shopIds).size !== input.shopIds.length
  ) {
    throw new ReportExportError('report_export_shop_scope_invalid');
  }
  // Never downgrade a requested unauthorized shop to a partially authorized PDF.
  for (const shopId of input.shopIds) {
    requirePermission(input.principal, 'reports.view', shopId);
  }
}

function authorizedAreas(input: ReportExportInput): readonly AdminReportArea[] {
  const candidates = input.kind === 'current' ? [input.area] : ADMIN_REPORT_AREAS;
  const allowed: AdminReportArea[] = [];
  for (const area of candidates) {
    try {
      for (const shopId of input.shopIds) {
        requireReportArea(input.principal, area, shopId);
      }
      allowed.push(area);
    } catch (error) {
      if (input.kind === 'all-authorized' && error instanceof AdminAuthorizationError) {
        continue;
      }
      throw error;
    }
  }
  if (!allowed.length) throw new ReportExportError('report_export_no_authorized_areas');
  return allowed;
}

function readSummary(value: unknown): ReportExportSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReportExportError('report_export_backend_contract_invalid');
  }
  const data = value as Record<string, unknown>;
  const counts = ['eventCount', 'orderCount', 'totalQuantity', 'incompleteCostEvents'] as const;
  for (const key of counts) {
    if (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0) {
      throw new ReportExportError('report_export_backend_contract_invalid');
    }
  }
  const amount = data['totalAmountMinor'];
  if (amount !== null && !Number.isSafeInteger(amount)) {
    throw new ReportExportError('report_export_backend_contract_invalid');
  }
  const coverageNote = data['coverageNote'];
  if (coverageNote !== null && typeof coverageNote !== 'string') {
    throw new ReportExportError('report_export_backend_contract_invalid');
  }
  return data as ReportExportSummary;
}

function readRows(value: unknown): readonly ReportExportRow[] {
  if (!Array.isArray(value) || value.length > REPORT_EXPORT_PAGE_SIZE) {
    throw new ReportExportError('report_export_backend_contract_invalid');
  }
  for (const raw of value) {
    if (
      raw === null ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      typeof raw.shopId !== 'string' ||
      typeof raw.sourceKind !== 'string' ||
      typeof raw.label !== 'string' ||
      typeof raw.occurredAt !== 'string' ||
      (raw.amountMinor !== null && !Number.isSafeInteger(raw.amountMinor)) ||
      !Number.isFinite(raw.quantity)
    ) {
      throw new ReportExportError('report_export_backend_contract_invalid');
    }
  }
  return value as readonly ReportExportRow[];
}

/** Never return an incomplete report under a filename claiming to be complete. */
export async function collectAuthorizedReportExport(
  input: ReportExportInput,
): Promise<ReportExportData> {
  validateInput(input);
  const areas = authorizedAreas(input);
  const source = input.kind === 'current' ? input.source : null;
  const context = input.kind === 'current' ? input.context : {};
  if (input.kind === 'current') {
    for (const shopId of input.shopIds) {
      requireReportContextPermissions(input.principal, context, shopId);
    }
  }
  const sections: ReportExportSection[] = [];
  let totalRows = 0;
  for (const area of areas) {
    let offset = 0;
    let summary: ReportExportSummary | null = null;
    const rows: ReportExportRow[] = [];
    const seen = new Set<string>();
    for (;;) {
      if (offset > REPORT_EXPORT_MAX_OFFSET) {
        throw new ReportExportError('report_export_too_large');
      }
      const page = await input.query({
        p_actor_employee_id: input.principal.employeeId,
        p_shop_ids: input.shopIds,
        p_area: area,
        p_start_date: input.fromDate,
        p_end_date: input.toDate,
        p_page_limit: REPORT_EXPORT_PAGE_SIZE,
        p_offset: offset,
        p_source: source,
        p_context: context,
      });
      if (page['ok'] !== true) {
        throw new ReportExportError(
          typeof page['code'] === 'string' ? page['code'] : 'report_export_query_failed',
        );
      }
      const candidateSummary = readSummary(page['summary']);
      if (!summary) {
        summary = candidateSummary;
        if (totalRows + summary.eventCount > REPORT_EXPORT_MAX_ROWS) {
          throw new ReportExportError('report_export_too_large');
        }
      } else if (
        candidateSummary.eventCount !== summary.eventCount ||
        candidateSummary.totalAmountMinor !== summary.totalAmountMinor
      ) {
        throw new ReportExportError('report_export_changed_during_read');
      }
      const nextRows = readRows(page['rows']);
      for (const row of nextRows) {
        const key = `${row.sourceKind}:${row.id}`;
        if (seen.has(key)) throw new ReportExportError('report_export_duplicate_event');
        seen.add(key);
        rows.push(row);
      }
      if (totalRows + rows.length > REPORT_EXPORT_MAX_ROWS) {
        throw new ReportExportError('report_export_too_large');
      }
      if (page['nextOffset'] === null) break;
      const next = page['nextOffset'];
      if (!Number.isSafeInteger(next) || (next as number) <= offset || nextRows.length === 0) {
        throw new ReportExportError('report_export_pagination_invalid');
      }
      offset = next as number;
    }
    if (!summary || rows.length !== summary.eventCount) {
      throw new ReportExportError('report_export_count_mismatch');
    }
    totalRows += rows.length;
    sections.push({ area, summary, rows });
  }
  return {
    kind: input.kind,
    fromDate: input.fromDate,
    toDate: input.toDate,
    shopIds: [...input.shopIds],
    source,
    context,
    totalCanonicalAreas: ADMIN_REPORT_AREAS.length,
    skippedUnauthorizedCount: ADMIN_REPORT_AREAS.length - areas.length,
    sections,
  };
}
