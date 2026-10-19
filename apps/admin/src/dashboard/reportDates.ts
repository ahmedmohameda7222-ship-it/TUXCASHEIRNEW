/** Calendar dates belong to the restaurant's configured Cairo reporting day.
 * Date comparisons use YYYY-MM-DD civil dates, never browser-local timestamps. */
export function cairoReportDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function priorReportDay(day: string, days: number): string {
  const result = new Date(`${day}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

/** Reject the complete trend when any source date cannot be reconciled
 * with the requested calendar interval. Do not silently drop/rename points. */
export function trendMatchesPeriod(
  points: readonly { date: string; netSalesMinor: number }[],
  from: string,
  to: string,
): boolean {
  const seen = new Set<string>();
  return points.every(({ date, netSalesMinor }) => {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
    const validDate =
      parsed !== null &&
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === date;
    if (
      !validDate ||
      date < from ||
      date > to ||
      seen.has(date) ||
      !Number.isSafeInteger(netSalesMinor)
    )
      return false;
    seen.add(date);
    return true;
  });
}
