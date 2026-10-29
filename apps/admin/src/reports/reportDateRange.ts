const DAY_MS = 24 * 60 * 60 * 1000;

function exactIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}

/** Matches the report API's bounded period preflight; never silently clip. */
export function validReportDateRange(from: string, to: string): boolean {
  const startMs = exactIsoDate(from);
  const endMs = exactIsoDate(to);
  return startMs !== null && endMs !== null && startMs <= endMs && endMs - startMs <= 730 * DAY_MS;
}

/** The browser may be in a different timezone; report-day presets use Cairo dates. */
export function cairoReportToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Calendar date arithmetic, inclusive of the selected Cairo day. */
export function reportDatePreset(
  toDate: string,
  inclusiveDays: 1 | 7 | 30,
): { fromDate: string; toDate: string } {
  const end = exactIsoDate(toDate);
  if (end === null) throw new Error('invalid_report_date_preset');
  return {
    fromDate: new Date(end - (inclusiveDays - 1) * DAY_MS).toISOString().slice(0, 10),
    toDate,
  };
}
