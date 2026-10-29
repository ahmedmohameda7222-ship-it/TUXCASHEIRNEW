import type { ReportResponse, ReportFilters } from './useReports';

/** A trend can be computed only from a complete canonical row set, never one UI page. */
export function completeReportDailyActivity(
  data: ReportResponse,
  filters: ReportFilters,
): readonly { date: string; count: number }[] | null {
  if (
    filters.offset !== 0 ||
    data.nextOffset !== null ||
    data.rows.length !== data.summary.eventCount
  ) {
    return null;
  }
  const fromMs = Date.parse(filters.fromDate + 'T00:00:00.000Z');
  const toMs = Date.parse(filters.toDate + 'T00:00:00.000Z');
  const dayMs = 86_400_000;
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    fromMs > toMs ||
    (toMs - fromMs) / dayMs > 30
  )
    return null;
  const counts = new Map<string, number>();
  for (let time = fromMs; time <= toMs; time += dayMs) {
    counts.set(new Date(time).toISOString().slice(0, 10), 0);
  }
  const cairoDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const row of data.rows) {
    const at = new Date(row.occurredAt);
    if (!Number.isFinite(at.valueOf())) return null;
    const parts = cairoDate.formatToParts(at);
    const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? '';
    const key = get('year') + '-' + get('month') + '-' + get('day');
    if (!counts.has(key)) return null;
    counts.set(key, counts.get(key)! + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}
