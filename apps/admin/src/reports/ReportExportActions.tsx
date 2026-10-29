import { useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { validReportDateRange } from './reportDateRange';
import type { ReportFilters } from './useReports';

const MAX_EXPORT_DAYS = 90;

export function validReportExportRange(fromDate: string, toDate: string): boolean {
  if (!validReportDateRange(fromDate, toDate)) return false;
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  return to - from < MAX_EXPORT_DAYS * 86400000;
}

export function ReportExportActions({
  shopId,
  filters,
}: {
  shopId: string;
  filters: ReportFilters;
}) {
  const session = useAdminSession();
  const [busyKind, setBusyKind] = useState<'current' | 'all-authorized' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const validRange = validReportExportRange(filters.fromDate, filters.toDate);
  const enabled = validRange && filters.shopIds.length > 0 && busyKind === null;

  async function download(kind: 'current' | 'all-authorized') {
    if (!enabled || session.state.status !== 'authenticated') return;
    setError(null);
    setBusyKind(kind);
    try {
      const response = await fetch('/api/admin/reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/pdf',
          'content-type': 'application/json',
          'x-tux-admin-csrf': session.state.session.csrfToken,
        },
        body: JSON.stringify({
          type: 'report.pdf.export',
          kind,
          shopId,
          shopIds: filters.shopIds,
          area: filters.area,
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          source: kind === 'current' ? filters.source : null,
          compare:
            kind === 'current' && filters.comparePrevious
              ? (filters.comparisonRange ?? 'previous')
              : null,
          context: kind === 'current' ? (filters.context ?? {}) : {},
        }),
      });
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        const code =
          failure && typeof failure === 'object' && 'error' in failure
            ? String(failure.error)
            : `report_pdf_http_${response.status}`;
        throw new Error(code.replaceAll('_', ' '));
      }
      if (!(response.headers.get('content-type') ?? '').includes('application/pdf')) {
        throw new Error('Report download did not return a PDF document');
      }
      const pdf = await response.blob();
      if (!pdf.size || pdf.size > 8 * 1024 * 1024) {
        throw new Error('Report PDF is empty or exceeds the supported download size');
      }
      const localUrl = URL.createObjectURL(pdf);
      try {
        const link = document.createElement('a');
        link.href = localUrl;
        link.download = `tux-${kind === 'current' ? filters.area : 'all-authorized'}-${filters.fromDate}-${filters.toDate}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(localUrl);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Report export failed');
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <section className="tux-report-exports" aria-label="Report PDF exports">
      <div className="tux-report-exports__actions">
        <button
          type="button"
          className="admin-primary-button"
          disabled={!enabled}
          onClick={() => void download('current')}
        >
          {busyKind === 'current' ? 'Preparing report PDF…' : 'Download report PDF'}
        </button>
        <button
          type="button"
          className="admin-secondary-button"
          disabled={!enabled}
          onClick={() => void download('all-authorized')}
        >
          {busyKind === 'all-authorized'
            ? 'Preparing authorized reports…'
            : 'All 22 reports (1 PDF)'}
        </button>
      </div>
      <small>
        Exports include all matching canonical source records, up to 5,000 records within 90 days.
        The full PDF contains only the report areas you are authorized to view.
      </small>
      {!validRange ? (
        <p role="status" className="tux-report-caveat">
          PDF export needs a valid date range of up to 90 calendar days. The interactive report can
          still display longer ranges.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="admin-inline-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
