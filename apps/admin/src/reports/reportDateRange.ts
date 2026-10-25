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
  return (
    startMs !== null &&
    endMs !== null &&
    startMs <= endMs &&
    endMs - startMs <= 730 * DAY_MS
  );
}
