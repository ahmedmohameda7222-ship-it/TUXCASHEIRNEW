import { ADMIN_REPORT_AREAS, type AdminReportArea, type AdminSessionPrincipal } from '@tux/admin-contracts';

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
  pageSize: 100;
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
};
export type ExportSection = {
  area: AdminReportArea;
  rows: ExportFact[];
  summary: ExportSummary;
};
export type AuthorizedExport = {
  sections: ExportSection[];
  selectedShops: readonly string[];
  fromDate: string;
  toDate: string;
  requestedAreaCount: number;
};

/** Exact-domain, server-authorized collection; implementation follows a RED regression. */
export async function collectAuthorizedReportExport(
  input: ReportPdfExportInput,
  principal: AdminSessionPrincipal,
  query: (args: ExportQueryArgs) => Promise<ExportQueryResponse>,
): Promise<AuthorizedExport> {
  void ADMIN_REPORT_AREAS;
  void input;
  void principal;
  void query;
  throw new Error('report_pdf_export_not_implemented');
}
