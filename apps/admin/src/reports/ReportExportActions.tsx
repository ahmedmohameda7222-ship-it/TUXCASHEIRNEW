import { useEffect, useRef, useState } from 'react';

import { validReportDateRange } from './reportDateRange';
import type { ReportFilters } from './useReports';

type ExportKind = 'current' | 'all-authorized';
export function ReportExportActions({
  filters,
  shopId,
  csrfToken,
}: {
  filters: ReportFilters;
  shopId: string;
  csrfToken: string | null;
}) {
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const invalid =
    !validReportDateRange(filters.fromDate, filters.toDate) ||
    filters.shopIds.length === 0 ||
    !csrfToken;
  async function download(kind: ExportKind) {
    if (invalid || busy || !csrfToken) return;
    setError(null);
    setBusy(kind);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch('/api/admin/reports', {
        method: 'POST',
        credentials: 'same-origin',
        signal: abort.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/pdf',
          'x-tux-admin-csrf': csrfToken,
        },
        body: JSON.stringify({
          view: 'pdf-export',
          kind,
          area: filters.area,
          shopId,
          shopIds: filters.shopIds,
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          source: kind === 'current' ? filters.source : null,
          context: kind === 'current' ? filters.context ?? {} : {},
          comparePrevious: kind === 'current' && filters.comparePrevious,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'report_pdf_export_failed');
      }
      if (!(response.headers.get('content-type') ?? '').includes('application/pdf')) {
        throw new Error('Invalid PDF response from report server.');
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Empty PDF response from report server.');
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `tux-reports-${kind}-${filters.fromDate}-${filters.toDate}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message.replaceAll('_', ' ') : 'Report export failed');
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(null);
    }
  }

  return (
    <div className="tux-report-export-actions" aria-label="PDF exports">
      <button
        type="button"
        className="admin-secondary-button"
        disabled={Boolean(invalid || busy)}
        onClick={() => void download('current')}
      >
        {busy === 'current' ? 'Preparing report PDF…' : 'Download report PDF'}
      </button>
      <button
        type="button"
        className="admin-secondary-button"
        disabled={Boolean(invalid || busy)}
        onClick={() => void download('all-authorized')}
      >
        {busy === 'all-authorized' ? 'Preparing all authorized reports…' : 'All 22 reports (1 PDF)'}
      </button>
      {busy ? (
        <button type="button" className="admin-secondary-button" onClick={() => controller.current?.abort()}>
          Cancel
        </button>
      ) : null}
      {error ? <p role="alert" className="admin-inline-error">{error}</p> : null}
      {filters.comparePrevious ? <small>Comparison export is not yet supported by the server.</small> : null}
    </div>
  );
}
